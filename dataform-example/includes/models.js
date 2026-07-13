// ============================================================================
// MODEL BUILDERS — the SQL for every staging/core/reference model.
// Single source of truth consumed by BOTH:
//   - Dataform definitions (definitions/**.js wire these into publish())
//   - the offline runner (local/run.js executes them in DuckDB)
// Pure functions: (ctx) => SQL string. ctx.ref resolves table references.
// ============================================================================

const { normaliseSql } = require("./nomenclature/mapping");

// ---- staging: dedupe CDC, one row per business key/event ----

function stgAccounts(ctx) {
  // date_of_birth: REQ requirements/max-stake-limits (REQ-MSL-7)
  return `
    SELECT account_id, jurisdiction, national_id, date_of_birth, kyc_status, opened_at
    FROM ${ctx.ref("cdc_accounts")}
    QUALIFY ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY _commit_ts DESC) = 1
      AND _op != 'D'
  `;
}

function stgBetSlipEvents(ctx) {
  return `
    SELECT slip_id, event_type, event_ts, stake, payout
    FROM ${ctx.ref("cdc_bet_slip_events")}
    WHERE event_type IN ('PLACED', 'SETTLED', 'VOIDED')
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY slip_id, event_type ORDER BY _commit_ts DESC
    ) = 1
  `;
}

function stgFixtures(ctx) {
  return `
    SELECT fixture_id, sport_name_raw, competition_raw, home_raw, away_raw, start_ts
    FROM ${ctx.ref("cdc_fixtures")}
    QUALIFY ROW_NUMBER() OVER (PARTITION BY fixture_id ORDER BY _commit_ts DESC) = 1
      AND _op != 'D'
  `;
}

// Generic jurisdiction-attribute carrier (Option B): arbitrary per-entity,
// per-market data lands here as (entity_type, entity_id, attr_name,
// attr_value) so market-specific requirements never widen a shared table.
// Deduped latest-per-key like every other CDC feed. Consumed by the
// extension layer (includes/extensions.js) via the submission builders.
function stgRegAttributes(ctx) {
  return `
    SELECT entity_type, entity_id, attr_name, attr_value
    FROM ${ctx.ref("cdc_reg_attributes")}
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY entity_type, entity_id, attr_name ORDER BY _commit_ts DESC
    ) = 1
      AND _op != 'D'
  `;
}

// ---- core: jurisdiction-agnostic dimensions and facts ----

function dimCustomerAccount(ctx) {
  return `
    SELECT account_id, jurisdiction, national_id, date_of_birth, kyc_status, opened_at
    FROM ${ctx.ref("stg_accounts")}
  `;
}

// One row per bet slip with full lifecycle. Invariants (enforced as
// assertions in definitions/20_core/core.js):
//   SETTLED => settled_at set; VOIDED => voided_at set; OPEN => neither;
//   payout only when SETTLED; void wins over settlement (payout forced 0).
function fctBetSlipLifecycle(ctx) {
  return `
    WITH lifecycle AS (
      SELECT
        slip_id,
        MIN(IF(event_type = 'PLACED',  event_ts, NULL)) AS placed_at,
        MIN(IF(event_type = 'SETTLED', event_ts, NULL)) AS settled_at,
        MIN(IF(event_type = 'VOIDED',  event_ts, NULL)) AS voided_at,
        MAX(IF(event_type = 'PLACED',  stake,  0)) AS stake,
        MAX(IF(event_type = 'SETTLED', payout, 0)) AS payout
      FROM ${ctx.ref("stg_bet_slip_events")}
      GROUP BY slip_id
    )
    SELECT
      l.slip_id,
      s.account_id,
      s.fixture_id,
      l.placed_at,
      l.settled_at,
      l.voided_at,
      CASE
        WHEN l.voided_at  IS NOT NULL THEN 'VOIDED'
        WHEN l.settled_at IS NOT NULL THEN 'SETTLED'
        ELSE 'OPEN'
      END AS slip_status,
      l.stake,
      IF(l.voided_at IS NOT NULL, 0, l.payout) AS payout
    FROM lifecycle l
    JOIN ${ctx.ref("cdc_bet_slips")} s USING (slip_id)
  `;
}

