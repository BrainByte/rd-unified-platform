// Periodic regulator registers (e.g. Spain's DGOJ daily RUD / monthly RUT
// under the monitoring-system data model): fan-out per market from the
// periodicReports config. One table per register per market — a market
// without periodicReports materialises nothing here.
// REQ: requirements/dgoj-periodic-reporting (REQ-DGOJ-1, REQ-DGOJ-2, REQ-DGOJ-4)
const { jurisdictions } = require("includes/jurisdictions");
const { periodicReportQuery } = require("includes/queries");

for (const j of Object.values(jurisdictions)) {
  const mkt = j.code.toLowerCase();

  for (const r of j.periodicReports || []) {
    publish(`submission_${r.id.toLowerCase()}_${mkt}`, {
      type: "table",
      schema: j.dataset,
      tags: ["submissions", "periodic", j.code, r.cadence],
    }).query((ctx) => periodicReportQuery(ctx, j, r));
  }
}
