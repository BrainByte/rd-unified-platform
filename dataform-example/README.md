# Working Example: Customer Accounts + Sports Bet Slips

Two domains, two markets, one codebase — with a rule-based config,
layered abstraction, rule-generated assertions, and a unit test suite.
See CLAUDE.md for the layer map and maintainer workflow.

## Quick start (no BigQuery needed)

```bash
node --test                  # 30+ unit tests over the abstraction layer
node demo/compile-demo.js    # validate config, print all generated SQL
```

## Run for real

1. Paste `seed/bigquery_setup.sql` into the BigQuery console.
2. Point `workflow_settings.yaml` at your project.
3. Run in Dataform (all, or by tag: `submissions`, `rules`, `MT`, `ES`).

There are **no `.sqlx` files by design**: this project uses Dataform's
JavaScript API (`publish`/`declare`/`assert` in `definitions/*.js`) so the
same SQL builders also run offline. The deployable Dataform artifact set is
exactly `workflow_settings.yaml` + `definitions/` + `includes/`, and
`npm run dataform:compile` proves it with the genuine CLI (it stages those
three into a pure workspace — Dataform 3.x refuses to share a directory with
npm artifacts — and compiles: 201 actions, 66 datasets). See
`ARCHITECTURE.md` §7.

## The deliberate market differences (all config, zero SQL forks)

| | MT | ES |
|---|---|---|
| Voided bets in file | Yes, with status column | Never |
| Player identifier | account_id | SHA-256 of national ID |
| Tax rate (GGR) | 5% | 20% |
| Rules | stake cap, void payout=0, status set | no-voids (cross-domain), hash format |

Both also inherit 5 common rules (not-null, non-negative, unique slip).
Every rule becomes a Dataform assertion named `rule_{mkt}_{rule_id}` —
a failure in the UI points straight at the regulatory clause, and blocks
the pipeline before any file reaches a regulator.

## Four more markets, added as config only (DK · BG · GR · NL)

Denmark, Bulgaria, Greece and the Netherlands were added purely to
stress-test extensibility — betting-domain, no new shared-table columns,
no bespoke SQL. Each needs a datum no other market has; those ride in the
**jurisdiction extension layer** (`includes/extensions.js` +
`extensions: [...]` config), either from a generic key-value carrier
(`cdc_reg_attributes`) or as a computed expression with a
regulator-specific name. Grounded in real 2025-26 guidelines:

| | DK (Spillemyndigheden) | BG (NRA) | GR (HGC) | NL (KSA) |
|---|---|---|---|---|
| GGR tax | 28%, monthly | 20%→**25% from 2026** | 35% | 34.2%→**37.8% from 2026** |
| Player id | MitID / CPR | EGN (hashed) | AFM (hashed) | BSN (pseudonymised) |
| National self-exclusion | ROFUS (mandatory) | NRA register (mandatory) | operator-level* | CRUKS (mandatory) |
| Bespoke attribute | **SAFE TamperToken** signature per record (carrier) | **NRA real-time registration id** per bet (carrier) | **per-slip winnings withholding tax**, tiered, computed from config bands | **CRUKS check** + **CDB control record** per bet (two carrier attrs) |
| Sport list | default bucket | closed (block) | default bucket | default bucket |

