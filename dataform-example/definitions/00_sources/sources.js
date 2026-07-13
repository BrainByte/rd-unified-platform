// CDC landing tables (populated by Datastream from SQL Server).
// Every table carries CDC metadata: _op (I/U/D), _commit_ts.
const sources = [
  "cdc_accounts",          // customer account domain
  "cdc_bet_slips",         // bet slip header (current row image)
  "cdc_fixtures",          // sporting events: sport, competition, participants
  "cdc_bet_slip_events",   // append-only lifecycle events: PLACED / SETTLED / VOIDED
  "cdc_reg_attributes",    // generic jurisdiction-attribute carrier (Option B): entity/attr key-value
  "cdc_games",             // game catalogue: provider, dirty game-type labels
  "cdc_netent_rounds",         // NetEnt: round grain, EUR, jackpot fields embedded
  "cdc_evolution_transactions",// Evolution live: BET/WIN transactions, cents
  "cdc_playtech_rounds",       // Playtech: round grain, own game codes
  "cdc_aggregator_rounds",     // long-tail studios via aggregator (sub_provider)
  "cdc_provider_statements",   // daily provider-reported GGR (revenue share)
  "cdc_player_limits",         // player-set deposit limits (+ revocations)
  "cdc_self_exclusions",       // operator-level + national register (RGIAJ)
  "cdc_verifications",         // KYC identity check events
  "cdc_payments",              // deposits & withdrawals with status lifecycle
  "cdc_poker_activity",    // poker cash hands + tournament entries (rake / fees)
  "cdc_jackpot_pools",     // progressive pools: seed amount, contribution rate
  "cdc_jackpot_wins",      // jackpot payouts (paid from pool, not GGR)
  "cdc_operator_jackpot_pools",         // operator-run opt-in jackpot pools (seed)
  "cdc_jackpot_optins",                 // player opt-in lifecycle for operator jackpots
  "cdc_operator_jackpot_contributions", // unified-balance contributions (gaming + sports triggers)
  "cdc_operator_jackpot_wins",          // operator jackpot payouts (correlated to the phantom game)
  "cdc_game_round_voids",               // provider round rollbacks/voids (drive the refund cascade)
  "cdc_account_addresses",   // customer addresses (postcode validated per market)
  "cdc_postcode_regions",    // postcode-prefix -> region reference (lookup; may lag)
  "cdc_source_watermarks",   // per-source completeness watermarks (differential-speed data)
  "cdc_exception_state",     // persisted retry state across runs (the pipeline's memory)
];

for (const name of sources) {
  declare({ schema: "cdc_landing", name });
}
