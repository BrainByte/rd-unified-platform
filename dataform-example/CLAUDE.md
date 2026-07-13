# Maintainer Guide (human and AI)

## Project status — CONTINUATION NOTES (work in progress)

This repo is a working proof-of-concept for migrating a 14-year legacy
SQL Server regulatory reporting estate (17 gaming markets: stored procs,
triggers, SSRS, SOAP submissions) to BigQuery + Dataform. Built
incrementally in conversation with Claude (July 2026); Jonathan is not
finished — pick up from "Open items" below.

**Merged to `main` (last: 2026-07-12):** everything below is on `main` —
the original harness + extension layer + six markets landed via MR !1
(2026-07-11); since then work flows as FEATURE BRANCHES (financial-
reconciliation, golden-chips, operator-jackpots — all merged), verified
green locally, then fast-forwarded to `main` on Jonathan's explicit
request ("merge into main" / "fast-forward main") — never unprompted.
The SHARED docs (README_FIRST.md, OVERVIEW.md,
technology-skills-migration.md, financial-reconciliations.md, the
requirements/ worked scenarios) live at the REPO ROOT; the
pipeline-specific ones (README, ARCHITECTURE, SETUP, this file,
docs/diagrams) stay here. As there is no CI runner (see open item #5),
merges are manual fast-forwards and `npm run check` on desktop remains
the gate. One more convention: the demo database
(dataform-website/data/betnova.duckdb) is committed as the PRISTINE seed
— run dataform-website/reset_db.py before any commit that touches it.

**Done and verified (119 unit tests passing — run `node --test`):**
- Two domains: customer accounts + sports bet slip lifecycle
  (PLACED → SETTLED | VOIDED, void-wins-over-settlement invariant)
- Layered abstraction: config → fields → filters → queries → rule engine
- Seven example markets (MT, ES, DK, BG, GR, NL, DE) with genuinely different
  regulatory behaviour driven purely by config (voids, identifiers,
  tax, codes, per-market data attributes, opt-in domains)
- Declarative rule engine: rules in config compile to Dataform
  assertions named after regulatory clause ids
- Config validator gating compilation (nothing invalid deploys)
- Nomenclature layer: two-hop mapping (upstream aliases → canonical
  taxonomy → per-regulator sport codes), normalise JS/SQL twins,
  per-market unmapped policy (default-bucket vs block), unmapped queue
  view as the maintenance loop, event-name templates
- Seed data as data (`seed/data.js`) generating BOTH the BigQuery
  script (`node seed/generate.js` -> seed/bigquery_setup.sql) and the
  offline DuckDB load, with documented expected outputs in README.md
- GAMING domain (casino / poker / jackpots), researched against real
  frameworks: MGA game Types 1/3 with 5% GGR tax and default-bucket
  policy; DGOJ singular-licence verticals with 20% GGR tax and hard
  block on unlicensed games (no Punto y Banca licence held); per-
  vertical revenue mechanics (casino stake-payout, poker rake-only,
  tournament fee-only); progressive jackpot pools (~1% wager
  contribution, operator-funded seed, liability tracking, wins paid
  from pool not GGR); game-type nomenclature via the same two-hop
  alias machinery (Spribe 'Crash' exercises the unmapped queue)
- MULTI-PROVIDER ADAPTER LAYER (includes/providers.js): provider
  variance as config, normalising SQL generated. NetEnt/Playtech
  round-grain feeds, Evolution transaction-grain in cents (BET/WIN
  aggregation + tx-level CDC dedupe), long-tail studios via aggregator
  with sub_provider; provider-namespaced round ids; composite game
  catalogue key (provider + provider_game_ref); provider revenue-share
  GGR reconciliation vs daily statements. Adding a provider = one
  registry entry (test proves it with Pragmatic Play)
- PLAYER PROTECTION & PAYMENTS (includes/player_protection.js):
  player-set deposit limits with revocation, self-exclusions (operator
  + Spain's RGIAJ national register as a config-mandated source),
  KYC verification events, deposit/withdrawal lifecycle; effective
  limits = null-safe MIN(personal, statutory default — ES 600/1500/3000
  per RD 1614/2011, MT none); FIVE breach detectors (under quarantine-first
  they feed per-entity HOLDs, not run aborts — see FAULT ISOLATION below)
  (deposit limits per local day/ISO-week/month; LOSS limits
  — net staked-won across bets AND gaming via fct_player_gambling_activity,
  so operator-jackpot contributions count; wallet OVERSPEND — running
  unified-balance never negative (sufficient-balance spend gate);
  activity while excluded across payments+betting+gaming; unverified
  withdrawals),
  each proven by a negative test; dim_player_compliance status view
- OFFLINE TEST HARNESS: full pipeline executes locally in DuckDB with
  zero GCP dependency — `npm install` once, then `npm run local`.
  Includes a dialect layer (includes/dialect.js: bigquery|duckdb),
  all model SQL moved to includes/models.js (single source shared by
  Dataform definitions and the local runner), 53 integration
  expectations (local/expectations.js) and 16 negative tests proving
  rules catch corrupted data. `npm run local:dry` prints the plan
  without DuckDB installed. VERIFIED end-to-end on desktop
  (Windows/Node 24; counts current 2026-07-12): `npm run local` is
  GREEN — 66 models, 87 rule assertions, 56 expectations, 16 negative
  tests; `npm run check` = 119/119 unit tests + demo + local + emit-sql. `@duckdb/node-api` is
  pinned to `1.4.5-r.1` (lts-v1.4; its published versions carry a
  `-r.N` suffix that `^`-ranges reject). Three sandbox-invisible bugs
  fixed on the first real run: duckdb single-quote escaping (double
  `''`, not backslash) in seed/generate.js; a dropped-alias bug in
  rg_breach_deposit_limits (`p.account_id` → `w.account_id`); and one
  expectation whose rows were out of `ORDER BY activity_id` order.
- JURISDICTION EXTENSION LAYER (includes/extensions.js) — the "Option B"
  answer to structural data-requirement variance flagged in the
  architecture review. Market-specific data that has no place in the
  shared core rides in ONE generic carrier (cdc_reg_attributes:
  entity_type/entity_id/attr_name/attr_value, staged + deduped like any
  CDC feed) for sourced attributes, or is a computed expression with a
  regulator-specific output name — declared per market via
  `extensions: [...]`, validated, and targetable by declarative rules.
  Core tables never widened, no per-market tables. Domains are now
  opt-in per market (gaming gated on gamingNomenclature presence).
- FOUR NEW MARKETS (betting-only) added purely as config to exercise
  the extension layer against real 2025-26 regulator guidelines:
  Denmark (Spillemyndigheden, 28% GGR monthly, ROFUS register, SAFE
  TamperToken per-record signature via the carrier), Bulgaria (NRA,
  GGR 20%→25% from 2026, EGN id, real-time NRA registration reference
  per bet via the carrier, closed sport list), Greece (HGC, 35% GGR,
  AFM id, per-slip progressive player-winnings withholding tax computed
  from config-held brackets), Netherlands (KSA/Koa Act, kansspelbelasting
  34.2%→37.8% from 2026, CRUKS mandatory self-exclusion, BSN
  pseudonymised id, and TWO carrier attributes — the per-session CRUKS
  check reference and the CDB/Controledatabank control record per bet).
  Each proved end-to-end in the offline harness; tax bands and sport
  codes are illustrative and flagged to pin against primary sources
  (ties to open item #1).
- OPERATOR-DRIVEN OPT-IN JACKPOT (piggyback product): an operator-run
  game of chance layered on top of provider games AND sports bets.
  Opted-in players make an automatic contribution from their unified
  balance whenever a trigger fires (a provider game round or a sports
  bet) and can win the pool. Modelled with ZERO new core-model shape:
  a PHANTOM game (cdc_games 'OJ1', canonical type OJACK) so wins
  correlate to a regulator vertical; contributions/wins fold into
  fct_gaming_activity as a new vertical OPERATOR_JACKPOT (contribution =
  stake, win = payout), flowing into the gaming file, GGR/tax, and — for
  free — the exclusion breach detector (they're gaming activities). GGR
  = contributions - wins (arm added to fields.js gaming_ggr +
  queries.js). Pool liability in fct_operator_jackpot_liability (seed +
  contributions - wins >= 0), kept SEPARATE from the provider-funded
  fct_jackpot_liability. Licensing is enforced by the EXISTING
  nomenclature machinery: MT licenses OJACK under MGA Type 1; ES has no
  matching licence, so the phantom game is unmapped and the cross-domain
  no_unlicensed_games rule BLOCKS it (proven by a negative test). New
  CDC sources: cdc_operator_jackpot_pools / cdc_jackpot_optins /
  cdc_operator_jackpot_contributions / cdc_operator_jackpot_wins.
  Contributions now COUNT toward player LOSS limits (they are gaming
  wagers in fct_player_gambling_activity; rg_breach_loss_limits + a
  negative test prove it). VOID/REFUND CASCADE done:
  fct_operator_jackpot_contributions marks a contribution REFUNDED when
  its trigger is voided (a lifecycle-VOIDED slip, or a rolled-back round
  in cdc_game_round_voids); consumers take status='ACTIVE' only, so the
  refund reverses out of pool/GGR/tax/loss, REFUNDED rows kept for audit
  (3 expectations prove it). UNIFIED-BALANCE WALLET done: each active
  contribution is a JACKPOT_CONTRIBUTION debit in fct_wallet_ledger (one
  balance across deposits/withdrawals/bet+gaming stakes+payouts/jackpot),
  reconciled against the pool; dim_wallet_balance is the running balance.
  SUFFICIENT-BALANCE SPEND GATE done: rg_breach_wallet_overspend flags
  any point where a player's running wallet balance goes negative (new-
  market wallets funded with opening deposits; a negative test proves an
  unfunded spend fires it). The product — and the wallet layer — is now
  modelled end-to-end; nothing scoped-out remains.
- FAULT ISOLATION, DATA READINESS & THE EXCEPTION FLOW
  (includes/exceptions.js), quarantine-first: a failure affects only its
  own entity — the run never aborts for everyone. Each failure is ROUTED by
  class into fct_exceptions (the dead-letter/triage source): DATA (bad
  postcode, per-market format = variance as data) → QUARANTINED; TRANSIENT
  (region reference / feed lag) → RETRYING with exponential backoff
  (15·2^(n-1) min) then escalate to QUARANTINED after MAX_ATTEMPTS=5;
  COMPLETENESS (period not closed per source watermark) → WAITING_DATA;
  COMPLIANCE (a rg_breach_* row) → HELD. Submissions+tax apply ONE
  admissibilityFilter (no blocking exception AND period ready). The retry
  state machine (ops_exception_state_next over cdc_exception_state) also
  RESOLVES/re-admits once late data arrives. CRUX — "late vs nonexistent":
  absence is read from terminal STATE (an OPEN slip's settlement
  legitimately doesn't exist → correctly absent, NOT an exception), never
  inferred from a missing row. The ONE hard block that remains is isolation
  itself: assert_no_blocked_entity_in_<mkt> (a negative test forces a
  quarantined row into a file and the gate catches it). Late data AFTER
  filing → restatement via effective-dating. 5 demo accounts (A7001-A7005)
  each exercise one route while the MT file still ships its 3 real rows.
- READER-FACING DOC SET (beyond the golden path): docs/diagrams/ holds a
  LOGICAL ER, a PHYSICAL ER (per pipeline layer, real columns/types) and
  a DATA-FLOW diagram (context L0 + pipeline L1 with the quarantine-first
  gate + config control plane), each as Mermaid Markdown (source of
  truth) AND rendered A3 PDF — regeneration documented in
  docs/diagrams/README.md (render-html.js + headless Edge print-to-pdf).
  technology-skills-migration.md (REPO ROOT) is the construct-by-
  construct translation for SQL Server / OLTP engineers (trigger →
  rule/assertion, proc → builder + config, IF @Market → forbidden, NRT →
  provable micro-batch); linked from README_FIRST's "coming from SQL
  Server?" callout and OVERVIEW's skills-shift trade-off. README_FIRST.md
  and OVERVIEW.md also live at the REPO ROOT (shared docs); the root
  README.md is the landing page pointing at them.

- MAX STAKE LIMITS (REQ: repo-root requirements/max-stake-limits — the
  WORKED CHANGE SCENARIO showing how a real regulatory change lands):
  UKGC-modelled statutory online-slots stake caps, age-banded AND
  effective-dated (MT €5 all-adults from 2026-08-01 + €2 for 18-24 from
  2026-09-15, staggered like the real 9 Apr / 21 May 2025 rollout;
  ES/DK/NL flat; BG/GR none) as playerProtection.slotsStakeLimits config,
  PLUS a player-set STAKE_CASINO per-stake cap that is a new limit_type
  VALUE through the untouched player-limits machinery (zero DDL). New
  UNIVERSAL datum date_of_birth on cdc_accounts (shared model, NOT the
  extension carrier — it's needed everywhere); dialect.ageYears both
  engines. rg_breach_stake_limits (BREACH 6) resolves the cap in force AT
  EACH STAKE'S own age + market-local date (statutory = SLOT canonical
  only per UKGC scope; personal = all casino verticals; effective =
  null-safe LEAST) and feeds a COMPLIANCE hold via fct_exceptions.
  ref_stake_limits materialises the bands (regulator-visible,
  effective-dated). 4 negative tests: adult over 5-cap fires; 21yo over
  2-cap fires; same stake BEFORE the youth band arms is EXEMPT
  (effective-dating); poker stake over personal cap fires. Website:
  DOB at registration, STAKE_CASINO in the limits UI, casino stake gate
  (statutory bands date-armed; verified with a simulated future clock).
  The requirements folder carries requirements.md / overview.md /
  implementation.md with a requirement->artifact trace both ways.

- REAL DATAFORM COMPILATION PROVEN (local/dataform-compile.js, npm run
  dataform:compile): the genuine @dataform/cli compiles this project to
  201 actions / 66 datasets (matching the harness's 66 models), fully
  qualified with every rule as a named assertion. NO .sqlx BY DESIGN —
  the project uses Dataform's JS API (publish/declare/assert) so the SQL
  builders are callable offline; the deployable artifact set is exactly
  workflow_settings.yaml + definitions/ + includes/. GOTCHA: Dataform
  3.x requires a PURE workspace (refuses to compile next to
  package.json/node_modules), so the script stages those three artifacts
  into a temp dir and compiles there. Needs network (npx); that's why
  it's step 4 of the workflow, not part of npm run check.
- GENERATED-SQL EMITTER (local/emit-sql.js, npm run emit-sql — also part
  of npm run check): writes every generated model + assertion, in
  execution order, to the transient repo-root dataform-sql/ folder in
  BOTH dialects (duckdb/ = exactly what the harness runs; bigquery/ =
  the same builders for production), with generated READMEs per
  dialect/kind and a header on every file (step, rule description,
  zero-rows semantics). UNDERSTANDING AID ONLY for SQL developers new to
  the architecture — never a source (dialect trees are gitignored and
  wiped each run; the committed dataform-sql/README.md pins the folder
  and gives a reading guide incl. the cross-dialect diff that shows
  dialect.js is the only difference). run.js now guards main() and
  exports buildPlan for reuse.

**DEMO ECOSYSTEM (repo root, outside dataform-example/) — 2026-07-12:**
- BetNova (`dataform-website/`, see repo-root `readme-web.md`): an
  entirely FICTITIOUS single-user gaming site (Python 3.11 / Flask /
  persistent DuckDB committed to git) that plays the role of the
  operator OLTP so the architecture can be demonstrated end to end by
  clicking, not slides. Register in any of the seven markets (T&Cs,
  national id, per-market postcode hints), limits, KYC, deposits/
  withdrawals, sports bets that settle ~40s after placement via LAZY
  settlement (WIN/LOSS/VOID with reasons), casino (slots/blackjack/
  poker), one ledger-derived wallet, and an admin back office
  (player-360, in-flight bets, void/exclude/verify/settle-now). Its
  tables deliberately mirror this pipeline's cdc_* landing shapes
  (mapping table in readme-web.md), and its front-door controls are the
  same invariants the breach detectors prove after the fact.
- Fictitious regulator SAFE + near-realtime submission engine
  (`dataform-website/safe.py` + `submission.py`, both started/stopped by
  app.py as daemon threads): ONE SOAP 1.1 service impersonates all seven
  regulators with an endpoint per jurisdiction PER RECORD TYPE
  (bets/payments/players), ?wsdl per endpoint, SOAP Faults on unknown
  jurisdiction/type, and a browsable status page (port 5002). The engine
  polls the demo DB every 3s and SOAPs each newly-reportable record —
  players re-reported on KYC change, voids re-reported as amendments,
  ES/BG/GR/NL pseudonymise (sha256) and suppress voids, MT/DK carry a
  status column — logging receipts in safe_submissions so nothing sends
  twice. Accepted records land pretty-printed, one XML file per record,
  in repo-root `dataform-safe/<MKT>/<type>/` (XML gitignored). Verified
  end to end 2026-07-12 (13 records across MT/GR/NL, all three types,
  real 40s settlement). NOTE: run `dataform-website/reset_db.py` before
  committing — the committed betnova.duckdb stays the pristine seed.
  This is a local prototype of open item #4's submission engine.
- FINANCIAL RECONCILIATION (dataform-website/reconciliation.py, process
  doc repo-root financial-reconciliations.md, output
  dataform-reconciliation/<MKT>/*.pdf): daily + monthly PDF per
  jurisdiction reconciling the operator OLTP against the records reported
  to the SAFE. Two GGR bases computed independently — CASH (deposits -
  withdrawals - player-balance movement, event-timeline: stake@placed,
  refund/clawback@voided, payout@settled) and SETTLEMENT (the tax base:
  settled stakes - payouts - void reversals + casino rounds) — bridged
  EXACTLY by the movement in the open-bets (unsettled stakes) liability;
  any residual is flagged UNRECONCILED. Three-way completeness: every
  reportable record (bets per market void rules / gaming / payments) must
  hold a safe_submissions receipt AND its stored XML — breaks itemised,
  exit code 1 (a finance-close gate). GGR duty accrues PER DAY at that
  day's effective-dated rate (TAX_RATES mirrors jurisdictions.js incl.
  BG/NL 2026 changes). The SAFE gained a 'gaming' record type so the
  reported set covers the full tax base. Verified end to end: MT cash 30
  vs settlement 22 bridged by an 8.00 open bet, residual 0.00; ES
  negative-GGR day reconciled; sabotage tests (deleted XML, deleted log
  row) produced itemised breaks + exit 1. Read-only DB access (run while
  the site is stopped; production = replica). fpdf2 added to
  requirements.txt. Also generatable from the back office: Admin ->
  Financial reconciliation (market + daily/monthly + day/month form,
  flash status per report, PDF download list; runs in-process on the
  app's shared connection).
- GOLDEN CHIPS (REQ: repo-root requirements/golden-chips — the second
  worked change scenario, a PRODUCT change this time): promotional
  operator-funded table-game chips (blackjack/poker only, never slots).
  Defining rule in ONE place (engine.golden_winnings): the chip is
  consumed win/lose/push and only WINNINGS come back, as cash (5-chip
  winning 2x pays 5, not 10). Award: automatic (deposit >= 50 -> 5 chip,
  DEPOSIT_PROMO as data — the homepage deal is now real) + admin
  customer-services award. golden_chips OLTP table; game_rounds.funding
  CASH|GOLDEN_CHIP; the derived-balance ledger's casino arm splits on it
  (golden = +payout only, no cash at stake). RG: exclusion + stake caps
  apply to the chip value; loss limits EXCLUDE golden rounds (funding =
  'CASH' filter — the player risked nothing). SAFE gaming records carry
  <Funding>. Reconciliation: settlement view splits cash- vs bonus-
  funded; BONUS_STAKE_POLICY per market (deduct|gross, mirroring
  jackpotPolicy: MT deduct, ES gross); gross markets add ONE bridge item
  (operator-funded bonus stakes); residual stays exact-zero. Verified:
  golden loss left balance untouched; 10-chip win credited exactly +10;
  MT recon cash -10 = settle -10 (deduct) while ES cash -5 vs settle 0
  bridged by the 5.00 chip (gross), both residual 0.00; SAFE XML shows
  GOLDEN_CHIP; slots refusal + winnings-only edge cases (2x/3:2/push/
  loss) unit-checked. Pipeline fold-in described (not built) in the
  scenario's implementation.md Part D: rounds feeds carry funding +
  per-market bonusStakePolicy + one gaming_ggr arm.
- OPERATOR JACKPOTS + GAMING SESSIONS (REQ: repo-root
  requirements/operator-jackpots — third worked scenario; the operator
  side of the product THIS pipeline already models as OJ1/OJACK):
  gaming_sessions table — login mints GS-id, logout ends (LOGOUT),
  activity after SESSION_TIMEOUT_MINUTES=30 ends stale (INACTIVITY) and
  mints anew; game_rounds.session_id stamped on every play and reported
  (<SessionId>) on every SAFE gaming record. jackpot_optins lifecycle;
  OPERATOR_JACKPOT config as data (game_id 'operator-jackpots',
  contribution_rate 1%, win_probability 0.05, seed 100); pool DERIVED =
  seed x (1+wins) + contributions - payouts (re-seeds on win, never
  negative); every opted-in CASH casino round records a contribution
  round + runs the RNG — a win records a win round, flashes the
  celebration (flash-jackpot CSS) and the derived wallet already shows
  the credit; golden-chip rounds neither contribute nor draw; stake gate
  reserves stake+contribution. GAME_TYPE_CODES as data — every SAFE
  gaming record carries <GameType>, jackpot rounds = magic number 7077
  (deducible from data, mirroring OJACK's nomenclature hop). MONEY
  INTEGRITY REQUIRED ZERO CHANGES (the point): contributions/wins are
  cash gaming rounds, so wallet/loss-limits/submission/recon all picked
  them up untouched — verified live: jackpot hit on spin 5 paying
  exactly 100.10 (seed+5x0.02), pool re-seeded to 100.00, recon cash
  -98.00 = settlement -98.00 residual 0.00 12/12 reported, SAFE records
  all carrying SessionId + GameType; inactivity guard-tested offline.

- GERMANY (DE / GGL) — the SEVENTH market (branch de-regulator-addition;
  researched July 2026 incl. the 1 Jul 2026 graduated slot caps). The
  config model's hardest test, still landed as config + two small
  generator extensions: taxModel 'turnover' (5.3% of STAKES, RennwLottG
  — one arm in taxSummaryQuery; expectation proves 40 stake -> 2.12 tax,
  not the GGR-basis 1.06); defaultDepositLimits with PER-PERIOD NULLS
  (LUGAS 1000/month, monthly-only — validator + defaultLimitExpr handle
  null periods); LUGAS per-bet reference (carrier) + pseudonymised
  cross-operator player id (computed) via extensions; OASIS mandatory
  register; closed sport list (block); slotsStakeLimits with Germany's
  REAL progression (EUR 1 flat 2021-2026 -> EUR 1 for 18-20 / EUR 3 for
  21+ from 2026-07-01; EUR 5 clean-90-days tier needs a behavioural
  flag, future work). Seed A9001/D16/S13 + LUGAS carrier row +
  bet_settlement watermark — forgetting the watermark was CAUGHT live by
  the fail-closed readiness gate (DE player held WAITING_DATA), exactly
  as designed. Website: DE in JURISDICTIONS/MARKETS/SAFE/TAX_RATES with
  TAX_BASIS 'turnover' in the reconciliation duty (+ band 'to'-date
  handling in the site's slot gate). Dataform compile: 201 actions / 66
  datasets incl. reporting_de. NOTE: Greece's regulator is referred to
  as HGC (Hellenic Gaming Commission) throughout — not EEEP.

**Open items (agreed direction, not yet built):**
1. ~~Effective-dating on tax rates and regulator codes~~ DONE
   (includes/effective_dating.js): a taxRate/sportCode/gameCode can be a
   constant OR a versioned schedule `[{ rate|code, from, to }]` (from
   inclusive, to exclusive). Tax summaries apply the rate in force for
   each report_date (a CASE); map_sport/game_regulator carry
   valid_from/valid_to and the submission joins + no_unmapped/
   no_unlicensed rules are temporal, so a resubmission of a historical
   period reproduces that period's rate and code. Proven: BG 2025
   resubmission → 20% + FUT; 2026 → 25% + revised FTB. NL/BG tax
   schedules and BG's FUT→FTB revision are the worked examples; the same
   shape extends to competitions/market types (open item #2).
2. Extend nomenclature pattern to competitions and bet/market types
   (gaming game-types DONE — same pattern proven across domains)
3. Reconciliation layer: port `includes/recon.js` +
   `definitions/40_recon/` from the companion `dataform-starter` repo
   (three-level legacy parallel-run diffs + permanent internal recon)
   and wire to this repo's tables
4. Cloud Run SOAP submission engine + per-market adapters (skeleton
   exists in `dataform-starter/submission-service/`; a working LOCAL
   prototype of the whole loop — per-jurisdiction/per-record-type SOAP
   endpoints, receipts, retry-safe once-only delivery — now exists as
   the demo SAFE + submission engine in `dataform-website/`, see the
   DEMO ECOSYSTEM entry above)
5. Real deployment: point `workflow_settings.yaml` at a GCP project,
   run seed SQL in BigQuery, execute in Dataform, verify README's
   expected results; wire `node --test` + `node demo/compile-demo.js`
   + `dataform compile` into CI.
   CI NOTE (2026-07-11): a root `.gitlab-ci.yml` running `cd
   dataform-example && npm ci && npm run check` was written and then
   REVERTED — the self-hosted GitLab (brainbyte.geekgalaxy.com) runs on
   limited hardware with NO CI runner registered, so any pipeline just
   sits pending and can block MR merges. CI is blocked on infra
   (register a runner), not on the config; re-add the file only once a
   runner exists. Until then, `npm run check` on desktop is the gate and
   MRs are merged manually.
6. Scale from 6 example markets (MT, ES, DK, BG, GR, NL, DE) toward the real 17

(Former item #5 — verify `npm run local` end-to-end on desktop — is
DONE as of 2026-07-11; see the OFFLINE TEST HARNESS entry above.)

**Companion artifact:** `dataform-starter.zip` (earlier deliverable in
the same chat) holds the wider migration scaffold: CDC strategy,
recon generators, submission service, and MIGRATION-GUIDE.md covering
the strangler-fig plan (replicate via Datastream → rebuild in Dataform →
parallel-run per market → cutover).

**Quick orientation for a fresh session:** read this file top to bottom,
then `includes/jurisdictions.js` (single source of truth),
then run `node --test` and `node demo/compile-demo.js`. For the live
demo stack (website + SAFE + submission engine + reconciliation) see
repo-root `readme-web.md`; it runs with
`.venv\Scripts\python dataform-website\app.py` (repo-root .venv,
Python 3.11 — recreate with `py -3.11 -m venv .venv` +
`pip install -r requirements.txt`). When asked to implement a NEW
requirement "documented the same way", follow the repo-root
`requirements/<name>/` pattern (requirements.md with REQ ids →
overview.md with the legacy comparison → implementation.md with the
step-by-step and the requirement→artifact trace; REQ comments at every
change site; verify end to end; reseed the demo DB pristine) — three
examples exist: max-stake-limits, golden-chips, operator-jackpots.

---

Regulatory reporting pipeline: customer account + sports bet slip domains,
config-driven fan-out to per-market submission files with rule-based
assertions.

## The layers — and what belongs where

| Layer | File(s) | Contains | Never contains |
|---|---|---|---|
| Config | `includes/jurisdictions.js` | Market facts + declarative rules | SQL |
| Fields | `includes/fields.js` | One SQL expression per field | Filters, joins |
| Filters | `includes/filters.js` | WHERE fragments (voids, dates) | Field expressions |
| Queries | `includes/queries.js` | Composition of the above | Business decisions |
| Rules engine | `includes/rules.js` | Rule types → violation SQL | Market-specific values |
| Providers | `includes/providers.js` | Provider feed registry → normalising adapters | Market or game logic |
| Extensions | `includes/extensions.js` | Per-market attributes (carrier-sourced or computed) → submission cols | Shared-table columns |
| Effective-dating | `includes/effective_dating.js` | Versioned tax rates / regulator codes → date-resolved SQL | Business logic |
| Player protection | `includes/player_protection.js` | Limits, exclusions, KYC, payments, breach detectors | Submission-file logic |
| Fault isolation | `includes/exceptions.js` | Quarantine/retry/hold routing, readiness watermarks, exception store, admissibility | Correctness rules (§5) |
| Validator | `includes/validate.js` | Config pre-flight checks | — |
| Definitions | `definitions/` | Dataform wiring only | Inline business SQL |
| Tests | `test/` | Unit tests for every include | — |

## Non-negotiable rules

1. Market variance goes in `jurisdictions.js` as data. If you are writing
   an `if (market === ...)` anywhere else, stop.
2. Staging and core layers are jurisdiction-agnostic (may carry the
   column, never branch on it).
3. Every regulatory constraint is a declarative rule with an `id` and a
   `description` (the audit trail). Rules compile to assertions in
   `definitions/90_assertions/assertions_from_rules.js` — never write
   ad-hoc assertion SQL for something expressible as a rule.
4. Timestamps stored UTC; local conversion only via `filters.js` /
   `fields.js` expressions.

## Workflow for any change

```
1. Edit config / includes
2. npm test                     # unit tests (node --test)
3. npm run local                # FULL OFFLINE PIPELINE in DuckDB:
                                #   models + rule assertions +
                                #   integration expectations + negative tests
4. npm run dataform:compile     # the GENUINE @dataform/cli against a staged
                                #   pure workspace (workflow_settings.yaml +
                                #   definitions/ + includes/) — Dataform 3.x
                                #   refuses to share a dir with npm artifacts
5. Commit — CI repeats steps 2–4
```

Rapid domain development loop (no GCP needed): add seed rows in
seed/data.js -> add/extend models in includes/models.js + wiring in
definitions/ -> add config/rules in jurisdictions.js -> add expected
outputs in local/expectations.js -> `npm run local` until green.
Engine-specific SQL goes ONLY in includes/dialect.js (both engines +
a test).

## Recipes

**Add a market**: one entry in `jurisdictions.js` (config + rules).
Run the workflow. Touch nothing else. (DK/BG/GR are betting-only
examples — omit gaming config and the gaming domain simply doesn't
materialise for that market.)

**Add a market-specific attribute** (a datum no other market has): add
one entry to `includes/extensions.js` — either carrier-sourced
(`{ entity, carrier: true }`, with rows seeded into `cdc_reg_attributes`)
or computed (`{ sql: (j) => expr }`). List its name in the market's
`extensions: [...]`. Never widen a shared core table; never add a
per-market table. Rules can target it immediately (it's a file column).

**Add a field**: expression in `fields.js`, add to the market's
`reportFields`, unit test in `test/fields.test.js`.

**Add a regulatory rule**: entry in the market's `rules` array. If no
existing rule type fits, add one to `RULE_TYPES` in `rules.js` with
`validate` + `violations`, and tests in `test/rules.test.js`.

**Add a lifecycle event** (e.g. CASHED_OUT): extend the whitelist in
`stg_bet_slip_events.sqlx`, the pivot + status CASE in
`fct_bet_slip_lifecycle.sqlx`, and its rowConditions.

## Nomenclature layer (sports / fixtures / participants)

Two-hop mapping — upstream never touches regulator codes directly:

```
dirty upstream names --(aliases.js, normalised match)--> canonical taxonomy
canonical taxonomy --(per-market sportCodes in jurisdictions.js)--> regulator codes
```

Files: `includes/nomenclature/canonical.js` (internal taxonomy),
`aliases.js` (upstream variants — this file grows), `mapping.js`
(normalise JS/SQL twins, template renderer). Compiled to BigQuery tables
by `definitions/15_reference/reference_tables.js`.

**The maintenance loop**: the `reference.unmapped_sports` view lists
upstream names with no alias, ranked by slips affected. Resolving one =
adding ONE line to `aliases.js` (or `canonical.js` for a new sport),
then `node --test` (alias-conflict tests guard the data). Never resolve
by editing SQL.

**Unmapped policy is per-market config**, because regulators differ:
`'default'` degrades to the regulator's OTHER bucket; `'block'` fails
the pipeline via a `no_unmapped_fixtures` rule (the validator forces the
rule to exist). Display names (participants) degrade gracefully to raw;
regulatory codes never degrade silently.

**Rules**: `normalise()` and `normaliseSql()` must stay equivalent —
change both together. Aliases are stored normalised; only the upstream
side is normalised in SQL.
