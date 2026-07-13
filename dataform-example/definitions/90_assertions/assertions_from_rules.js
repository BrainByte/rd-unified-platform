// Rule-driven assertions: one Dataform assertion per regulatory rule per
// market, generated from jurisdictions.js. A failing assertion blocks the
// pipeline BEFORE any file reaches a regulator.
//
// Naming: rule_{market}_{rule_id} — e.g. rule_mt_mt_103 — so a failure in
// the Dataform UI points straight at the regulatory clause.
const { jurisdictions, commonRules } = require("includes/jurisdictions");
const { marketRules, violationQuery } = require("includes/rules");
const { validateAll } = require("includes/validate");

// Fail compilation loudly if config is invalid — nothing deploys.
const configErrors = validateAll(jurisdictions, commonRules);
if (configErrors.length) {
  throw new Error("Invalid jurisdiction config:\n" + configErrors.join("\n"));
}

for (const j of Object.values(jurisdictions)) {
  const mkt = j.code.toLowerCase();

  for (const rule of marketRules(j, commonRules)) {
    assert(`rule_${mkt}_${rule.id.toLowerCase().replace(/-/g, "_")}`, (ctx) =>
      violationQuery(ctx, j, rule)
    )
      .tags(["rules", j.code])
      .description(`${rule.id}: ${rule.description}`);
  }
}
