// Gaming domain wiring — SQL lives in includes/models.js and
// includes/queries.js; regulatory constraints in jurisdictions.js
// gamingRules, compiled by 90_assertions/gaming_assertions.js.
const m = require("includes/models");
const { jurisdictions } = require("includes/jurisdictions");
const { gamingSubmissionQuery, gamingTaxSummaryQuery } = require("includes/queries");

publish("dim_game", {
  type: "table", schema: "core", tags: ["core", "gaming"],
  description: "Game catalogue canonicalised via game-type aliases (NULL = unmapped, lands in queue).",
  bigquery: { clusterBy: ["canonical_game_type"] },
  assertions: { uniqueKey: ["game_id"] },
}).query((ctx) => m.dimGame(ctx));

publish("fct_gaming_activity", {
  type: "table", schema: "core", tags: ["core", "gaming"],
  description: "Unified gaming grain: casino rounds + poker hands + tournament entries, revenue mechanics normalised per vertical.",
  bigquery: { partitionBy: "DATE(occurred_at)", clusterBy: ["vertical"] },
  assertions: {
    uniqueKey: ["activity_id"],
    nonNull: ["activity_id", "account_id", "vertical", "stake"],
    rowConditions: [
      // executable revenue-mechanics spec
      "vertical != 'CASINO_ROUND' OR rake_or_fee = 0",
      "vertical = 'CASINO_ROUND' OR jackpot_contribution = 0",
      "jackpot_contribution >= 0",
      "rake_or_fee >= 0",
    ],
  },
}).query((ctx) => m.fctGamingActivity(ctx));

publish("fct_jackpot_liability", {
  type: "table", schema: "core", tags: ["core", "gaming", "jackpots"],
  description: "Per-pool liability: seed + wager contributions - wins. Pool balance must never go negative.",
  assertions: {
    uniqueKey: ["jackpot_id"],
    rowConditions: ["pool_balance >= 0"],
  },
}).query((ctx) => m.fctJackpotLiability(ctx));

publish("fct_operator_jackpot_contributions", {
  type: "table", schema: "core", tags: ["core", "gaming", "operator_jackpot"],
  description: "Operator-jackpot contributions with the void/refund cascade resolved: status = REFUNDED when the trigger (bet slip or round) was voided, else ACTIVE. Consumers use ACTIVE only.",
  assertions: { uniqueKey: ["contribution_id"] },
}).query((ctx) => m.fctOperatorJackpotContributions(ctx));

publish("fct_operator_jackpot_liability", {
  type: "table", schema: "core", tags: ["core", "gaming", "jackpots", "operator_jackpot"],
  description: "Operator-run opt-in jackpot liability: seed + unified-balance contributions - wins. Operator-owned (kept separate from the provider-funded pools). Balance must never go negative.",
  assertions: {
    uniqueKey: ["jackpot_id"],
    rowConditions: ["pool_balance >= 0"],
  },
}).query((ctx) => m.fctOperatorJackpotLiability(ctx));

publish("recon_provider_ggr", {
  type: "table", schema: "recon", tags: ["recon", "gaming", "providers"],
  description: "Provider revenue-share recon: internally recorded GGR vs provider-reported statements. Rows = breaks to dispute with the provider before paying the invoice.",
}).query((ctx) => m.reconProviderGgr(ctx));

publish("unmapped_game_types", {
  type: "view", schema: "reference", tags: ["reference", "gaming", "unmapped_queue"],
  description: "Gaming maintenance queue: provider game-type labels with no alias, ranked by betting impact. Resolve = one line in includes/nomenclature/aliases.js.",
}).query((ctx) => m.unmappedGameTypes(ctx));

// Fan-out: gaming submission + gaming tax summary per market.
for (const j of Object.values(jurisdictions)) {
  if (!j.gamingNomenclature) continue;
  const mkt = j.code.toLowerCase();

  publish(`gaming_submission_ready_${mkt}`, {
    type: "incremental", schema: j.dataset,
    bigquery: { partitionBy: "report_date" },
    tags: ["submissions", "gaming", j.code],
    uniqueKey: ["activity_id"],
  }).query((ctx) => gamingSubmissionQuery(ctx, j));

  publish(`gaming_tax_summary_${mkt}`, {
    type: "table", schema: j.dataset,
    tags: ["submissions", "gaming", j.code],
  }).query((ctx) => gamingTaxSummaryQuery(ctx, j));
}
