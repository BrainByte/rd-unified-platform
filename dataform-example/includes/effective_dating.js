// ============================================================================
// EFFECTIVE-DATING  (TODO #1, now built)
//
// Tax rates and regulator codes change over time. A tax rate or a regulator
// code in jurisdictions.js can therefore be EITHER a constant OR a
// time-versioned schedule:
//
//   taxRate: 0.20                                        // constant
//   taxRate: [{ rate: 0.20, to: "2026-01-01" },         // 20% up to 2026
//             { rate: 0.25, from: "2026-01-01" }]        // 25% from 2026
//
//   sportCodes: { FOOT: "FUT" }                          // constant
//   sportCodes: { FOOT: [{ code: "FUT", to: "2026-01-01" },
//                        { code: "FTB", from: "2026-01-01" }] }
//
// `from` is inclusive, `to` is exclusive; omit either for open-ended. The
// pipeline resolves the value in effect for the REPORT DATE — so resubmitting
// a historical period reproduces the rate/code that applied then, not today's.
// ============================================================================

// Flatten a code map to rows with valid_from/valid_to (null = open-ended),
// consumed by the map_*_regulator builders.
function codeRows(codeMap) {
  const rows = [];
  for (const [canonical, spec] of Object.entries(codeMap)) {
    if (Array.isArray(spec)) {
      for (const v of spec) {
        rows.push({ canonical, code: v.code, valid_from: v.from || null, valid_to: v.to || null });
      }
    } else {
      rows.push({ canonical, code: spec, valid_from: null, valid_to: null });
    }
  }
  return rows;
}

// Every distinct code across all versions — for the valid_*_code rules: a
// code that was valid in ANY period is an acceptable value in a file.
function allCodes(codeMap) {
  const out = [];
  for (const spec of Object.values(codeMap)) {
    if (Array.isArray(spec)) out.push(...spec.map((v) => v.code));
    else out.push(spec);
  }
  return out;
}

// SQL scalar giving the effective rate for a DATE expression (constant → the
// number; versioned → a CASE over the schedule).
function rateSql(taxRate, dateExpr) {
  if (typeof taxRate === "number") return String(taxRate);
  const arms = taxRate.map((v) => {
    const conds = [];
    if (v.from) conds.push(`${dateExpr} >= DATE '${v.from}'`);
    if (v.to) conds.push(`${dateExpr} < DATE '${v.to}'`);
    return `WHEN ${conds.length ? conds.join(" AND ") : "TRUE"} THEN ${v.rate}`;
  });
  return `CASE ${arms.join(" ")} ELSE NULL END`;
}

// Temporal predicate for a map join: the row's [valid_from, valid_to) window
// must contain the report date. valid_from/valid_to are stored as strings
// (rowsToSelect), cast to DATE here; NULL = open-ended.
function temporalPredicate(alias, dateExpr) {
  return (
    ` AND (${alias}.valid_from IS NULL OR ${dateExpr} >= CAST(${alias}.valid_from AS DATE))` +
    ` AND (${alias}.valid_to IS NULL OR ${dateExpr} < CAST(${alias}.valid_to AS DATE))`
  );
}

module.exports = { codeRows, allCodes, rateSql, temporalPredicate };