// Canonicalised fixture: sport via normalised alias join (NULL = unmapped);
// participant display names degrade gracefully to the raw upstream value.
function dimFixture(ctx) {
  return `
    SELECT
      s.fixture_id,
      s.start_ts,
      s.sport_name_raw,
      sa.canonical AS canonical_sport,
      s.competition_raw AS competition_name,
      COALESCE(hp.canonical_name, s.home_raw) AS home_name,
      COALESCE(ap.canonical_name, s.away_raw) AS away_name,
      hp.canonical_id AS home_participant_id,
      ap.canonical_id AS away_participant_id
    FROM ${ctx.ref("stg_fixtures")} s
    LEFT JOIN ${ctx.ref("ref_sport_aliases")} sa
      ON sa.alias_norm = ${normaliseSql("s.sport_name_raw")}
    LEFT JOIN ${ctx.ref("ref_participant_aliases")} hp
      ON hp.alias_norm = ${normaliseSql("s.home_raw")}
    LEFT JOIN ${ctx.ref("ref_participant_aliases")} ap
      ON ap.alias_norm = ${normaliseSql("s.away_raw")}
  `;
}

// THE MAINTENANCE LOOP: unmapped upstream sports ranked by betting impact.
function unmappedSports(ctx) {
  return `
    SELECT
      f.sport_name_raw,
      COUNT(DISTINCT f.fixture_id) AS fixtures_affected,
      COUNT(b.slip_id) AS slips_affected,
      MIN(f.start_ts) AS first_seen,
      MAX(f.start_ts) AS last_seen
    FROM ${ctx.ref("dim_fixture")} f
    LEFT JOIN ${ctx.ref("fct_bet_slip_lifecycle")} b
      ON b.fixture_id = f.fixture_id
    WHERE f.canonical_sport IS NULL
    GROUP BY f.sport_name_raw
    ORDER BY slips_affected DESC
  `;
}

// ---- gaming domain: casino rounds, poker, jackpots ----

function stgGames(ctx) {
  return `
    SELECT game_id, game_name, provider, provider_game_ref, game_type_raw
    FROM ${ctx.ref("cdc_games")}
    QUALIFY ROW_NUMBER() OVER (PARTITION BY game_id ORDER BY _commit_ts DESC) = 1
      AND _op != 'D'
  `;
}

// Casino rounds normalised from EVERY provider feed via the adapter
// layer (includes/providers.js): NetEnt/Playtech round-grain, Evolution
// transaction-grain in cents, long-tail studios via the aggregator.
function stgGameRounds(ctx) {
  return require("./providers").normalisedRounds(ctx);
}

// Provider revenue-share reconciliation (internal vs provider-reported
// GGR); rows are breaks/disputes.
function reconProviderGgr(ctx) {
  return require("./providers").providerGgrRecon(ctx);
}

function stgPokerActivity(ctx) {
  return `
    SELECT activity_id, account_id, game_id, kind, amount_in, amount_out, rake_or_fee, activity_ts
    FROM ${ctx.ref("cdc_poker_activity")}
    WHERE kind IN ('CASH_HAND', 'TOURNAMENT_ENTRY')
    QUALIFY ROW_NUMBER() OVER (PARTITION BY activity_id ORDER BY _commit_ts DESC) = 1
      AND _op != 'D'
  `;
}

// Operator-run opt-in jackpot: contributions (wagers on the phantom game)
// and wins (payouts), deduped from CDC like every other feed.
function stgOperatorJackpotContributions(ctx) {
  return `
    SELECT contribution_id, account_id, jackpot_id, game_id, trigger_type, trigger_ref, amount, contributed_at
    FROM ${ctx.ref("cdc_operator_jackpot_contributions")}
    QUALIFY ROW_NUMBER() OVER (PARTITION BY contribution_id ORDER BY _commit_ts DESC) = 1
      AND _op != 'D'
  `;
}

function stgOperatorJackpotWins(ctx) {
  return `
    SELECT win_id, jackpot_id, account_id, game_id, amount, win_ts
    FROM ${ctx.ref("cdc_operator_jackpot_wins")}
    QUALIFY ROW_NUMBER() OVER (PARTITION BY win_id ORDER BY _commit_ts DESC) = 1
      AND _op != 'D'
  `;
}

