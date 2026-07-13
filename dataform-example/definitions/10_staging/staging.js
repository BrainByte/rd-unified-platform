// Dataform wiring only — SQL lives in includes/models.js (shared with
// the offline runner in local/run.js).
const m = require("includes/models");

publish("stg_accounts", {
  type: "view", schema: "staging", tags: ["staging"],
  description: "Latest state per account from CDC. Jurisdiction-agnostic.",
  assertions: { uniqueKey: ["account_id"], nonNull: ["account_id", "jurisdiction"] },
}).query((ctx) => m.stgAccounts(ctx));

publish("stg_bet_slip_events", {
  type: "view", schema: "staging", tags: ["staging"],
  description: "Clean append-only bet slip lifecycle event stream.",
  assertions: { uniqueKey: ["slip_id", "event_type"], nonNull: ["slip_id", "event_type", "event_ts"] },
}).query((ctx) => m.stgBetSlipEvents(ctx));

publish("stg_fixtures", {
  type: "view", schema: "staging", tags: ["staging"],
  description: "Latest state per fixture from CDC. Raw upstream names preserved untouched — canonicalisation happens in dim_fixture.",
  assertions: { uniqueKey: ["fixture_id"], nonNull: ["fixture_id", "sport_name_raw"] },
}).query((ctx) => m.stgFixtures(ctx));

publish("stg_reg_attributes", {
  type: "view", schema: "staging", tags: ["staging"],
  description: "Generic jurisdiction-attribute carrier (Option B), deduped latest-per-key. Market-specific data rides here instead of widening the core; the extension layer joins it into submission files.",
  assertions: { uniqueKey: ["entity_type", "entity_id", "attr_name"] },
}).query((ctx) => m.stgRegAttributes(ctx));

publish("stg_games", {
  type: "view", schema: "staging", tags: ["staging", "gaming"],
  description: "Latest game catalogue state from CDC. Raw provider game-type labels preserved.",
  assertions: { uniqueKey: ["game_id"], nonNull: ["game_id", "game_type_raw"] },
}).query((ctx) => m.stgGames(ctx));

publish("stg_game_rounds", {
  type: "view", schema: "staging", tags: ["staging", "gaming"],
  description: "Deduped casino game rounds with jackpot contributions.",
  assertions: { uniqueKey: ["round_id"], nonNull: ["round_id", "account_id", "wager"] },
}).query((ctx) => m.stgGameRounds(ctx));

publish("stg_poker_activity", {
  type: "view", schema: "staging", tags: ["staging", "gaming"],
  description: "Poker cash hands and tournament entries; rake/fee is the operator revenue.",
  assertions: { uniqueKey: ["activity_id"], nonNull: ["activity_id", "kind", "rake_or_fee"] },
}).query((ctx) => m.stgPokerActivity(ctx));

publish("stg_operator_jackpot_contributions", {
  type: "view", schema: "staging", tags: ["staging", "gaming", "operator_jackpot"],
  description: "Opt-in operator-jackpot contributions (unified-balance wagers on the phantom game), triggered by provider game rounds and sports bets.",
  assertions: { uniqueKey: ["contribution_id"], nonNull: ["contribution_id", "account_id", "jackpot_id", "game_id", "amount"] },
}).query((ctx) => m.stgOperatorJackpotContributions(ctx));

publish("stg_operator_jackpot_wins", {
  type: "view", schema: "staging", tags: ["staging", "gaming", "operator_jackpot"],
  description: "Operator-jackpot payouts, correlated to the phantom game so the win maps to a licensed vertical.",
  assertions: { uniqueKey: ["win_id"], nonNull: ["win_id", "account_id", "jackpot_id", "game_id", "amount"] },
}).query((ctx) => m.stgOperatorJackpotWins(ctx));
