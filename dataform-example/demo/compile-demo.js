// Local pre-flight: validates config and prints all generated SQL —
// submissions, tax summaries, and every rule-driven assertion —
// without touching BigQuery.
//
//   node demo/compile-demo.js

const { jurisdictions, commonRules } = require("../includes/jurisdictions");
const { submissionQuery, taxSummaryQuery } = require("../includes/queries");
const { marketRules, violationQuery } = require("../includes/rules");
const { validateAll } = require("../includes/validate");

const fakeCtx = { ref: (name) => `\`core.${name}\`` };

// 1. Config validation — same check that gates real compilation.
const errors = validateAll(jurisdictions, commonRules);
if (errors.length) {
  console.error("✘ Config errors:\n" + errors.map((e) => "  " + e).join("\n"));
  process.exit(1);
}
console.log("✔ Config valid for all markets\n");

// 2. Generated SQL per market.
for (const j of Object.values(jurisdictions)) {
  const mkt = j.code.toLowerCase();
  console.log("=".repeat(70));
  console.log(`MARKET ${j.code} — includeVoided=${j.includeVoided}, tax=${j.taxRate}`);
  console.log("=".repeat(70));

  console.log(`\n--- submission_ready_${mkt} ---`);
  console.log(submissionQuery(fakeCtx, j));

  console.log(`--- tax_summary_${mkt} ---`);
  console.log(taxSummaryQuery(fakeCtx, j));

  console.log(`--- rule assertions (${marketRules(j, commonRules).length}) ---`);
  for (const rule of marketRules(j, commonRules)) {
    console.log(`\n[${rule.id}] ${rule.description}`);
    console.log(violationQuery(fakeCtx, j, rule).trimEnd());
  }
  console.log();
}
