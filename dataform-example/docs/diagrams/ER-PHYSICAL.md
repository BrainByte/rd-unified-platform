# Physical ER Diagram — Unified Regulatory Reporting Platform

**Persisted / materialised model.** These are the actual tables and views the
pipeline builds, with real column names and engine types. Production targets
**BigQuery + Dataform**; the offline harness builds the identical objects in
**DuckDB**. Types shown are logical (`VARCHAR`, `DECIMAL`, `TIMESTAMP`, `DATE`)
and map 1:1 to each engine via `includes/dialect.js`.

The pipeline is layered; each layer is a separate diagram below so it stays
readable:

1. **Source** — `cdc_landing.*` (23 CDC tables, populated by Datastream)
2. **Staging** — `staging.stg_*` (dedupe latest-per-key, `_op != 'D'`)
3. **Reference** — `reference.*` (nomenclature spine, from git-versioned data)
4. **Core & Gaming** — `dim_*` / `fct_*` marts
5. **Player Protection** — wallet, compliance, and the 6 breach detectors
6. **Submissions** — per-market regulator files + tax summaries

> Every `cdc_landing` table also carries CDC metadata columns `_op` (`I`/`U`/`D`)
> and `_commit_ts` (`TIMESTAMP`), used by staging to keep the latest non-deleted
> row per business key. They are omitted from the diagrams to reduce noise.

---

## 1 · Source layer — `cdc_landing`

Landing tables written by Datastream from the operator's SQL Server OLTP. Grain
and shape are whatever the upstream system emits (including provider feeds of
differing grain — Evolution is transaction-grain in cents).

```mermaid
erDiagram
    cdc_accounts {
        VARCHAR   account_id
        VARCHAR   jurisdiction
        VARCHAR   national_id
        DATE      date_of_birth
        VARCHAR   kyc_status
        TIMESTAMP opened_at
    }
    cdc_bet_slips {
        VARCHAR   slip_id
        VARCHAR   account_id
        VARCHAR   fixture_id
        VARCHAR   product
    }
    cdc_bet_slip_events {
        VARCHAR   slip_id
        VARCHAR   event_type
        TIMESTAMP event_ts
        DECIMAL   stake
        DECIMAL   payout
    }
    cdc_fixtures {
        VARCHAR   fixture_id
        VARCHAR   sport_name_raw
        VARCHAR   competition_raw
        VARCHAR   home_raw
        VARCHAR   away_raw
        TIMESTAMP start_ts
    }
    cdc_reg_attributes {
        VARCHAR   entity_type
        VARCHAR   entity_id
        VARCHAR   attr_name
        VARCHAR   attr_value
    }
    cdc_games {
        VARCHAR   game_id
        VARCHAR   game_name
        VARCHAR   provider
        VARCHAR   provider_game_ref
        VARCHAR   game_type_raw
    }
    cdc_netent_rounds {
        VARCHAR   round_ref
        VARCHAR   player_ref
        VARCHAR   game_ref
        DECIMAL   bet_amount
        DECIMAL   win_amount
        DECIMAL   jp_contribution
        VARCHAR   jp_id
        TIMESTAMP round_ts
    }
    cdc_evolution_transactions {
        VARCHAR   tx_id
        VARCHAR   round_ref
        VARCHAR   player_ref
        VARCHAR   table_ref
        VARCHAR   tx_type
        DECIMAL   amount_cents
        TIMESTAMP tx_ts
    }
    cdc_playtech_rounds {
        VARCHAR   round_ref
        VARCHAR   player_ref
        VARCHAR   game_code
        DECIMAL   stake
        DECIMAL   payout
        TIMESTAMP round_ts
    }
    cdc_aggregator_rounds {
        VARCHAR   round_ref
        VARCHAR   sub_provider
        VARCHAR   player_ref
        VARCHAR   game_ref
        DECIMAL   bet
        DECIMAL   win
        TIMESTAMP round_ts
    }
    cdc_provider_statements {
        VARCHAR   provider
        DATE      statement_date
        DECIMAL   reported_ggr
    }
    cdc_poker_activity {
        VARCHAR   activity_id
        VARCHAR   account_id
        VARCHAR   game_id
        VARCHAR   kind
        DECIMAL   amount_in
        DECIMAL   amount_out
        DECIMAL   rake_or_fee
        TIMESTAMP activity_ts
    }
    cdc_player_limits {
        VARCHAR   limit_id
        VARCHAR   account_id
        VARCHAR   limit_type
        DECIMAL   amount
        TIMESTAMP set_at
        TIMESTAMP revoked_at
    }
    cdc_self_exclusions {
        VARCHAR   exclusion_id
        VARCHAR   account_id
        VARCHAR   source
        TIMESTAMP start_ts
        TIMESTAMP end_ts
    }
    cdc_verifications {
        VARCHAR   verification_id
        VARCHAR   account_id
        VARCHAR   check_type
        VARCHAR   status
        TIMESTAMP event_ts
    }
    cdc_payments {
        VARCHAR   payment_id
        VARCHAR   account_id
        VARCHAR   direction
        DECIMAL   amount
        VARCHAR   method
        VARCHAR   status
        TIMESTAMP requested_ts
        TIMESTAMP completed_ts
    }
    cdc_jackpot_pools {
        VARCHAR   jackpot_id
        VARCHAR   jackpot_name
        VARCHAR   provider
        DECIMAL   seed_amount
        DECIMAL   contribution_rate
    }
    cdc_jackpot_wins {
        VARCHAR   win_id
        VARCHAR   jackpot_id
        VARCHAR   account_id
        DECIMAL   amount
        TIMESTAMP win_ts
    }
    cdc_operator_jackpot_pools {
        VARCHAR   jackpot_id
        VARCHAR   jackpot_name
        DECIMAL   seed_amount
    }
    cdc_jackpot_optins {
        VARCHAR   optin_id
        VARCHAR   account_id
        VARCHAR   jackpot_id
        TIMESTAMP opted_in_at
        TIMESTAMP opted_out_at
    }
    cdc_operator_jackpot_contributions {
        VARCHAR   contribution_id
        VARCHAR   account_id
        VARCHAR   jackpot_id
        VARCHAR   game_id
        VARCHAR   trigger_type
        VARCHAR   trigger_ref
        DECIMAL   amount
        TIMESTAMP contributed_at
    }
    cdc_operator_jackpot_wins {
        VARCHAR   win_id
        VARCHAR   jackpot_id
        VARCHAR   account_id
        VARCHAR   game_id
        DECIMAL   amount
        TIMESTAMP win_ts
    }
    cdc_game_round_voids {
        VARCHAR   round_id
        TIMESTAMP voided_at
    }
```

