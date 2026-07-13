// Parallel-run diffs vs legacy SQL Server outputs. TEMPORARY per market:
// delete a market's entries here after cutover + fallback period.
// Gated by the parallel_run var so prod-post-cutover builds exclude them.
const { jurisdictions } = require("includes/jurisdictions");
const { legacyTotalsDiff, legacyRowDiff, legacyFieldDiff } = require("includes/recon");

if (dataform.projectConfig.vars.parallel_run === "true") {
  for (const j of Object.values(jurisdictions)) {
    if (!j.legacySourceTable) continue; // market not yet in parallel run

    const mkt = j.code.toLowerCase();

    publish(`recon_breaks_totals_${mkt}`, {
      type: "table",
      schema: "recon",
      tags: ["recon", "parallel_run", j.code],
    }).query((ctx) => legacyTotalsDiff(ctx, j));

    publish(`recon_breaks_rows_${mkt}`, {
      type: "table",
      schema: "recon",
      tags: ["recon", "parallel_run", j.code],
    }).query((ctx) => legacyRowDiff(ctx, j));

    publish(`recon_breaks_fields_${mkt}`, {
      type: "table",
      schema: "recon",
      tags: ["recon", "parallel_run", j.code],
    }).query((ctx) => legacyFieldDiff(ctx, j));

    // Cutover gate: assertion fails the pipeline if any break exists.
    assert(`assert_zero_breaks_${mkt}`, (ctx) => `
      SELECT * FROM ${ctx.ref(`recon_breaks_totals_${mkt}`)}
      UNION ALL SELECT * FROM ${ctx.ref(`recon_breaks_rows_${mkt}`)}
      UNION ALL SELECT * FROM ${ctx.ref(`recon_breaks_fields_${mkt}`)}
    `).tags(["recon", "cutover_gate", j.code]);
  }
}
