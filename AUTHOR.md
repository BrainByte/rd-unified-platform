# Author

**Jonathan (Jono) Hudson** — 11/07/2026

## Why this project exists

This project demonstrates how a **modern architecture — with the right
tooling and the right abstraction layer — can replace traditional
approaches** to regulated, multi-jurisdiction reporting.

The traditional approach it replaces is real and familiar: a transactional
SQL Server estate with the reporting logic hand-written as stored procedures,
triggers, views and scheduled jobs — then **copied and adapted once per
market**, seventeen times over fourteen years, each copy quietly drifting
from the others. It works, but every new market, rule change and audit
question pays the full price again.

The demonstration here is that the same obligations can be met by **one
codebase in which every market difference is data and every piece of logic
exists exactly once** — provable on a laptop in seconds, auditable back to
the regulator clause, extensible by configuration, and safe for the next
engineer (or an AI assistant) to change. Nothing in it is slideware: the
pipeline runs end to end offline; a fictitious operator (website, regulator
SAFE, submission engine, financial reconciliation) exercises it live; and
three worked requirements show real changes landing, traceably, from
requirement to implementation.

## What this project includes

**The reporting pipeline** (`dataform-example/` — BigQuery + Dataform in
production, DuckDB offline):

- **Seven markets from one codebase** (MT, ES, DK, BG, GR, NL, DE — real regulator
  frameworks): per-market submission files and tax summaries fanned out from
  a single set of builders, with every difference (voids, identifiers, tax
  models, codes, cadences) held as configuration.
- **A declarative rule engine**: regulatory constraints written as data,
  compiled to pipeline assertions named by the regulator's clause id.
- **Two-hop nomenclature**: dirty upstream names → canonical taxonomy →
  per-regulator codes, with per-market unmapped policy and a maintenance
  queue — so feeds × markets never becomes an N×M problem.