---

## 2 · Staging layer — `staging` (views: dedupe latest-per-key)

Each `stg_*` is a **view** that keeps one row per business key (latest
`_commit_ts`, dropping `_op = 'D'`). The four provider feeds collapse into one
normalised `stg_game_rounds` via the adapter layer (`includes/providers.js`),
which also converts Evolution's cent transactions into euro rounds.

```mermaid
erDiagram
    cdc_accounts               ||--o| stg_accounts                        : dedupe
    cdc_bet_slip_events        ||--o| stg_bet_slip_events                 : dedupe
    cdc_fixtures               ||--o| stg_fixtures                        : dedupe
    cdc_reg_attributes         ||--o| stg_reg_attributes                  : dedupe
    cdc_games                  ||--o| stg_games                           : dedupe
    cdc_netent_rounds          ||--o| stg_game_rounds                     : "normalise (adapter)"
    cdc_evolution_transactions ||--o| stg_game_rounds                     : "cents to rounds"
    cdc_playtech_rounds        ||--o| stg_game_rounds                     : normalise
    cdc_aggregator_rounds      ||--o| stg_game_rounds                     : normalise
    cdc_poker_activity         ||--o| stg_poker_activity                  : dedupe
    cdc_operator_jackpot_contributions ||--o| stg_operator_jackpot_contributions : dedupe
    cdc_operator_jackpot_wins  ||--o| stg_operator_jackpot_wins           : dedupe
    cdc_player_limits          ||--o| stg_player_limits                   : dedupe
    cdc_self_exclusions        ||--o| stg_self_exclusions                 : dedupe
    cdc_verifications          ||--o| stg_verifications                   : dedupe
    cdc_payments               ||--o| stg_payments                        : dedupe

    stg_accounts { VARCHAR account_id PK }
    stg_bet_slip_events { VARCHAR slip_id "PK part" VARCHAR event_type "PK part" }
    stg_fixtures { VARCHAR fixture_id PK }
    stg_reg_attributes { VARCHAR entity_type "PK" VARCHAR entity_id "PK" VARCHAR attr_name "PK" }
    stg_games { VARCHAR game_id PK }
    stg_game_rounds { VARCHAR round_id PK VARCHAR account_id FK VARCHAR game_id FK DECIMAL wager DECIMAL payout DECIMAL jackpot_contribution VARCHAR jackpot_id }
    stg_poker_activity { VARCHAR activity_id PK }
    stg_operator_jackpot_contributions { VARCHAR contribution_id PK }
    stg_operator_jackpot_wins { VARCHAR win_id PK }
    stg_player_limits { VARCHAR limit_id PK }
    stg_self_exclusions { VARCHAR exclusion_id PK }
    stg_verifications { VARCHAR verification_id PK }
    stg_payments { VARCHAR payment_id PK }
```