// Operator-jackpot contributions with the VOID/REFUND CASCADE resolved: a
// contribution is REFUNDED when its trigger event was voided — a bet slip
// voided in the lifecycle (SPORTS_BET) or a rolled-back round (GAMING_ROUND).
// Refunded contributions are reversed out of the pool, GGR/tax and the loss
// base (consumers filter status = 'ACTIVE'); the REFUNDED rows stay as an
// audit trail. This is a core model (it reads fct_bet_slip_lifecycle).
function fctOperatorJackpotContributions(ctx) {
  return `
    SELECT
      c.contribution_id, c.account_id, c.jackpot_id, c.game_id,
      c.trigger_type, c.trigger_ref, c.amount, c.contributed_at,
      CASE
        WHEN c.trigger_type = 'SPORTS_BET'   AND vb.slip_id  IS NOT NULL THEN 'REFUNDED'
        WHEN c.trigger_type = 'GAMING_ROUND' AND vr.round_id IS NOT NULL THEN 'REFUNDED'
        ELSE 'ACTIVE'
      END AS status
    FROM ${ctx.ref("stg_operator_jackpot_contributions")} c
    LEFT JOIN (
      SELECT slip_id FROM ${ctx.ref("fct_bet_slip_lifecycle")} WHERE slip_status = 'VOIDED'
    ) vb ON c.trigger_type = 'SPORTS_BET' AND c.trigger_ref = vb.slip_id
    LEFT JOIN (
      SELECT DISTINCT round_id FROM ${ctx.ref("cdc_game_round_voids")}
    ) vr ON c.trigger_type = 'GAMING_ROUND' AND c.trigger_ref = vr.round_id
  `;
}

// Game catalogue canonicalised via the same alias machinery as sports.
function dimGame(ctx) {
  return `
    SELECT
      g.game_id,
      g.game_name,
      g.provider,
      g.game_type_raw,
      ga.canonical AS canonical_game_type   -- NULL = unmapped, lands in queue
    FROM ${ctx.ref("stg_games")} g
    LEFT JOIN ${ctx.ref("ref_game_type_aliases")} ga
      ON ga.alias_norm = ${normaliseSql("g.game_type_raw")}
  `;
}

// Unified gaming activity: one row per casino round / poker hand /
// tournament entry, with the revenue mechanics normalised:
//   CASINO_ROUND: stake=wager, payout=win, rake_or_fee=0, contribution kept
//   POKER_CASH: stake=pot contribution, payout=pot won, rake carried
//   POKER_TOURNAMENT: stake=buy-in incl. fee, payout=winnings, fee carried
function fctGamingActivity(ctx) {
  return `
    SELECT
      round_id AS activity_id,
      account_id,
      game_id,
      'CASINO_ROUND' AS vertical,
      wager AS stake,
      payout,
      0 AS rake_or_fee,
      jackpot_contribution,
      jackpot_id,
      round_ts AS occurred_at
    FROM ${ctx.ref("stg_game_rounds")}
    UNION ALL
    SELECT
      activity_id,
      account_id,
      game_id,
      CASE kind WHEN 'CASH_HAND' THEN 'POKER_CASH' ELSE 'POKER_TOURNAMENT' END AS vertical,
      amount_in AS stake,
      amount_out AS payout,
      rake_or_fee,
      0 AS jackpot_contribution,
      CAST(NULL AS STRING) AS jackpot_id,
      activity_ts AS occurred_at
    FROM ${ctx.ref("stg_poker_activity")}
    UNION ALL
    -- OPERATOR JACKPOT contributions: each is a wager on the phantom game.
    -- Booked as gaming activity so it flows into the gaming file, GGR/tax,
    -- the licensing rule (no_unlicensed_games) AND the exclusion breach
    -- detector — a sports-triggered contribution correlates to a GAME here.
    SELECT
      contribution_id AS activity_id,
      account_id,
      game_id,
      'OPERATOR_JACKPOT' AS vertical,
      amount AS stake,
      0 AS payout,
      0 AS rake_or_fee,
      0 AS jackpot_contribution,
      CAST(NULL AS STRING) AS jackpot_id,
      contributed_at AS occurred_at
    FROM ${ctx.ref("fct_operator_jackpot_contributions")}
    WHERE status = 'ACTIVE'   -- refunded contributions (voided triggers) reversed out
    UNION ALL
    -- OPERATOR JACKPOT wins: the payout, correlated to the phantom game.
    SELECT
      win_id AS activity_id,
      account_id,
      game_id,
      'OPERATOR_JACKPOT' AS vertical,
      0 AS stake,
      amount AS payout,
      0 AS rake_or_fee,
      0 AS jackpot_contribution,
      CAST(NULL AS STRING) AS jackpot_id,
      win_ts AS occurred_at
    FROM ${ctx.ref("stg_operator_jackpot_wins")}
  `;
}