- **A jurisdiction extension layer**: market-specific data (Denmark's
  TamperToken, Bulgaria's NRA reference, Greece's withholding tax, the
  Netherlands' CRUKS/CDB controls) carried without ever widening the shared
  model.
- **Multi-provider ingestion**: four differently-shaped casino feeds
  (round-grain, transaction-grain-in-cents, aggregator) normalised by an
  adapter registry, with provider revenue-share reconciliation.
- **Player protection**: deposit/loss/stake limits (age-banded, statutory +
  personal), self-exclusion registers, KYC gates — six breach detectors that
  prove the front-door controls held.
- **Fault isolation, quarantine-first**: failures routed by cause (data /
  transient-with-retry / completeness / compliance) so one bad record never
  stops everyone else's reporting; watermark-based period readiness;
  "late vs legitimately absent" resolved by state, never by missing rows.
- **Effective-dating**: tax rates and regulator codes as time-versioned
  schedules, so historical resubmissions reproduce the rules of their day.
- **An offline test harness as the definition of done**: the whole DAG plus
  119 unit tests, 53 integration expectations and 16 negative tests
  (deliberate corruption that must be caught), green in seconds, no cloud.

**The demo operator** (`dataform-website/` — Python/Flask/DuckDB): a
fictitious gaming site (sportsbook + casino) generating the pipeline's OLTP
for real — accounts, KYC, limits, payments, bets with fast settlement,
golden chips, an opt-in operator jackpot with gaming sessions — plus a SOAP
**regulator SAFE** (per-jurisdiction, per-record-type endpoints storing
pretty-printed XML), a near-realtime **submission engine**, and daily/monthly
**financial reconciliation PDFs** per jurisdiction (cash vs settlement GGR
with an exact bridge, three-way completeness, duty computation).

**The explainers**: guided reading path, decision-maker overview, the SQL
Server translation guide, ER + data-flow diagrams (Markdown + PDF), three
fully-traceable worked requirements, and the generated SQL written out
readably in both dialects.

## How local and BigQuery execution work side by side

The claim "develop offline, deploy to the cloud as a formality" rests on
five deliberate pieces of engineering:

1. **One SQL source, generated.** No model's SQL exists twice. Every
   statement is produced by pure JS functions in `dataform-example/includes/`
   (`models.js`, `queries.js`, `rules.js`, …), and *both* runtimes call the
   same functions: the Dataform `definitions/` wire them into `publish()`
   for BigQuery, and `local/run.js` wires the identical functions into a
   DuckDB execution plan.
2. **A dialect layer as the single point of divergence.** The two engines
   agree on almost everything the pipeline uses (window functions,
   `QUALIFY`, `COALESCE`, `CASE`); where they genuinely differ — text
   normalisation, SHA-256, timezone/date conversion, regex syntax, date
   truncation, interval arithmetic, age calculation — the expression lives
   in `includes/dialect.js` with **both implementations and a test**, and
   nowhere else. Builders call `dialect.localDate(...)`; a process-wide
   `setDialect('duckdb'|'bigquery')` switch decides what that emits.
   Diffing `dataform-sql/duckdb/` against `dataform-sql/bigquery/` shows
   this is the *complete* list of differences.
3. **One seed, two loaders.** Test data is data too: `seed/data.js` is the
   single definition, from which `seed/generate.js` emits both the BigQuery
   console script (`bigquery_setup.sql`) and the offline DuckDB load — so
   local runs and cloud runs compute over identical inputs.
4. **Engine-behaviour parity handled explicitly.** Where the engines agree
   on syntax but disagree on semantics, the code spells the intent out
   rather than trusting defaults — e.g. `LEAST()` treats NULLs differently
   across engines, so a null-safe minimum is written explicitly; week
   truncation pins Monday on both; regex flavours are isolated behind one
   function.
5. **The offline harness as the gate.** `npm run check` executes the full
   DAG — every model, assertion, expectation and negative test — in an
   embedded DuckDB with zero GCP dependency. Because the SQL, the seed and
   the dialect layer are shared, a green local run *is* evidence the
   BigQuery deployment will behave identically; `dataform compile` then
   confirms the blast radius before anything ships.

A common question deserves its own pointer: *what does Dataform itself do
here, and how can this run offline without it — especially with no `.sqlx`
files?* Short version: `.sqlx` is optional; this project uses Dataform's
**JavaScript API**, so the `definitions/` files contain wiring only (no
SQL), all statements live in plain JS functions any host can call, and
`local/run.js` is a ~200-line stand-in that performs Dataform's jobs
(reference resolution, dependency order, materialisation, assertions)
against DuckDB. It isn't a claim, it's verified: `npm run dataform:compile`
runs the genuine `@dataform/cli` against the staged pure workspace
(`workflow_settings.yaml` + `definitions/` + `includes/`) — 201 actions
across 66 datasets, the same 66 models the harness executes. The full
explanation, with a responsibility-by-responsibility table, is in
[`dataform-example/ARCHITECTURE.md`](dataform-example/ARCHITECTURE.md) § 7,
"What Dataform actually does here — and how offline works without it".

## How to read this project

Don't start with the code — start with the *ideas*, then watch them run,
then read the code with the ideas in hand. The recommended path:

1. **Get the map** — [`README_FIRST.md`](README_FIRST.md). Three minutes.
   It sequences everything below and lists the foundational concepts
   (variance is data; config flows down only; rules compile to
   clause-named assertions; two-hop nomenclature; the offline harness as
   the definition of done; quarantine-first fault isolation; two engines,
   one SQL source).
2. **Understand the why** — [`OVERVIEW.md`](OVERVIEW.md): the economics of
   17 forks vs one config-driven codebase, the legacy-vs-this comparison
   table, and the honest trade-offs.
3. **If you come from SQL Server / OLTP reporting** —
   [`technology-skills-migration.md`](technology-skills-migration.md)
   translates every construct you already know (triggers, procs, views,
   `IF @Market`) into where it lives here, and shows the same requirement
   written both ways.
4. **Make it concrete** — run the pipeline (`cd dataform-example &&
   npm install && npm run check`) and browse
   [`dataform-sql/`](dataform-sql/README.md), where every generated model
   and assertion is written out readably in both dialects. Change one value
   in `includes/jurisdictions.js`, re-run, and watch the SQL move — that
   experience *is* the architecture lesson.
5. **See it live** — the fictitious operator ([`readme-web.md`](readme-web.md)):
   register, deposit, bet, play; watch settlements flow to the regulator
   SAFE in near-realtime; generate the per-jurisdiction financial
   reconciliations ([`financial-reconciliations.md`](financial-reconciliations.md)).
6. **Watch change land** — the worked scenarios in
   [`requirements/`](requirements/): a regulatory change
   (max-stake-limits), a promotional product (golden-chips), and a play
   incentive with session tracking (operator-jackpots) — each taken from
   requirement → overview → step-by-step implementation, with every
   artifact traced back and the legacy cost comparison spelled out.
7. **Go deep** — [`dataform-example/ARCHITECTURE.md`](dataform-example/ARCHITECTURE.md)
   (the layer stack, runtime DAG, nomenclature, rule engine, fault
   isolation, effective-dating), the ER and data-flow diagrams in
   [`dataform-example/docs/diagrams/`](dataform-example/docs/diagrams/README.md),
   and the maintainer contract in
   [`dataform-example/CLAUDE.md`](dataform-example/CLAUDE.md).

If you internalise only one sentence, make it the one the whole design hangs
from: **market variance is data; business logic exists exactly once.**
Everything else — the layers, the generated SQL, the clause-named rules, the
offline gate, the worked scenarios — is that sentence, taken seriously.

*Everything here is fictitious: no real money, odds, brands or gambling.
Regulatory specifics are drawn from public sources for realism and flagged
for verification against primary texts before any production use.*
