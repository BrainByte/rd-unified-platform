// Single source of truth for all per-market regulatory variance.
// RULE: market differences live HERE, never in SQL.
// Two markets shown as examples — extend to all 17.

const jurisdictions = {
  MT: {
    code: "MT",
    dataset: "reporting_mt",
    currency: "EUR",
    rounding: 2,
    taxModel: "ggr",
    taxRate: 0.05,
    submissionCadence: "daily",
    timezone: "Europe/Malta",
    settlementCutoffLocal: "23:59:59",
    reportFields: ["bet_id", "player_id", "game_type", "stake", "payout", "ggr"],
    excludeGameTypes: [],
    customSubmission: false,   // true => fan-out loop skips, override SQLX used
    legacySourceTable: "legacy_capture.legacy_submitted_mt",
    reconKey: ["bet_id", "report_date"],
    reconTolerance: 0.005,
  },

  ES: {
    code: "ES",
    dataset: "reporting_es",
    currency: "EUR",
    rounding: 2,
    taxModel: "turnover_by_vertical",
    taxRatesByVertical: { sports: 0.2, casino: 0.2, poker: 0.25 },
    submissionCadence: "daily", // monthly file handled by override
    timezone: "Europe/Madrid",
    settlementCutoffLocal: "23:59:59",
    reportFields: ["bet_id", "player_dni_hash", "game_type", "stake", "payout"],
    excludeGameTypes: ["free_spin"],
    customSubmission: false,
    hasMonthlyOverride: true,  // see overrides/submission_es_monthly.sqlx
    legacySourceTable: "legacy_capture.legacy_submitted_es",
    reconKey: ["bet_id", "report_date"],
    reconTolerance: 0.005,
  },

  // ...add remaining 15 markets here
};

module.exports = { jurisdictions };