---

## 3 · Reference layer — `reference` (nomenclature spine)

Published from **git-versioned** mapping data (`includes/nomenclature/`), so a
mapping change is a reviewable data diff with a full audit trail. The two
`map_*_regulator` tables are **effective-dated** (`valid_from` / `valid_to`), so
a resubmission of a historical period reproduces the code that was in force then.

```mermaid
erDiagram
    ref_sport_canonical {
        VARCHAR code PK
        VARCHAR name
    }
    ref_sport_aliases {
        VARCHAR alias_norm PK
        VARCHAR canonical  FK
        VARCHAR source
    }
    ref_participant_aliases {
        VARCHAR alias_norm   PK
        VARCHAR canonical_id
        VARCHAR canonical_name
    }
    map_sport_regulator {
        VARCHAR jurisdiction    "PK part"
        VARCHAR canonical_sport "PK part"
        VARCHAR regulator_code
        DATE    valid_from      "PK part / effective-dated"
        DATE    valid_to
    }
    ref_game_type_aliases {
        VARCHAR alias_norm PK
        VARCHAR canonical  FK
        VARCHAR source
    }
    map_game_regulator {
        VARCHAR jurisdiction        "PK part"
        VARCHAR canonical_game_type "PK part"
        VARCHAR regulator_code
        DATE    valid_from          "PK part / effective-dated"
        DATE    valid_to
    }
    ref_sport_canonical    ||--o{ ref_sport_aliases     : "canonicalises"
    ref_sport_canonical    ||--o{ map_sport_regulator   : "coded per market"
    ref_game_type_aliases  ||--o{ map_game_regulator    : "coded per market"
```

---

## 4 · Core & Gaming marts — `dim_*` / `fct_*`

The jurisdiction-agnostic canonical facts and dimensions. `fct_gaming_activity`
unifies casino rounds, poker, and the operator opt-in jackpot (contributions &
wins on the phantom game) onto one grain.

