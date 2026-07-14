// ============================================================================
// QUERY BUILDERS — compose fields + filters into full statements.
// Pure functions: (ctx, jurisdictionConfig) => SQL string.
// No business decisions live here; those are in config, fields, filters.
// ============================================================================

const { selectFields, selectGamingFields, fieldSql, selectPeriodicFields, selectSessionFields } = require("./fields");
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

// ---- PERIODIC REGISTERS (REQ: requirements/dgoj-periodic-reporting) ----
// One builder for every market and both cadences. A register totalises each
// player's SETTLED activity per period: daily registers group by the local
// report date, monthly ones by its month (via the dialect layer). The same
// admissibility filter as the event files applies — a quarantined/held/
// incomplete entity never reaches a register either.
function periodStartExpr(j, report) {
  const dialect = require("./dialect");
  const rd = reportDateExpr(j);
  return report.cadence === "monthly" ? dialect.dateTrunc("month", rd) : rd;
}

function periodicReportQuery(ctx, j, report) {
  return `
    SELECT
      '${j.code}' AS jurisdiction,
      '${report.id}' AS register_id,
      ${periodStartExpr(j, report)} AS period_start,
      ${fieldSql(report.playerField, j)} AS player_ref,
      ${selectPeriodicFields(report, j)}
    FROM ${ctx.ref("fct_bet_slip_lifecycle")} b
    JOIN ${ctx.ref("dim_customer_account")} a
      ON b.account_id = a.account_id
    WHERE ${jurisdictionFilter(j)}
      AND b.slip_status = 'SETTLED'   -- registers totalise settled activity only
      AND ${admissibilityFilter(ctx, j)}
    GROUP BY 1, 2, 3, 4
  `;
}

// Structural completeness (REQ-DGOJ-3): for every player and month, the
// monthly register's totals must equal the sum of that player's daily rows.
// Any mismatch — or a player-month present on one side only — is a violation
// that blocks the pipeline before filing. Works because every periodic
// registry field is additive (SUM/COUNT).
function periodicCompletenessQuery(ctx, j, daily, monthly) {
  const dialect = require("./dialect");
  const mkt = j.code.toLowerCase();
  const dailyTable = ctx.ref(`submission_${daily.id.toLowerCase()}_${mkt}`);
  const monthlyTable = ctx.ref(`submission_${monthly.id.toLowerCase()}_${mkt}`);
  const shared = monthly.fields.filter((f) => daily.fields.includes(f));
  const mismatch = shared.map((f) => `ABS(m.${f} - d.${f}) > 0.005`).join("\n       OR ");
  return `
    SELECT
      COALESCE(m.player_ref, d.player_ref) AS row_key,
      COALESCE(m.period_start, d.period_start) AS period_start
    FROM ${monthlyTable} m
    FULL OUTER JOIN (
      SELECT player_ref, ${dialect.dateTrunc("month", "period_start")} AS period_start,
             ${shared.map((f) => `SUM(${f}) AS ${f}`).join(", ")}
      FROM ${dailyTable}
      GROUP BY 1, 2
    ) d
      ON m.player_ref = d.player_ref AND m.period_start = d.period_start
    WHERE m.player_ref IS NULL OR d.player_ref IS NULL${mismatch ? `\n       OR ${mismatch}` : ""}
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

// ---- SESSION reporting (REQ: requirements/session-tracking, REQ-ST-2/3/4) ----
// One builder for both granularities — which one a market gets is CONFIG
// (sessionReporting.granularity). Only ENDED platform sessions are
// reportable (a session never re-opens, so ended = terminal state); the
// report date is the local date the platform session closed. Zero-activity
// logins are reported only where the market opts in (reportEmptySessions) —
// at per_game grain empty sessions have no derived rows by construction.
function sessionSubmissionQuery(ctx, j) {
  const dialect = require("./dialect");
  const sr = j.sessionReporting;
  const reportDate = dialect.localDate("p.ended_at", j.timezone);
  const emptyFilter = sr.reportEmptySessions ? "" : `\n      AND p.plays > 0`;
  if (sr.granularity === "per_game") {
    return `
    SELECT
      '${j.code}' AS jurisdiction,
      ${reportDate} AS report_date,
      ${selectSessionFields(j)}
    FROM ${ctx.ref("fct_game_sessions")} gs
    JOIN ${ctx.ref("fct_platform_sessions")} p ON gs.session_id = p.session_id
    JOIN ${ctx.ref("dim_customer_account")} a ON gs.account_id = a.account_id
    LEFT JOIN ${ctx.ref("dim_game")} gm ON gs.game_id = gm.game_id
    WHERE ${jurisdictionFilter(j)}
      AND p.ended_at IS NOT NULL${emptyFilter}
  `;
  }
  return `
    SELECT
      '${j.code}' AS jurisdiction,
      ${reportDate} AS report_date,
      ${selectSessionFields(j)}
    FROM ${ctx.ref("fct_platform_sessions")} p
    JOIN ${ctx.ref("dim_customer_account")} a ON p.account_id = a.account_id
    WHERE ${jurisdictionFilter(j)}
      AND p.ended_at IS NOT NULL${emptyFilter}
  `;
}

module.exports = {
  submissionQuery, taxSummaryQuery, gamingSubmissionQuery, gamingTaxSummaryQuery,
  periodicReportQuery, periodicCompletenessQuery, sessionSubmissionQuery,
};
