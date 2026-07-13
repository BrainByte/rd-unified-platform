// Fan-out: one submission_ready table per market, from ONE definition.
const { jurisdictions } = require("includes/jurisdictions");
const { submissionQuery } = require("includes/common");

for (const j of Object.values(jurisdictions)) {
  if (j.customSubmission) continue; // handled by overrides/

  publish(`submission_ready_${j.code.toLowerCase()}`, {
    type: "incremental",
    schema: j.dataset, // hard per-market dataset isolation (per-market IAM)
    bigquery: {
      partitionBy: "report_date",
      clusterBy: ["game_type"],
    },
    tags: ["submissions", j.code, j.submissionCadence],
    assertions: {
      nonNull: ["bet_id", "report_date", "stake"],
      uniqueKey: ["bet_id"],
    },
    uniqueKey: ["bet_id"],
  }).query((ctx) => submissionQuery(ctx, j));
}
