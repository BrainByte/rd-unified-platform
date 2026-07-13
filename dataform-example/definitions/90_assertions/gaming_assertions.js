// Rule-driven assertions for the GAMING files, mirroring the betting
// pattern: one assertion per rule per market, targeting
// gaming_submission_ready_{mkt} keyed on activity_id.
const { jurisdictions, commonRules, commonGamingRules } = require("includes/jurisdictions");
const { marketGamingRules, violationQuery } = require("includes/rules");
const { validateAll } = require("includes/validate");

const configErrors = validateAll(jurisdictions, commonRules, commonGamingRules);
if (configErrors.length) {
  throw new Error("Invalid jurisdiction config:\n" + configErrors.join("\n"));
}

for (const j of Object.values(jurisdictions)) {
  if (!j.gamingNomenclature) continue;
  const mkt = j.code.toLowerCase();

  for (const rule of marketGamingRules(j, commonGamingRules)) {
    assert(`gaming_rule_${mkt}_${rule.id.toLowerCase().replace(/-/g, "_")}`, (ctx) =>
      violationQuery(ctx, j, rule, {
        table: `gaming_submission_ready_${mkt}`,
        keyColumn: "activity_id",
      })
    )
      .tags(["rules", "gaming", j.code])
      .description(`${rule.id}: ${rule.description}`);
  }
}