```mermaid
erDiagram
    stg_accounts            ||--|| dim_customer_account : builds
    stg_bet_slip_events     ||--o{ fct_bet_slip_lifecycle : aggregates
    cdc_bet_slips           ||--o{ fct_bet_slip_lifecycle : joins
    stg_fixtures            ||--|| dim_fixture : canonicalises
    ref_sport_aliases       ||--o{ dim_fixture : resolves
    ref_participant_aliases ||--o{ dim_fixture : resolves
    stg_games               ||--|| dim_game : canonicalises
    ref_game_type_aliases   ||--o{ dim_game : resolves

    stg_game_rounds                    ||--o{ fct_gaming_activity : casino
    stg_poker_activity                 ||--o{ fct_gaming_activity : poker
    fct_operator_jackpot_contributions ||--o{ fct_gaming_activity : "op-jackpot (ACTIVE)"
    stg_operator_jackpot_wins          ||--o{ fct_gaming_activity : "op-jackpot wins"

    stg_operator_jackpot_contributions ||--|| fct_operator_jackpot_contributions : "void/refund cascade"
    fct_bet_slip_lifecycle             ||--o{ fct_operator_jackpot_contributions : "SPORTS_BET voided?"
    cdc_game_round_voids               ||--o{ fct_operator_jackpot_contributions : "GAMING_ROUND voided?"

    cdc_jackpot_pools          ||--o{ fct_jackpot_liability : seed
    stg_game_rounds            ||--o{ fct_jackpot_liability : contributions
    cdc_jackpot_wins           ||--o{ fct_jackpot_liability : wins
    cdc_operator_jackpot_pools ||--o{ fct_operator_jackpot_liability : seed

    dim_customer_account {
        VARCHAR   account_id   PK
        VARCHAR   jurisdiction
        VARCHAR   national_id
        DATE      date_of_birth
        VARCHAR   kyc_status
        TIMESTAMP opened_at
    }
    fct_bet_slip_lifecycle {
        VARCHAR   slip_id      PK
        VARCHAR   account_id   FK
        VARCHAR   fixture_id   FK
        VARCHAR   slip_status
        DECIMAL   stake
        DECIMAL   payout
        TIMESTAMP placed_at
        TIMESTAMP settled_at
        TIMESTAMP voided_at
    }
    dim_fixture {
        VARCHAR   fixture_id      PK
        VARCHAR   canonical_sport FK
        VARCHAR   competition_name
        VARCHAR   home_name
        VARCHAR   away_name
        TIMESTAMP start_ts
    }
    dim_game {
        VARCHAR game_id            PK
        VARCHAR game_name
        VARCHAR provider
        VARCHAR canonical_game_type FK
    }
    fct_gaming_activity {
        VARCHAR   activity_id PK
        VARCHAR   account_id  FK
        VARCHAR   game_id     FK
        VARCHAR   vertical
        DECIMAL   stake
        DECIMAL   payout
        DECIMAL   rake_or_fee
        DECIMAL   jackpot_contribution
        TIMESTAMP occurred_at
    }
    fct_operator_jackpot_contributions {
        VARCHAR   contribution_id PK
        VARCHAR   account_id      FK
        VARCHAR   jackpot_id      FK
        VARCHAR   game_id         FK
        VARCHAR   trigger_type
        VARCHAR   trigger_ref     FK
        DECIMAL   amount
        VARCHAR   status          "ACTIVE / REFUNDED"
        TIMESTAMP contributed_at
    }
    fct_jackpot_liability {
        VARCHAR jackpot_id  PK
        DECIMAL seed_amount
        DECIMAL total_contributions
        DECIMAL total_wins
        DECIMAL pool_balance
    }
    fct_operator_jackpot_liability {
        VARCHAR jackpot_id  PK
        DECIMAL seed_amount
        DECIMAL total_contributions
        DECIMAL total_wins
        DECIMAL pool_balance
    }
    recon_provider_ggr {
        VARCHAR provider
        DATE    statement_date
        DECIMAL internal_ggr
        DECIMAL reported_ggr
        DECIMAL break_amount
    }
    unmapped_sports    { VARCHAR sport_name_raw PK }
    unmapped_game_types{ VARCHAR game_type_raw "PK" VARCHAR provider }
```

---

## 5 · Player protection — wallet, compliance, breach detectors

The **breach detectors** (`rg_breach_*`) each select rows that constitute a
regulatory breach. Under **quarantine-first** (see `DATA-FLOW.md` and
`ARCHITECTURE.md` §6) a breach no longer aborts the run — it feeds a per-entity
`HELD` exception in `fct_exceptions` and the entity is excluded from its file,
while everyone else ships.

