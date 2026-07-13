// ============================================================================
// CONFIG VALIDATOR — pre-flight checks run in CI and by demo/compile-demo.js
// BEFORE anything reaches BigQuery. Returns a list of human/AI-readable
// errors; empty list = config is deployable.
// ============================================================================

const { knownFields, knownGamingFields, knownPeriodicFields } = require("./fields");
const { knownExtensions } = require("./extensions");
const { RULE_TYPES, marketRules, marketGamingRules } = require("./rules");
const { canonicalSports, canonicalGameTypes } = require("./nomenclature/canonical");
const { templateTokensValid } = require("./nomenclature/mapping");

const NOMENCLATURE_FIELDS = ["sport_code", "event_name"];

const REQUIRED_KEYS = [
  "code", "dataset", "currency", "rounding", "timezone",
  "submissionCadence", "includeVoided", "taxModel", "taxRate", "reportFields",
];

// Rule types whose 'field' must be a column of the submission file.
const COLUMN_RULE_TYPES = [
  "not_null", "non_negative", "max_value", "in_set", "matches", "zero_when", "unique",
];

function validateMarket(j, commonRules, commonGamingRules = []) {
  const errors = [];
  const where = (msg) => `[${j.code || "?"}] ${msg}`;

  for (const key of REQUIRED_KEYS) {
    if (j[key] === undefined) errors.push(where(`missing required config key '${key}'`));
  }

  // effective-dated tax rates: a schedule must have numeric rates
  for (const key of ["taxRate", "gamingTaxRate"]) {
    if (Array.isArray(j[key]) && !j[key].every((v) => typeof v.rate === "number")) {
      errors.push(where(`${key} schedule entries must each have a numeric 'rate'`));
    }
  }
  // tax BASE is config: 'ggr' (stake - payout) or 'turnover' (stakes —
  // Germany's RennwLottG model). REQ: de-regulator-addition.
  if (j.taxModel !== undefined && !["ggr", "turnover"].includes(j.taxModel)) {
    errors.push(where(`taxModel must be 'ggr' or 'turnover', got '${j.taxModel}'`));
  }
  // effective-dated regulator codes: a versioned code must have string codes
  for (const nom of [j.nomenclature && j.nomenclature.sportCodes, j.gamingNomenclature && j.gamingNomenclature.gameCodes]) {
    for (const spec of Object.values(nom || {})) {
      if (Array.isArray(spec) && !spec.every((v) => typeof v.code === "string")) {
        errors.push(where(`versioned regulator code entries must each have a string 'code'`));
      }
    }
  }

  // every report field must exist in the field registry
  for (const f of j.reportFields || []) {
    if (!knownFields().includes(f)) {
      errors.push(where(`reportFields contains unknown field '${f}' — add it to includes/fields.js`));
    }
  }

  // reporting voids requires the status column in the file
  if (j.includeVoided && !(j.reportFields || []).includes("slip_status")) {
    errors.push(where(`includeVoided=true requires 'slip_status' in reportFields`));
  }

  // ---- jurisdiction extension attributes (Option B) ----
  for (const name of j.extensions || []) {
    if (!knownExtensions().includes(name)) {
      errors.push(where(`extensions contains unknown attribute '${name}' — add it to includes/extensions.js`));
    }
  }
  // the winnings-withholding extension is config-driven — it needs its bands
  if ((j.extensions || []).includes("winnings_withholding_tax") &&
      !(j.winningsTax && Array.isArray(j.winningsTax.brackets) && j.winningsTax.basis)) {
    errors.push(where(`winnings_withholding_tax extension requires winningsTax config (basis + brackets)`));
  }

  // ---- nomenclature checks ----
  const usesNomenclature = (j.reportFields || []).some((f) => NOMENCLATURE_FIELDS.includes(f));
  if (usesNomenclature) {
    const n = j.nomenclature;
    if (!n || !n.sportCodes || !n.eventNameTemplate || !n.unmappedPolicy) {
      errors.push(where(`fields ${NOMENCLATURE_FIELDS.join("/")} require nomenclature config ` +
        `(sportCodes, eventNameTemplate, unmappedPolicy)`));
    } else {
      // every mapped canonical code must exist in the canonical taxonomy
      const canon = canonicalSports.map((s) => s.code);
      for (const code of Object.keys(n.sportCodes)) {
        if (!canon.includes(code)) {
          errors.push(where(`nomenclature maps unknown canonical sport '${code}' — ` +
            `add it to includes/nomenclature/canonical.js or fix the typo`));
        }
      }
      if (!["default", "block"].includes(n.unmappedPolicy)) {
        errors.push(where(`unmappedPolicy must be 'default' or 'block', got '${n.unmappedPolicy}'`));
      }
      if (n.unmappedPolicy === "default" && !n.defaultSportCode) {
        errors.push(where(`unmappedPolicy 'default' requires defaultSportCode`));
      }
      if (n.unmappedPolicy === "block" &&
          !marketRules(j, commonRules).some((r) => r.type === "no_unmapped_fixtures")) {
        errors.push(where(`unmappedPolicy 'block' requires a no_unmapped_fixtures rule to enforce it`));
      }
      if (!templateTokensValid(n.eventNameTemplate)) {
        errors.push(where(`eventNameTemplate may only use {home} and {away} tokens`));
      }
    }
  }

  // ---- gaming domain checks ----
  if (j.gamingReportFields || j.gamingNomenclature || j.gamingRules) {
    const gn = j.gamingNomenclature;
    for (const f of j.gamingReportFields || []) {
      if (!knownGamingFields().includes(f)) {
        errors.push(where(`gamingReportFields contains unknown field '${f}' — add it to includes/fields.js`));
      }
    }
    if (!gn || !gn.gameCodes || !gn.unmappedPolicy) {
      errors.push(where(`gaming domain requires gamingNomenclature (gameCodes, unmappedPolicy)`));
    } else {
      const canon = canonicalGameTypes.map((g) => g.code);
      for (const code of Object.keys(gn.gameCodes)) {
        if (!canon.includes(code)) {
          errors.push(where(`gamingNomenclature maps unknown canonical game type '${code}' — ` +
            `add it to includes/nomenclature/canonical.js or fix the typo`));
        }
      }
      if (!["default", "block"].includes(gn.unmappedPolicy)) {
        errors.push(where(`gaming unmappedPolicy must be 'default' or 'block', got '${gn.unmappedPolicy}'`));
      }
      if (gn.unmappedPolicy === "default" && !gn.defaultGameCode) {
        errors.push(where(`gaming unmappedPolicy 'default' requires defaultGameCode`));
      }
      if (gn.unmappedPolicy === "block" &&
          !(j.gamingRules || []).some((r) => r.type === "no_unlicensed_games")) {
        errors.push(where(`gaming unmappedPolicy 'block' requires a no_unlicensed_games rule to enforce it`));
      }
    }
    if (j.gamingTaxRate === undefined) errors.push(where(`gaming domain requires gamingTaxRate`));
    if (!["deduct_contributions", "gross"].includes(j.jackpotPolicy)) {
      errors.push(where(`jackpotPolicy must be 'deduct_contributions' or 'gross', got '${j.jackpotPolicy}'`));
    }
  }

  // ---- periodic register checks ----
  // REQ: requirements/dgoj-periodic-reporting (REQ-DGOJ-4) — registers are
  // config; a bad register must fail validation, never compile wrong SQL.
  if (j.periodicReports !== undefined) {
    if (!Array.isArray(j.periodicReports) || j.periodicReports.length === 0) {
      errors.push(where(`periodicReports must be a non-empty array of registers`));
    } else {
      const regIds = new Set();
      for (const r of j.periodicReports) {
        const rid = r.id || "?";
        if (!r.id || !/^[A-Za-z][A-Za-z0-9_]*$/.test(r.id)) {
          errors.push(where(`periodic register id '${rid}' must be alphanumeric (it names the table)`));
        }
        if (regIds.has(rid)) errors.push(where(`duplicate periodic register id '${rid}'`));
        regIds.add(rid);
        if (!["daily", "monthly"].includes(r.cadence)) {
          errors.push(where(`register ${rid}: cadence must be 'daily' or 'monthly', got '${r.cadence}'`));
        }
        if (!knownFields().includes(r.playerField)) {
          errors.push(where(`register ${rid}: playerField '${r.playerField}' is not in the field registry`));
        }
        if (!Array.isArray(r.fields) || r.fields.length === 0) {
          errors.push(where(`register ${rid}: fields must be a non-empty array`));
        } else {
          for (const f of r.fields) {
            if (!knownPeriodicFields().includes(f)) {
              errors.push(where(`register ${rid}: unknown periodic field '${f}' — add it to includes/fields.js`));
            }
          }
        }
        // register rules: same integrity checks, against the register's columns
        const regColumns = ["jurisdiction", "register_id", "period_start", "player_ref", ...(r.fields || [])];
        const rSeen = new Set();
        for (const rule of r.rules || []) {
          if (!rule.id) { errors.push(where(`register ${rid} rule without an id: ${JSON.stringify(rule)}`)); continue; }
          if (rSeen.has(rule.id)) errors.push(where(`register ${rid}: duplicate rule id '${rule.id}'`));
          rSeen.add(rule.id);
          if (!rule.description) errors.push(where(`register ${rid} rule ${rule.id} has no description (audit trail requires one)`));
          const type = RULE_TYPES[rule.type];
          if (!type) { errors.push(where(`register ${rid} rule ${rule.id} has unknown type '${rule.type}'`)); continue; }
          errors.push(...type.validate(rule, j).map(where));
          if (COLUMN_RULE_TYPES.includes(rule.type)) {
            for (const col of [rule.field, rule.whenField].filter(Boolean)) {
              if (!regColumns.includes(col)) {
                errors.push(where(`register ${rid} rule ${rule.id} references '${col}' which is not in that register`));
              }
            }
          }
        }
      }
      // the daily->monthly completeness check joins on player_ref, so a
      // daily+monthly pair must identify players the same way
      const daily = j.periodicReports.find((r) => r.cadence === "daily");
      const monthly = j.periodicReports.find((r) => r.cadence === "monthly");
      if (daily && monthly && daily.playerField !== monthly.playerField) {
        errors.push(where(`daily register '${daily.id}' and monthly register '${monthly.id}' must share playerField for the completeness check`));
      }
    }
  }

  // ---- player protection checks ----
  if (j.playerProtection) {
    const pp = j.playerProtection;
    if (pp.defaultDepositLimits) {
      const d = pp.defaultDepositLimits;
      // A period may be null = no statutory default for that window
      // (Germany's LUGAS limit is MONTHLY-only: 1000/month, nothing
      // daily/weekly). Present values must be positive and non-decreasing.
      let present = 0;
      for (const k of ["daily", "weekly", "monthly"]) {
        if (d[k] === null || d[k] === undefined) continue;
        present++;
        if (typeof d[k] !== "number" || d[k] <= 0) {
          errors.push(where(`defaultDepositLimits.${k} must be a positive number or null`));
        }
      }
      if (present === 0) {
        errors.push(where(`defaultDepositLimits needs at least one period (or use null for the whole key)`));
      }
      if (d.daily != null && d.weekly != null && d.daily > d.weekly) {
        errors.push(where(`defaultDepositLimits must be non-decreasing: daily <= weekly`));
      }
      if (d.weekly != null && d.monthly != null && d.weekly > d.monthly) {
        errors.push(where(`defaultDepositLimits must be non-decreasing: weekly <= monthly`));
      }
    }
    if (!Array.isArray(pp.selfExclusionSources) || pp.selfExclusionSources.length === 0) {
      errors.push(where(`playerProtection.selfExclusionSources must be a non-empty array`));
    }
    // A market that names a mandatory national register (ES→RGIAJ, DK→ROFUS,
    // BG→NRA_NSE...) must actually honour it in its exclusion sources. This
    // is config, not a hardcoded jurisdiction check.
    if (pp.mandatoryRegister && !(pp.selfExclusionSources || []).includes(pp.mandatoryRegister)) {
      errors.push(where(`playerProtection.selfExclusionSources must include the mandatory national register '${pp.mandatoryRegister}'`));
    }
    if (typeof pp.withdrawalRequiresVerification !== "boolean") {
      errors.push(where(`playerProtection.withdrawalRequiresVerification must be boolean`));
    }
    // Statutory slots stake caps (REQ: requirements/max-stake-limits) — a
    // bad band must fail config validation, never compile into wrong SQL.
    if (pp.slotsStakeLimits !== undefined) {
      if (!Array.isArray(pp.slotsStakeLimits) || pp.slotsStakeLimits.length === 0) {
        errors.push(where(`playerProtection.slotsStakeLimits must be a non-empty array of bands`));
      } else {
        for (const b of pp.slotsStakeLimits) {
          if (typeof b.maxStake !== "number" || b.maxStake <= 0) {
            errors.push(where(`slotsStakeLimits bands need a positive numeric maxStake`));
          }
          if (b.minAge != null && (typeof b.minAge !== "number" || b.minAge < 18)) {
            errors.push(where(`slotsStakeLimits minAge must be a number >= 18`));
          }
          if (b.maxAge != null && b.maxAge < (b.minAge != null ? b.minAge : 18)) {
            errors.push(where(`slotsStakeLimits maxAge must be >= minAge`));
          }
          for (const k of ["from", "to"]) {
            if (b[k] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(b[k])) {
              errors.push(where(`slotsStakeLimits '${k}' must be a YYYY-MM-DD date string`));
            }
          }
        }
      }
    }
  }

  const rules = marketRules(j, commonRules);
  const seen = new Set();
  const fileColumns = ["report_date", "jurisdiction", ...(j.reportFields || []), ...(j.extensions || [])];

  for (const rule of rules) {
    if (!rule.id) { errors.push(where(`rule without an id: ${JSON.stringify(rule)}`)); continue; }
    if (seen.has(rule.id)) errors.push(where(`duplicate rule id '${rule.id}'`));
    seen.add(rule.id);

    if (!rule.description) errors.push(where(`rule ${rule.id} has no description (audit trail requires one)`));

    const type = RULE_TYPES[rule.type];
    if (!type) { errors.push(where(`rule ${rule.id} has unknown type '${rule.type}'`)); continue; }

    errors.push(...type.validate(rule, j).map(where));

    // column rules can only reference columns that exist in this market's file
    if (COLUMN_RULE_TYPES.includes(rule.type)) {
      for (const col of [rule.field, rule.whenField].filter(Boolean)) {
        if (!fileColumns.includes(col)) {
          errors.push(where(`rule ${rule.id} references '${col}' which is not in the ${j.code} file`));
        }
      }
    }
  }

  // gaming rules: same integrity checks against the GAMING file's columns.
  // Only markets that opt into the gaming domain carry them — a betting-only
  // market (no gaming config) must not inherit the common gaming rules.
  const hasGamingDomain = j.gamingReportFields || j.gamingNomenclature || j.gamingRules;
  const gamingRules = hasGamingDomain ? marketGamingRules(j, commonGamingRules) : [];
  const gamingFileColumns = ["report_date", "jurisdiction", ...(j.gamingReportFields || [])];
  const gSeen = new Set();
  for (const rule of gamingRules) {
    if (!rule.id) { errors.push(where(`gaming rule without an id: ${JSON.stringify(rule)}`)); continue; }
    if (gSeen.has(rule.id)) errors.push(where(`duplicate gaming rule id '${rule.id}'`));
    gSeen.add(rule.id);
    if (!rule.description) errors.push(where(`gaming rule ${rule.id} has no description (audit trail requires one)`));
    const type = RULE_TYPES[rule.type];
    if (!type) { errors.push(where(`gaming rule ${rule.id} has unknown type '${rule.type}'`)); continue; }
    errors.push(...type.validate(rule, j).map(where));
    if (COLUMN_RULE_TYPES.includes(rule.type)) {
      for (const col of [rule.field, rule.whenField].filter(Boolean)) {
        if (!gamingFileColumns.includes(col)) {
          errors.push(where(`gaming rule ${rule.id} references '${col}' which is not in the ${j.code} gaming file`));
        }
      }
    }
  }

  return errors;
}

function validateAll(jurisdictions, commonRules, commonGamingRules = []) {
  return Object.values(jurisdictions).flatMap((j) => validateMarket(j, commonRules, commonGamingRules));
}

module.exports = { validateMarket, validateAll };
