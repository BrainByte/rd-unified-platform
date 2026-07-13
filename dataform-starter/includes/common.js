// Shared SQL generators. Pure functions: config in, SQL string out.
// Keep each function small and traceable — if you can't follow config
// to compiled SQL in under a minute, refactor.

// The ONLY place local-time settlement windows are computed.
function settlementWindow(j, reportDateExpr = "@report_date") {
  return `
    settled_at >= TIMESTAMP(DATETIME(${reportDateExpr}, TIME '00:00:00'), '${j.timezone}')
    AND settled_at <  TIMESTAMP(DATETIME(DATE_ADD(${reportDateExpr}, INTERVAL 1 DAY), TIME '00:00:00'), '${j.timezone}')
  `;
}

function excludeGameTypes(j) {
  if (!j.excludeGameTypes || j.excludeGameTypes.length === 0) return "";
  const list = j.excludeGameTypes.map((g) => `'${g}'`).join(", ");
  return `AND game_type NOT IN (${list})`;
}

// Per-field SQL expressions. Add derived fields here, never inline in SQLX.
const fieldExpressions = {
  bet_id: "bet_id",
  player_id: "player_id",
  player_dni_hash: "TO_HEX(SHA256(CAST(player_national_id AS STRING)))",
  game_type: "game_type",
  stake: (j) => `ROUND(stake, ${j.rounding})`,
  payout: (j) => `ROUND(payout, ${j.rounding})`,
  ggr: (j) => `ROUND(stake - payout, ${j.rounding})`,
};

function selectFields(j) {
  return j.reportFields
    .map((f) => {
      const expr = fieldExpressions[f];
      if (!expr) throw new Error(`No expression defined for field '${f}' (market ${j.code})`);
      const sql = typeof expr === "function" ? expr(j) : expr;
      return `${sql} AS ${f}`;
    })
    .join(",\n      ");
}

function taxCalc(j) {
  switch (j.taxModel) {
    case "ggr":
      return `ROUND(SUM(stake - payout) * ${j.taxRate}, ${j.rounding})`;
    case "turnover_by_vertical":
      const cases = Object.entries(j.taxRatesByVertical)
        .map(([v, r]) => `WHEN vertical = '${v}' THEN stake * ${r}`)
        .join("\n        ");
      return `ROUND(SUM(CASE ${cases} ELSE 0 END), ${j.rounding})`;
    default:
      throw new Error(`Unknown taxModel '${j.taxModel}' (market ${j.code})`);
  }
}

// The core submission-ready query, used by the fan-out loop.
function submissionQuery(ctx, j) {
  return `
    SELECT
      '${j.code}' AS jurisdiction,
      DATE(settled_at, '${j.timezone}') AS report_date,
      ${selectFields(j)},
      settled_at
    FROM ${ctx.ref("fct_settled_bets")}
    WHERE jurisdiction = '${j.code}'
      ${excludeGameTypes(j)}
  `;
}

module.exports = { settlementWindow, excludeGameTypes, selectFields, taxCalc, submissionQuery };