\* Greece's national self-exclusion register was at consultation stage
in the research and is left unasserted. Tax bands and sport codes are
illustrative — flagged to pin against primary sources (see `CLAUDE.md`
open item #1, effective-dating). Adding these markets touched
`jurisdictions.js`, `extensions.js`, seed data and expectations — and
**nothing in the shared core model**.

## The seventh market: Germany (GGL) — the config model's hardest test

Germany (GlüStV 2021, researched July 2026) differs from every other
market in KIND, not just in values — and still landed as configuration:

- **Tax on TURNOVER, not GGR**: 5.3% of *stakes* (RennwLottG). A new
  `taxModel: "turnover"` config key + one arm in the tax generator —
  proven by the expectation that S13's €40 stake owes €2.12, not the
  €1.06 a GGR basis would give.
- **LUGAS**, the cross-operator activity/limit file: a per-bet
  `lugas_activity_id` (carrier) + a pseudonymised cross-operator player
  id (computed SHA-256) via the extension layer; and the €1,000
  **monthly-ONLY** cross-operator deposit default — the first market
  needing per-period nulls in `defaultDepositLimits`.
- **OASIS** mandatory self-exclusion register; closed sport list (block).
- **Graduated slot stake caps, for real**: €1 flat since 2021, then from
  **1 July 2026** €1 for 18–20 and €3 for 21+ (the €5 clean-90-days tier
  needs a behavioural flag — future work). Three effective-dated,
  age-banded rows in the existing `slotsStakeLimits` machinery.

Bring-up also proved the safety net: the first run held the DE player
`WAITING_DATA` because the new market's settlement **watermark** hadn't
been seeded — the fail-closed readiness gate catching an incomplete
onboarding exactly as designed.

## Seed data lifecycle coverage

| slip | market | path | expected outcome |
|---|---|---|---|
| S1 | MT | placed → settled (won 8/10) | in MT file; CDC replay deduped |
| S2 | MT | placed → voided | in MT file as VOIDED, payout 0 |
| S3 | MT | placed → settled (lost) | in MT file |
| S4 | ES | placed → settled (40/50) | the ONLY row in ES file |
| S5 | ES | settled for 60 → then VOIDED | excluded from ES; void wins, payout forced 0 |
| S6 | ES | placed, still open | in no file |

Expected tax summaries (2026-07-08): MT stake 15.00 / payout 8.00 /
tax 0.35 · ES stake 50.00 / payout 40.00 / tax 2.00.

## Gaming domain (casino / poker / jackpots)

Modelled on real regulatory frameworks researched July 2026:

| | MT (MGA) | ES (DGOJ) |
|---|---|---|
| Nomenclature | Game **Types**: 1 = house games (slots, tables, live), 3 = P2P commission (poker) | **Singular licences** per vertical: MAZ (Máquinas de azar), RLT, BLJ, POC, POT |
| Unmapped game type | Defaults to Type 1 (MGA categorises edge cases at its discretion) | **Blocks** — no singular licence, no offering (this operator holds no Punto y Banca licence, like several real ES operators) |
| Gaming tax | 5% of GGR | 20% of GGR |
| Jackpot contributions | Deducted from base-game GGR | Gross |

Revenue mechanics per vertical (encoded in `gaming_ggr` + rowConditions):
casino rounds earn stake − payout (never rake); poker cash earns **rake
only**; tournaments earn the **entry fee only** (buy-ins fund the prize
pool). Progressive jackpots divert ~1% of each wager to a ring-fenced
pool seeded by the operator (`fct_jackpot_liability`: seed +
contributions − wins, never negative); wins pay from the pool, never
from GGR. Seed games are real: Starburst/Mega Fortune (NetEnt),
Lightning Roulette/Punto Banco (Evolution), Aviator (Spribe — a newer
"Crash" category with no alias yet, so it exercises the unmapped queue).

### Multi-provider integration

Casino data arrives from four differently-shaped provider feeds and is
normalised by the adapter layer (`includes/providers.js` — provider
variance as CONFIG, normalising SQL generated):

| Provider | Grain | Quirks handled |
|---|---|---|
| NetEnt | round | own field names; jackpot contribution embedded |
| Evolution | **transaction** | separate BET/WIN rows aggregated to rounds; amounts in **cents** |
| Playtech | round | identifies games by its own codes |
| Aggregator (Spribe & long tail) | round | real studio travels in `sub_provider` |

Round ids are provider-namespaced (`NE:R1`, `EV:R5`...) because provider
refs collide; games resolve through a composite catalogue key
(provider + provider_game_ref). `recon_provider_ggr` reconciles
internally recorded GGR against daily provider statements — the numbers
revenue-share invoices are billed on — with breaks surfaced as disputes.
Adding provider #5 = one registry entry + feed declaration + seed
(proven by a test that extends the registry with Pragmatic Play).

Gaming seed expectations: MT file 9 activities from 4 providers (Type
1/3, Crash via default bucket), ES file exactly 4 (MAZ/POC/POT), MT
gaming tax 0.99 on GGR 19.76, ES 2.40 on 12.00, JP1 pool balance 0.04
after a 100,000.10 win, Evolution cents-transactions rebuilt into euro
rounds, and zero provider-recon breaks.

## Player protection & payments

Verified against real frameworks (July 2026): Spain's RD 1614/2011
mandates deposit limits with statutory defaults of **€600/day,
€1,500/week, €3,000/month**, and the **RGIAJ** national self-exclusion
register that every licensed operator must honour; Malta has no
statutory defaults (player-set limits, operator-level exclusion); both
require identity verification before withdrawals complete.

The domain adds player limits (with revocation lifecycle), self-
exclusions (operator + RGIAJ sources, timed or indefinite), KYC
verification events, and the deposits/withdrawals payment lifecycle
(REQUESTED → COMPLETED/FAILED). `rg_effective_deposit_limits` resolves
each player's cap as the null-safe minimum of personal limit and
statutory default (NULL = no cap — possible only in MT).

Six **breach detectors** — the compliance crown jewels:
1. deposits over the effective limit in any market-local day/ISO-week/month window
2. net LOSS (staked − won across bets AND gaming, so operator-jackpot contributions count) over a player's loss limit in any window
3. sufficient-balance spend gate: a player's running unified-wallet balance never goes negative (no spending money they don't have)
4. ANY activity (deposit, bet placed, gaming) inside an exclusion window — for RGIAJ that's a breach of national law
5. withdrawals completed without a prior VERIFIED identity check
6. gaming stakes over the effective MAX STAKE cap in force when staked —
   statutory slots bands (age-banded + effective-dated per market, UKGC-
   modelled) null-safe-min the player's personal STAKE_CASINO limit
   (see `../requirements/max-stake-limits/` for the full worked scenario)