// Progressive jackpot liability per pool:
//   balance = seed + contributions diverted from wagers - wins paid out.
// Wins are paid FROM the pool (never operator GGR); the pool reseeds on
// win — real networks (e.g. the $1m-seeded wide-area progressives) work
// this way. Balance must never go negative (checked in expectations).
function fctJackpotLiability(ctx) {
  return `
    SELECT
      p.jackpot_id,
      p.jackpot_name,
      p.seed_amount,
      p.contribution_rate,
      COALESCE(c.total_contributions, 0) AS total_contributions,
      COALESCE(w.total_wins, 0) AS total_wins,
      p.seed_amount + COALESCE(c.total_contributions, 0) - COALESCE(w.total_wins, 0) AS pool_balance
    FROM ${ctx.ref("cdc_jackpot_pools")} p
    LEFT JOIN (
      SELECT jackpot_id, SUM(jackpot_contribution) AS total_contributions
      FROM ${ctx.ref("stg_game_rounds")}
      WHERE jackpot_id IS NOT NULL
      GROUP BY jackpot_id
    ) c ON c.jackpot_id = p.jackpot_id
    LEFT JOIN (
      SELECT jackpot_id, SUM(amount) AS total_wins
      FROM ${ctx.ref("cdc_jackpot_wins")}
      GROUP BY jackpot_id
    ) w ON w.jackpot_id = p.jackpot_id
  `;
}

// Operator jackpot pool liability: like the provider pools, the operator
// pool balance = seed + opt-in contributions - wins, and must never go
// negative. Kept SEPARATE from fct_jackpot_liability (which is provider-
// funded, wager-diverted) because this pool is operator-owned and funded by
// distinct unified-balance contributions across gaming AND sports.
function fctOperatorJackpotLiability(ctx) {
  return `
    SELECT
      p.jackpot_id,
      p.jackpot_name,
      p.seed_amount,
      COALESCE(c.total_contributions, 0) AS total_contributions,
      COALESCE(w.total_wins, 0) AS total_wins,
      p.seed_amount + COALESCE(c.total_contributions, 0) - COALESCE(w.total_wins, 0) AS pool_balance
    FROM ${ctx.ref("cdc_operator_jackpot_pools")} p
    LEFT JOIN (
      SELECT jackpot_id, SUM(amount) AS total_contributions
      FROM ${ctx.ref("fct_operator_jackpot_contributions")}
      WHERE status = 'ACTIVE'   -- refunded contributions don't fund the pool
      GROUP BY jackpot_id
    ) c ON c.jackpot_id = p.jackpot_id
    LEFT JOIN (
      SELECT jackpot_id, SUM(amount) AS total_wins
      FROM ${ctx.ref("stg_operator_jackpot_wins")}
      GROUP BY jackpot_id
    ) w ON w.jackpot_id = p.jackpot_id
  `;
}

// Gaming maintenance queue: provider game-type labels with no alias.
function unmappedGameTypes(ctx) {
  return `
    SELECT
      gm.game_type_raw,
      gm.provider,
      COUNT(DISTINCT gm.game_id) AS games_affected,
      COUNT(g.activity_id) AS activities_affected
    FROM ${ctx.ref("dim_game")} gm
    LEFT JOIN ${ctx.ref("fct_gaming_activity")} g
      ON g.game_id = gm.game_id
    WHERE gm.canonical_game_type IS NULL
    GROUP BY gm.game_type_raw, gm.provider
    ORDER BY activities_affected DESC
  `;
}

module.exports = {
  stgAccounts, stgBetSlipEvents, stgFixtures, stgRegAttributes,
  dimCustomerAccount, fctBetSlipLifecycle,
  dimFixture, unmappedSports,
  stgGames, stgGameRounds, stgPokerActivity,
  stgOperatorJackpotContributions, stgOperatorJackpotWins,
  fctOperatorJackpotContributions,
  dimGame, fctGamingActivity, fctJackpotLiability, fctOperatorJackpotLiability,
  unmappedGameTypes, reconProviderGgr,
};
