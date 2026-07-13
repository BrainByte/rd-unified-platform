// Rule-driven assertions over the periodic registers, generated from
// jurisdictions.js exactly like assertions_from_rules.js — plus, for any
// market filing BOTH a daily and a monthly register, the structural
// completeness assertion: the monthly totals must equal the sum of the
// dailies for every player and month. A failure blocks the pipeline
// BEFORE any register is filed.
// REQ: requirements/dgoj-periodic-reporting (REQ-DGOJ-3, REQ-DGOJ-4)
const { jurisdictions, commonPeriodicRules } = require("includes/jurisdictions");
const { periodicRules, violationQuery } = require("includes/rules");
const { periodicCompletenessQuery } = require("includes/queries");

for (const j of Object.values(jurisdictions)) {
  const reports = j.periodicReports || [];
  const mkt = j.code.toLowerCase();

  for (const r of reports) {
    const table = `submission_${r.id.toLowerCase()}_${mkt}`;
    for (const rule of periodicRules(r, commonPeriodicRules)) {
      assert(`periodic_rule_${mkt}_${r.id.toLowerCase()}_${rule.id.toLowerCase().replace(/-/g, "_")}`, (ctx) =>
        violationQuery(ctx, j, rule, { table, keyColumn: "player_ref", dateColumn: "period_start" })
      )
        .tags(["rules", "periodic", j.code])
        .description(`${rule.id}: ${rule.description}`);
    }
  }

  const daily = reports.find((r) => r.cadence === "daily");
  const monthly = reports.find((r) => r.cadence === "monthly");
  if (daily && monthly) {
    assert(`periodic_completeness_${mkt}`, (ctx) =>
      periodicCompletenessQuery(ctx, j, daily, monthly)
    )
      .tags(["rules", "periodic", j.code])
      .description(
        `${monthly.id} totals must equal the sum of the ${daily.id} dailies for every player-month (REQ-DGOJ-3)`);
  }
}
