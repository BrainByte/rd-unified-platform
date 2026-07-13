// ============================================================================
// RULE ENGINE — compiles declarative rules from jurisdictions.js into
// Dataform assertions. An assertion query selects VIOLATING rows;
// zero rows = rule satisfied, any row = pipeline fails before submission.
//
// Adding a rule type: add one entry to RULE_TYPES with
//   validate(rule, j) -> string[]   config-time errors
//   violations(ctx, j, rule, table) -> SQL selecting violating rows
// ============================================================================

const { allCodes, temporalPredicate } = require("./effective_dating");

function std(ctx, j, rule, table, predicate, keyColumn = "slip_id") {
  return `
    SELECT '${rule.id}' AS rule_id, ${keyColumn} AS row_key, report_date
    FROM ${table}
    WHERE ${predicate}
  `;
}

const RULE_TYPES = {
  not_null: {
    validate: (r) => (r.field ? [] : [`${r.id}: not_null requires 'field'`]),
    violations: (ctx, j, r, t, k) => std(ctx, j, r, t, `${r.field} IS NULL`, k),
  },

  non_negative: {
    validate: (r) => (r.field ? [] : [`${r.id}: non_negative requires 'field'`]),
    violations: (ctx, j, r, t, k) => std(ctx, j, r, t, `${r.field} < 0`, k),
  },

  max_value: {
    validate: (r) =>
      r.field && typeof r.value === "number"
        ? []
        : [`${r.id}: max_value requires 'field' and numeric 'value'`],
    violations: (ctx, j, r, t, k) => std(ctx, j, r, t, `${r.field} > ${r.value}`, k),
  },

  in_set: {
    validate: (r) =>
      r.field && Array.isArray(r.values) && r.values.length
        ? []
        : [`${r.id}: in_set requires 'field' and non-empty 'values'`],
    violations: (ctx, j, r, t, k) => std(ctx, j, r, t,
        `${r.field} NOT IN (${r.values.map((v) => `'${v}'`).join(", ")})`, k),
  },

  matches: {
    validate: (r) =>
      r.field && r.pattern ? [] : [`${r.id}: matches requires 'field' and 'pattern'`],
    violations: (ctx, j, r, t, k) => std(ctx, j, r, t, `NOT ${require("./dialect").regexpContains(r.field, r.pattern)}`, k),
  },

  // field must be zero when another field equals a value (e.g. payout on voids)
  zero_when: {
    validate: (r) =>
      r.field && r.whenField && r.equals !== undefined
        ? []
        : [`${r.id}: zero_when requires 'field', 'whenField', 'equals'`],
    violations: (ctx, j, r, t, k) => std(ctx, j, r, t, `${r.whenField} = '${r.equals}' AND ${r.field} != 0`, k),
  },

  unique: {
    validate: (r) => (r.field ? [] : [`${r.id}: unique requires 'field'`]),
    violations: (ctx, j, r, t) => `
      SELECT '${r.id}' AS rule_id, ${r.field} AS row_key, CAST(NULL AS DATE) AS report_date
      FROM ${t}
      GROUP BY ${r.field}
      HAVING COUNT(*) > 1
    `,
  },

  // sport_code must be one of this regulator's published codes
  valid_sport_code: {
    validate: (r, j) =>
      j && j.nomenclature && j.nomenclature.sportCodes
        ? []
        : [`${r.id}: valid_sport_code requires nomenclature config on the market`],
    violations: (ctx, j, r, t) => {
      const allowed = allCodes(j.nomenclature.sportCodes); // every version's code is valid
      if (j.nomenclature.defaultSportCode) allowed.push(j.nomenclature.defaultSportCode);
      return std(ctx, j, r, t,
        `sport_code IS NULL OR sport_code NOT IN (${allowed.map((c) => `'${c}'`).join(", ")})`);
    },
  },

  // cross-domain: every slip's fixture must resolve to a canonical sport
  // that this regulator maps (for markets with unmappedPolicy 'block')
  no_unmapped_fixtures: {
    validate: () => [],
    violations: (ctx, j, r, t) => `
      SELECT '${r.id}' AS rule_id, s.slip_id, s.report_date
      FROM ${t} s
      JOIN ${ctx.ref("fct_bet_slip_lifecycle")} b USING (slip_id)
      LEFT JOIN ${ctx.ref("dim_fixture")} f ON b.fixture_id = f.fixture_id
      LEFT JOIN ${ctx.ref("map_sport_regulator")} rm
        ON rm.jurisdiction = '${j.code}' AND rm.canonical_sport = f.canonical_sport${temporalPredicate("rm", "s.report_date")}
      WHERE rm.regulator_code IS NULL
    `,
  },

  // ---- GAMING rule types (target the gaming submission file) ----

  // game_code must be one of this regulator's held licence / type codes
  valid_game_code: {
    validate: (r, j) =>
      j && j.gamingNomenclature && j.gamingNomenclature.gameCodes
        ? []
        : [`${r.id}: valid_game_code requires gamingNomenclature config on the market`],
    violations: (ctx, j, r, t, k) => {
      const codes = new Set(allCodes(j.gamingNomenclature.gameCodes));
      if (j.gamingNomenclature.defaultGameCode) codes.add(j.gamingNomenclature.defaultGameCode);
      const allowed = [...codes];
      return std(ctx, j, r, t,
        `game_code IS NULL OR game_code NOT IN (${allowed.map((c) => `'${c}'`).join(", ")})`, k);
    },
  },

  // cross-domain: every activity's game must resolve to a canonical type
  // this regulator licenses (DGOJ 'block' markets: no singular licence,
  // no offering — an unlicensed vertical in the file is a breach)
  no_unlicensed_games: {
    validate: () => [],
    violations: (ctx, j, r, t) => `
      SELECT '${r.id}' AS rule_id, s.activity_id AS row_key, s.report_date
      FROM ${t} s
      JOIN ${ctx.ref("fct_gaming_activity")} g ON s.activity_id = g.activity_id
      LEFT JOIN ${ctx.ref("dim_game")} gm ON g.game_id = gm.game_id
      LEFT JOIN ${ctx.ref("map_game_regulator")} grm
        ON grm.jurisdiction = '${j.code}' AND grm.canonical_game_type = gm.canonical_game_type${temporalPredicate("grm", "s.report_date")}
      WHERE grm.regulator_code IS NULL
    `,
  },

  // cross-domain rule: no slip in the file may be VOIDED in the lifecycle fact
  no_voided_slips: {
    validate: () => [],
    violations: (ctx, j, r, t) => `
      SELECT '${r.id}' AS rule_id, f.slip_id, f.report_date
      FROM ${t} f
      JOIN ${ctx.ref("fct_bet_slip_lifecycle")} b USING (slip_id)
      WHERE b.slip_status = 'VOIDED'
    `,
  },
};

function marketRules(j, commonRules) {
  return [...commonRules, ...(j.rules || [])];
}

function marketGamingRules(j, commonGamingRules) {
  return [...commonGamingRules, ...(j.gamingRules || [])];
}

// opts: { table, keyColumn } — defaults target the betting submission file;
// gaming assertions pass the gaming file + activity_id.
function violationQuery(ctx, j, rule, opts = {}) {
  const type = RULE_TYPES[rule.type];
  if (!type) {
    throw new Error(`Unknown rule type '${rule.type}' (rule ${rule.id}, market ${j.code})`);
  }
  const table = ctx.ref(opts.table || `submission_ready_${j.code.toLowerCase()}`);
  return type.violations(ctx, j, rule, table, opts.keyColumn || "slip_id");
}

module.exports = { RULE_TYPES, marketRules, marketGamingRules, violationQuery };