Under **quarantine-first** (see Fault isolation below) a breach no longer
aborts the run: the breaching entity is **held** and excluded from its
file, while everyone else ships. Seed player A2003 (ES) is RGIAJ-excluded
and unverified: their deposit was blocked (FAILED) and withdrawal held
(REQUESTED), so no breach — then three negative tests flip those records
to COMPLETED and inflate a deposit past a personal limit, proving all
three detectors fire. A1002's *ended* operator exclusion proves the
time-windowing.

## Fault isolation, data readiness & the exception flow

A failure affects only its own row/entity — everyone else's report still
ships; nothing hard-aborts the run. Cross-domain fields also arrive at
different speeds, so a period is only submittable once every upstream
domain is complete through its close. Both live in `includes/exceptions.js`
(see `ARCHITECTURE.md` §6 for the full write-up). Five demo accounts each
exercise one route while the MT file still ships its three real rows:

| Account | Situation | Class → status |
|---|---|---|
| A7001 | postcode fails the MT format | **DATA** → `QUARANTINED` |
| A7002 | postcode OK, region lookup not loaded yet | **TRANSIENT** → `RETRYING` (backoff) |
| A7005 | same, retries exhausted (>5) | **TRANSIENT** → escalated `QUARANTINED` |
| A7003 | bet placed while self-excluded | **COMPLIANCE** → `HELD` |
| A7004 | settles in a period the feed hasn't closed | **COMPLETENESS** → `WAITING_DATA` |

Key distinction — **late vs. nonexistent**: absence is read from terminal
*state*, never from a missing row. S6 is OPEN, so its settlement
legitimately *doesn't exist* — it is correctly absent from every file and
is **not** an exception. Transient failures carry a retry state machine
(exponential backoff → escalate; `RESOLVED` re-admits once late data
arrives — demonstrated by A1001). The one hard block that remains is
**isolation itself**: no held/quarantined/incomplete entity may reach a
regulator (`assert_no_blocked_entity_in_*`, proven by a negative test).
Late data *after* filing is a **restatement** via effective-dating.

## Operator-driven product: opt-in piggyback jackpot

An operator-run game of chance layered on top of provider games AND
sports bets. Opted-in players auto-contribute from their unified balance
on each trigger and can win the pool. It's modelled with **no new
core-model shape** — see `ARCHITECTURE.md` for the full write-up:

- A **phantom game** (`OJ1`, canonical `OJACK`) carries the wins so a
  regulator can correlate a "win just for playing" to a licensed
  vertical. Malta licenses it (MGA Type 1) and reports it; Spain holds no
  matching licence, so the phantom game is unmapped and the
  `no_unlicensed_games` rule **blocks the pipeline** (a negative test
  proves it). *Same product config, allowed in MT, blocked in ES.*
- Contributions (triggered by a game round **and** a sports bet) and wins
  fold into `fct_gaming_activity` as vertical `OPERATOR_JACKPOT`, flowing
  into the gaming file, GGR/tax, the operator pool liability
  (`seed + contributions − wins ≥ 0`), and the player **loss limit**.
- **Void/refund cascade**: a contribution on a voided trigger — a voided
  bet slip, or a rolled-back round in `cdc_game_round_voids` — is marked
  `REFUNDED` and reversed out of the pool, GGR and loss base, with the
  REFUNDED row kept for audit.
- **Unified-balance debit**: each active contribution is a
  `JACKPOT_CONTRIBUTION` debit in `fct_wallet_ledger` (the one balance
  spanning deposits, withdrawals, bets and gaming), reconciled against
  the pool; `dim_wallet_balance` is the running balance.

## What the tests cover

- `test/fields.test.js` — expressions honour rounding/timezone config;
  unknown fields fail with actionable messages
- `test/queries.test.js` — void inclusion per market, jurisdiction
  filtering, both-domain join, tax always excludes voids
- `test/rules.test.js` — each rule type compiles to the right violation
  SQL, including the cross-domain no-voids check
- `test/validate.test.js` — the live config is clean, and every class of
  config mistake (missing key, unknown field, duplicate rule id, rule on
  a column absent from that market's file...) is caught pre-deploy

## Offline development (no GCP)

```bash
npm install          # once — pulls @duckdb/node-api (dev only)
npm run local        # full pipeline in DuckDB: 66 models, 87 rule
                     # assertions, 56 expectations, 16 negative tests
npm run local:dry    # print the execution plan (works with no installs)
npm run check        # tests + demo + local pipeline
```

Seed data lives in `seed/data.js`; `npm run seed:generate` regenerates
the BigQuery script from it, so local and cloud always load identical
data. Engine differences are isolated in `includes/dialect.js`.

How can a Dataform project run without Dataform? Because Dataform is
kept deliberately thin here: `definitions/` contains wiring only (no
SQL), every statement lives in plain JS functions, and `local/run.js`
is a small stand-in that performs Dataform's jobs (reference
resolution, dependency order, materialisation, assertions) against
DuckDB — see `ARCHITECTURE.md` § 7 for the side-by-side.
