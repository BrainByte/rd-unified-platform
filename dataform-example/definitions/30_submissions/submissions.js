// Fan-out: two tables per market (submission file + tax summary) from one
// definition. Regulatory constraints are NOT here — they're declarative
// rules in jurisdictions.js, compiled to assertions in 90_assertions/.
const { jurisdictions } = require("includes/jurisdictions");
const { submissionQuery, taxSummaryQuery } = require("includes/queries");

for (const j of Object.values(jurisdictions)) {
  const mkt = j.code.toLowerCase();

  publish(`submission_ready_${mkt}`, {
    type: "incremental",
    schema: j.dataset,
    bigquery: { partitionBy: "report_date" },
    tags: ["submissions", j.code, j.submissionCadence],
    uniqueKey: ["slip_id"],
  }).query((ctx) => submissionQuery(ctx, j));

  publish(`tax_summary_${mkt}`, {
    type: "table",
    schema: j.dataset,
    tags: ["submissions", j.code],
  }).query((ctx) => taxSummaryQuery(ctx, j));
}
