// Player protection & payments wiring — SQL in includes/player_protection.js.
// The three rg_breach_* models are compliance crown jewels: any row is a
// regulatory breach, so each has a zero-rows assertion that blocks the run.
const pp = require("includes/player_protection");

publish("stg_player_limits", {
  type: "view", schema: "staging", tags: ["staging", "player_protection"],
  assertions: { uniqueKey: ["limit_id"], nonNull: ["limit_id", "account_id", "limit_type", "amount"] },
}).query((ctx) => pp.stgPlayerLimits(ctx));

publish("stg_self_exclusions", {
  type: "view", schema: "staging", tags: ["staging", "player_protection"],
  assertions: {
    uniqueKey: ["exclusion_id"], nonNull: ["exclusion_id", "account_id", "source", "start_ts"],
    rowConditions: ["end_ts IS NULL OR end_ts > start_ts"],
  },
}).query((ctx) => pp.stgSelfExclusions(ctx));

publish("stg_verifications", {
  type: "view", schema: "staging", tags: ["staging", "player_protection"],
  assertions: { uniqueKey: ["verification_id"], nonNull: ["verification_id", "account_id", "status"] },
}).query((ctx) => pp.stgVerifications(ctx));

publish("stg_payments", {
  type: "view", schema: "staging", tags: ["staging", "payments"],
  assertions: {
    uniqueKey: ["payment_id"], nonNull: ["payment_id", "account_id", "direction", "amount"],
    rowConditions: [
      "amount > 0",
      "status != 'COMPLETED' OR completed_ts IS NOT NULL",
    ],
  },
}).query((ctx) => pp.stgPayments(ctx));

publish("fct_payments", {
  type: "table", schema: "core", tags: ["core", "payments"],
  bigquery: { partitionBy: "DATE(requested_ts)", clusterBy: ["jurisdiction", "direction"] },
  assertions: { uniqueKey: ["payment_id"] },
}).query((ctx) => pp.fctPayments(ctx));

publish("dim_player_compliance", {
  type: "table", schema: "core", tags: ["core", "player_protection"],
  description: "Per-player compliance status: latest identity verification, open exclusions, active personal deposit limits.",
  assertions: { uniqueKey: ["account_id"] },
}).query((ctx) => pp.dimPlayerCompliance(ctx));

publish("fct_wallet_ledger", {
  type: "table", schema: "core", tags: ["core", "payments", "wallet"],
  description: "Unified wallet: every money movement (deposits, withdrawals, bet stakes/payouts, gaming stakes/payouts, operator-jackpot contributions/wins) as a signed amount on one balance.",
  bigquery: { partitionBy: "DATE(ts)", clusterBy: ["entry_type"] },
}).query((ctx) => pp.fctWalletLedger(ctx));

publish("dim_wallet_balance", {
  type: "table", schema: "core", tags: ["core", "payments", "wallet"],
  description: "Current unified balance per player = sum of all wallet movements.",
  assertions: { uniqueKey: ["account_id"] },
}).query((ctx) => pp.dimWalletBalance(ctx));

publish("fct_player_gambling_activity", {
  type: "table", schema: "core", tags: ["core", "player_protection"],
  description: "Unified wagering grain: settled bets + all gaming activity (incl. operator-jackpot contributions/wins). The loss/affordability base, so contributions count toward loss limits.",
  bigquery: { partitionBy: "DATE(occurred_at)", clusterBy: ["jurisdiction", "source"] },
}).query((ctx) => pp.fctPlayerGamblingActivity(ctx));

publish("rg_effective_deposit_limits", {
  type: "table", schema: "core", tags: ["core", "player_protection"],
  description: "Effective limit per player per period = null-safe MIN(personal, statutory default). NULL = no cap applies.",
  assertions: { uniqueKey: ["account_id", "period"] },
}).query((ctx) => pp.rgEffectiveDepositLimits(ctx));

// ---- breach models + zero-rows assertions ----

publish("rg_breach_deposit_limits", {
  type: "table", schema: "compliance", tags: ["player_protection", "breach"],
  description: "Deposits exceeding the effective daily/weekly/monthly limit in any market-local window. MUST be empty.",
}).query((ctx) => pp.rgBreachDepositLimits(ctx));

publish("rg_breach_loss_limits", {
  type: "table", schema: "compliance", tags: ["player_protection", "breach"],
  description: "Net loss (staked - won across bets AND gaming, incl. operator-jackpot contributions) exceeding the player's LOSS limit in any market-local window. MUST be empty.",
}).query((ctx) => pp.rgBreachLossLimits(ctx));

publish("rg_breach_wallet_overspend", {
  type: "table", schema: "compliance", tags: ["player_protection", "breach"],
  description: "Sufficient-balance spend gate: any point where a player's running unified-wallet balance goes negative (a spend the wallet couldn't cover). MUST be empty.",
}).query((ctx) => pp.rgBreachWalletOverspend(ctx));

publish("rg_breach_activity_while_excluded", {
  type: "table", schema: "compliance", tags: ["player_protection", "breach"],
  description: "Any deposit, bet or gaming activity inside a self-exclusion window (RGIAJ = breach of national law). MUST be empty.",
}).query((ctx) => pp.rgBreachActivityWhileExcluded(ctx));

publish("rg_breach_unverified_withdrawals", {
  type: "table", schema: "compliance", tags: ["player_protection", "breach"],
  description: "Withdrawals completed before identity verification (KYC/AML). MUST be empty.",
}).query((ctx) => pp.rgBreachUnverifiedWithdrawals(ctx));

// REQ: requirements/max-stake-limits (REQ-MSL-5)
publish("rg_breach_stake_limits", {
  type: "table", schema: "compliance", tags: ["player_protection", "breach"],
  description: "Gaming stakes above the effective cap in force when staked: statutory slots bands (age-banded, effective-dated, per market) null-safe-min the player's personal STAKE_CASINO limit. MUST be empty.",
}).query((ctx) => pp.rgBreachStakeLimits(ctx));

// NOTE: under quarantine-first (see definitions/40_exceptions), a breach no
// longer hard-aborts the run — the breaching entity is HELD (fct_exceptions)
// and excluded from its file, while everyone else ships. The breach detectors
// above are consumed there as COMPLIANCE holds. The single hard assertion that
// remains is the isolation gate (assert_no_blocked_entity_in_*).
