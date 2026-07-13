// ============================================================================
// QUERY BUILDERS — compose fields + filters into full statements.
// Pure functions: (ctx, jurisdictionConfig) => SQL string.
// No business decisions live here; those are in config, fields, filters.
// ============================================================================

const { selectFields, selectGamingFields } = require("./fields");
const { selectExtensionFields, extensionJoins } = require("./extensions");
const { rateSql, temporalPredicate } = require("./effective_dating");
const { statusFilter, jurisdictionFilter, reportDateExpr } = require("./filters");
const { admissibilityFilter } = require("./exceptions");

function fromClause(ctx, j) {
  return `
    FROM ${ctx.ref("fct_bet_slip_lifecycle")} b
    JOIN ${ctx.ref("dim_customer_account")} a
      ON b.account_id = a.account_id
    LEFT JOIN ${ctx.ref("dim_fixture")} f
      ON b.fixture_id = f.fixture_id
    LEFT JOIN ${ctx.ref("map_sport_regulator")} rm
      ON rm.jurisdiction = '${j.code}'
      AND rm.canonical_sport = f.canonical_sport${temporalPredicate("rm", reportDateExpr(j))}`;
}

function submissionQuery(ctx, j) {
  // Jurisdiction-specific attributes (Option B): appended only when the
  // market declares them, so files for markets without extensions — and the
  // shared core model — are byte-for-byte unchanged.
  const ext = selectExtensionFields(j);
  const extJoins = extensionJoins(ctx, j);
  return `
    SELECT
      '${j.code}' AS jurisdiction,
      ${reportDateExpr(j)} AS report_date,
      ${selectFields(j)}${ext ? `,\n      ${ext}` : ""}${fromClause(ctx, j)}${extJoins ? `\n    ${extJoins}` : ""}
    WHERE ${jurisdictionFilter(j)}
      AND ${statusFilter(j)}
      -- fault isolation: quarantined/held/incomplete entities are excluded here,
      -- so one bad row never blocks the file for everyone else.
      AND ${admissibilityFilter(ctx, j)}
  `;
}

// Tax rate is effective-dated: the rate in force for each report_date is
// applied, so a resubmission of a historical period uses the historical rate.
// The TAX BASE is config too (taxModel): 'ggr' taxes stake - payout;
// 'turnover' taxes the stakes themselves (Germany's 5.3% Wett-/Steuersatz
// on stakes under the RennwLottG). A new tax model = one arm here, zero
// per-market SQL.
function taxSummaryQuery(ctx, j) {
  const taxBase = j.taxModel === "turnover" ? "stake_sum" : "ggr_sum";
  return `
    SELECT
      jurisdiction, report_date, settled_slips,
      ROUND(stake_sum, ${j.rounding}) AS total_stake,
      ROUND(payout_sum, ${j.rounding}) AS total_payout,
      ROUND(${taxBase} * (${rateSql(j.taxRate, "report_date")}), ${j.rounding}) AS tax_due
    FROM (
      SELECT
        '${j.code}' AS jurisdiction,
        ${reportDateExpr(j)} AS report_date,
        COUNT(*) AS settled_slips,
        SUM(b.stake) AS stake_sum,
        SUM(b.payout) AS payout_sum,
        SUM(b.stake - b.payout) AS ggr_sum${fromClause(ctx, j)}
      WHERE ${jurisdictionFilter(j)}
        AND b.slip_status = 'SETTLED'   -- tax always on settled only
        AND ${admissibilityFilter(ctx, j)}   -- tax excludes held/quarantined/incomplete too
      GROUP BY 1, 2
    ) s
  `;
}

// ---- GAMING domain ----
function gamingFromClause(ctx, j) {
  return `
    FROM ${ctx.ref("fct_gaming_activity")} g
    JOIN ${ctx.ref("dim_customer_account")} a
      ON g.account_id = a.account_id
    LEFT JOIN ${ctx.ref("dim_game")} gm
      ON g.game_id = gm.game_id
    LEFT JOIN ${ctx.ref("map_game_regulator")} grm
      ON grm.jurisdiction = '${j.code}'
      AND grm.canonical_game_type = gm.canonical_game_type${temporalPredicate("grm", gamingReportDateExpr(j))}`;
}

function gamingReportDateExpr(j) {
  const dialect = require("./dialect");
  return dialect.localDate("g.occurred_at", j.timezone);
}

function gamingSubmissionQuery(ctx, j) {
  return `
    SELECT
      '${j.code}' AS jurisdiction,
      ${gamingReportDateExpr(j)} AS report_date,
      ${selectGamingFields(j)}${gamingFromClause(ctx, j)}
    WHERE ${jurisdictionFilter(j)}
  `;
}

// Flat GGR tax per market cadence (MGA 5%, DGOJ 20%), summed over the
// per-row gaming_ggr which already encodes vertical + jackpot mechanics.
function gamingTaxSummaryQuery(ctx, j) {
  const casino = j.jackpotPolicy === "deduct_contributions"
    ? `g.stake - g.payout - g.jackpot_contribution`
    : `g.stake - g.payout`;
  const ggr = `CASE WHEN g.vertical = 'CASINO_ROUND' THEN ${casino} ` +
    `WHEN g.vertical = 'OPERATOR_JACKPOT' THEN g.stake - g.payout ELSE g.rake_or_fee END`;
  return `
    SELECT
      jurisdiction, report_date, activities,
      ROUND(stake_sum, ${j.rounding}) AS total_stake,
      ROUND(payout_sum, ${j.rounding}) AS total_payout,
      ROUND(ggr_sum, ${j.rounding}) AS total_ggr,
      ROUND(ggr_sum * (${rateSql(j.gamingTaxRate, "report_date")}), ${j.rounding}) AS gaming_tax_due
    FROM (
      SELECT
        '${j.code}' AS jurisdiction,
        ${gamingReportDateExpr(j)} AS report_date,
        COUNT(*) AS activities,
        SUM(g.stake) AS stake_sum,
        SUM(g.payout) AS payout_sum,
        SUM(${ggr}) AS ggr_sum${gamingFromClause(ctx, j)}
      WHERE ${jurisdictionFilter(j)}
      GROUP BY 1, 2
    ) s
  `;
}

module.exports = { submissionQuery, taxSummaryQuery, gamingSubmissionQuery, gamingTaxSummaryQuery };