```mermaid
erDiagram
    stg_payments           ||--|| fct_payments : "+ jurisdiction"
    dim_customer_account   ||--o{ fct_payments : joins
    fct_bet_slip_lifecycle ||--o{ fct_player_gambling_activity : "settled bets"
    fct_gaming_activity    ||--o{ fct_player_gambling_activity : "all gaming"
    fct_payments           ||--o{ fct_wallet_ledger : "deposits/withdrawals"
    fct_bet_slip_lifecycle ||--o{ fct_wallet_ledger : "stake/payout"
    fct_gaming_activity    ||--o{ fct_wallet_ledger : "stake/payout"
    cdc_jackpot_wins       ||--o{ fct_wallet_ledger : "provider jp wins"
    fct_wallet_ledger      ||--|| dim_wallet_balance : "running balance"
    fct_wallet_ledger      ||--o{ rg_breach_wallet_overspend : "balance < 0 ?"

    dim_customer_account   ||--|| dim_player_compliance : "verif + limits + exclusions"
    stg_verifications      ||--o{ dim_player_compliance : latest
    stg_self_exclusions    ||--o{ dim_player_compliance : open
    stg_player_limits      ||--o{ dim_player_compliance : active
    dim_player_compliance  ||--o{ rg_effective_deposit_limits : "min(personal, statutory)"
    rg_effective_deposit_limits ||--o{ rg_breach_deposit_limits : "over limit ?"
    fct_player_gambling_activity||--o{ rg_breach_loss_limits : "net loss over ?"
    stg_self_exclusions    ||--o{ rg_breach_activity_while_excluded : "activity in window ?"
    fct_payments           ||--o{ rg_breach_unverified_withdrawals : "withdrew unverified ?"
    fct_gaming_activity    ||--o{ rg_breach_stake_limits : "stake over the cap in force ?"

    fct_payments {
        VARCHAR   payment_id  PK
        VARCHAR   account_id  FK
        VARCHAR   jurisdiction
        VARCHAR   direction
        DECIMAL   amount
        VARCHAR   status
        TIMESTAMP completed_ts
    }
    fct_player_gambling_activity {
        VARCHAR   account_id FK
        VARCHAR   jurisdiction
        DECIMAL   stake
        DECIMAL   payout
        VARCHAR   source
        TIMESTAMP occurred_at
    }
    fct_wallet_ledger {
        VARCHAR   account_id FK
        TIMESTAMP ts
        VARCHAR   entry_type
        DECIMAL   signed_amount
    }
    dim_wallet_balance {
        VARCHAR account_id PK
        VARCHAR jurisdiction
        DECIMAL balance
    }
    dim_player_compliance {
        VARCHAR account_id PK
        VARCHAR verification_status
        VARCHAR open_exclusion_source
        DECIMAL personal_daily_limit
        DECIMAL personal_weekly_limit
        DECIMAL personal_monthly_limit
    }
    rg_effective_deposit_limits {
        VARCHAR account_id FK
        VARCHAR period
        DECIMAL personal_limit
        DECIMAL default_limit
        DECIMAL effective_limit
    }
    rg_breach_deposit_limits        { VARCHAR account_id "must be empty" }
    rg_breach_loss_limits           { VARCHAR account_id "must be empty" }
    rg_breach_wallet_overspend      { VARCHAR account_id "must be empty" }
    rg_breach_activity_while_excluded { VARCHAR account_id "must be empty" }
    rg_breach_unverified_withdrawals  { VARCHAR payment_id "must be empty" }
    rg_breach_stake_limits            { VARCHAR activity_id "must be empty" }
```

---

## 6 · Submission layer — per-market regulator outputs

The fan-out: **one definition, two tables per market** for betting
(`submission_ready_<mkt>`, `tax_summary_<mkt>`) and two for gaming
(`gaming_submission_ready_<mkt>`, `gaming_tax_summary_<mkt>`, only where the
market declares a gaming nomenclature — MT & ES). Seven markets: MT, ES (daily);
DK, BG, GR, NL (monthly).

```mermaid
erDiagram
    fct_bet_slip_lifecycle ||--o{ submission_ready_mkt : "reportable slips"
    dim_customer_account   ||--o{ submission_ready_mkt : joins
    dim_fixture            ||--o{ submission_ready_mkt : joins
    map_sport_regulator    ||--o{ submission_ready_mkt : "code (effective-dated)"
    stg_reg_attributes     ||--o{ submission_ready_mkt : "extension attrs (Option B)"
    submission_ready_mkt   ||--|| tax_summary_mkt : "aggregate + rate"

    fct_gaming_activity    ||--o{ gaming_submission_ready_mkt : "reportable activity"
    dim_game               ||--o{ gaming_submission_ready_mkt : joins
    map_game_regulator     ||--o{ gaming_submission_ready_mkt : "code (effective-dated)"
    gaming_submission_ready_mkt ||--|| gaming_tax_summary_mkt : "aggregate + rate"

    submission_ready_mkt {
        VARCHAR jurisdiction
        DATE    report_date  "partition key"
        VARCHAR slip_id      PK
        VARCHAR regulator_code
        VARCHAR ext_attrs    "market-specific, only if declared"
    }
    tax_summary_mkt {
        VARCHAR jurisdiction
        DATE    report_date
        INT     settled_slips
        DECIMAL total_stake
        DECIMAL total_payout
        DECIMAL tax_due     "effective-dated rate"
    }
    gaming_submission_ready_mkt {
        VARCHAR jurisdiction
        DATE    report_date
        VARCHAR activity_id PK
        VARCHAR regulator_code
        DECIMAL gaming_ggr
    }
    gaming_tax_summary_mkt {
        VARCHAR jurisdiction
        DATE    report_date
        DECIMAL total_ggr
        DECIMAL gaming_tax_due "effective-dated rate"
    }
```

> `_mkt` is a placeholder for each of the six market codes: `mt`, `es`, `dk`,
> `bg`, `gr`, `nl`. The `submission_ready_*` tables are incremental and
> partitioned by `report_date`.
