// Session reporting fan-out: submission_sessions_{mkt} for every market
// with a sessionReporting block, at that market's configured granularity
// (NL per_game — one row per derived game session incl. the operator-
// jackpot shadow session; PT platform — one row per ended login with its
// end reason). A market without the block materialises NOTHING here —
// that is the emit-sql acceptance check.
// REQ: requirements/session-tracking (REQ-ST-2, REQ-ST-3, REQ-ST-7)
const { jurisdictions } = require("includes/jurisdictions");
const { sessionSubmissionQuery } = require("includes/queries");

for (const j of Object.values(jurisdictions)) {
  if (!j.sessionReporting) continue;
  const mkt = j.code.toLowerCase();

  publish(`submission_sessions_${mkt}`, {
    type: "table",
    schema: j.dataset,
    tags: ["submissions", "sessions", j.code, j.sessionReporting.granularity],
  }).query((ctx) => sessionSubmissionQuery(ctx, j));
}
