// Dataform wiring only — SQL lives in includes/models.js.
const m = require("includes/models");

publish("dim_customer_account", {
  type: "table", schema: "core", tags: ["core"],
  description: "Customer account dimension. Carries jurisdiction but never branches on it.",
  bigquery: { clusterBy: ["jurisdiction"] },
  assertions: { uniqueKey: ["account_id"] },
}).query((ctx) => m.dimCustomerAccount(ctx));

publish("fct_bet_slip_lifecycle", {
  type: "table", schema: "core", tags: ["core"],
  description: "One row per bet slip with full lifecycle: placed -> settled | voided.",
  bigquery: { partitionBy: "DATE(placed_at)", clusterBy: ["slip_status"] },
  assertions: {
    uniqueKey: ["slip_id"],
    nonNull: ["slip_id", "account_id", "placed_at", "slip_status"],
    rowConditions: [
      // lifecycle invariants — executable spec
      "slip_status != 'SETTLED' OR settled_at IS NOT NULL",
      "slip_status != 'VOIDED'  OR voided_at  IS NOT NULL",
      "slip_status != 'OPEN'    OR (settled_at IS NULL AND voided_at IS NULL)",
      "payout = 0 OR slip_status = 'SETTLED'",
      "settled_at IS NULL OR settled_at >= placed_at",
    ],
  },
}).query((ctx) => m.fctBetSlipLifecycle(ctx));
