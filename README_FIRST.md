# Read Me First — how to navigate this material

This project is small but the *ideas* build on each other. Read in the
wrong order and the code looks like unusual SQL plumbing; read in the
right order and it clicks into a single, coherent design. This page is
the map. Spend three minutes here before opening anything else.

---

## What this repo is (in one paragraph)

A proof-of-concept for migrating a 14-year legacy regulatory-reporting
estate — **17 gaming markets**, each historically its own fork of SQL
Server stored procedures — to **one config-driven codebase** where every
market difference is *data* and every piece of logic exists *once*. It
targets BigQuery + Dataform in production and runs its whole test
pipeline offline in DuckDB in seconds. The pipeline lives in
**`dataform-example/`**; the repo also carries a fictitious demo gaming
site + regulator SAFE (`dataform-website/` — see `readme-web.md`) for
demonstrating the architecture end to end, live.

---

## The one idea everything else depends on

> **Market variance is DATA. Business logic exists exactly ONCE.**

Almost every design choice in this repo is downstream of that sentence.
If you internalise nothing else before reading the code, internalise
this — otherwise the layering, the rule engine, and the "you may never
write `if (market === …)` in shared logic" rule will look arbitrary
instead of inevitable.

---

## The golden path (read in this order)

Each document has a distinct job and assumes you've absorbed the one
before it. Don't skip ahead — later docs are terse *because* the earlier
ones did the groundwork.

| # | Read | Why it's here / what to take away | ~Time |
|---|---|---|---|
| 1 | **[`OVERVIEW.md`](OVERVIEW.md)** | The *why*. The problem with 17 stored-proc forks, the core idea, and the legacy-vs-this comparison. Builds the mental model. | 10 min |
| 2 | **Run it** (see below) | The *aha*. Seeing the whole pipeline go green offline — and reading the SQL your config generates — makes every later concept concrete. | 10 min |
| 3 | **[`dataform-example/README.md`](dataform-example/README.md)** | The *what*. The worked example: the deliberate MT/ES/DK/BG/GR/NL/DE differences, expected outputs, and what the tests cover. | 10 min |
| 4 | **[`dataform-example/ARCHITECTURE.md`](dataform-example/ARCHITECTURE.md)** | The *how*. The layer stack, the runtime DAG, the two-hop nomenclature, the rule engine, and the two-engines-one-source design. Diagrams render in GitLab. | 25 min |
| 5 | **[`dataform-example/CLAUDE.md`](dataform-example/CLAUDE.md)** | The *contract*. The layer map, the non-negotiable rules, the recipes for common changes, and the live project status / open items. This is the maintainer's rulebook (human or AI). | 15 min |
| 6 | **The code** (guided tour below) | The *proof*. Everything above, made real in small pure functions. | 45 min |

If you only have **5 minutes**: read the TL;DR and comparison table in
`OVERVIEW.md`. If you have **30**: do steps 1–3. For a full working
grasp: all six.

---

## Coming from a traditional SQL Server / OLTP reporting background?

If you build near-real-time regulatory reporting the classic way — **tables,
views, triggers, stored procedures, functions**, scheduled by SQL Agent and
surfaced through SSRS — read
**[`technology-skills-migration.md`](technology-skills-migration.md)** alongside
steps 1–3. It maps every construct you know onto this design (where the
trigger, the proc, the view, and `IF @Market` went), and shows the *same*
requirement written both ways. It will save you hunting for the reporting table
that no longer exists. The visual companions are
[`dataform-example/docs/diagrams/ER-PHYSICAL.md`](dataform-example/docs/diagrams/ER-PHYSICAL.md)
(the real tables/columns, in the shape you already think in) and
[`dataform-example/docs/diagrams/DATA-FLOW.md`](dataform-example/docs/diagrams/DATA-FLOW.md)
(where CDC, staging, the marts and the assertion gate sit).

---

## Get hands-on early (step 2)

Concreteness beats prose here. You need only Node.js (the offline engine
is a dev-only dependency) — see
**[`dataform-example/SETUP.md`](dataform-example/SETUP.md)** for
prerequisites, platform notes and troubleshooting:

```bash
cd dataform-example         # everything below runs from here
node demo/compile-demo.js   # prints the SQL your CONFIG generates — the
                            # single best way to *see* "variance as data"
npm run emit-sql            # writes ALL generated SQL (both dialects) to
                            # the repo-root dataform-sql/ folder to READ
npm run local:dry           # the execution plan (works with no install)
npm install                 # once — pulls the offline DuckDB engine
npm run local               # the WHOLE pipeline in DuckDB: models +
                            # rule assertions + expectations + negative
                            # tests, green in seconds, no cloud
node --test                 # the unit tests over every generator
```

`compile-demo.js` is the fastest way to grasp the whole idea: you change
a value in `includes/jurisdictions.js`, re-run it, and watch the
generated SQL change — with no SQL edited by hand. The **negative tests**
in `npm run local` are worth pausing on: they corrupt data on purpose to
prove the regulatory guardrails actually fire.

---

## Foundational concepts — do not skip these

These are load-bearing. Each later part of the material assumes you've
met the earlier ones. If something reads as arbitrary, you probably
skipped one of these.

1. **Variance is data; logic is singular.** *(OVERVIEW → ARCHITECTURE §2
   → CLAUDE non-negotiable rule #1.)* The root of everything.
2. **Config flows down only — the layer stack.** *(ARCHITECTURE §2.)*
   Config → fields → filters → queries → rules → generated SQL. Nothing
   flows back up; no business logic hides in the wiring.
3. **Declarative rules compile to pipeline-blocking assertions named by
   the regulator's clause id.** *(ARCHITECTURE §5.)* A rule is a testable
   object with a built-in audit trail, not a comment. A rule failure
   names the law it enforces and stops the file before it ships.
4. **Two-hop nomenclature.** *(ARCHITECTURE §4.)* Upstream names →
   canonical taxonomy → per-regulator codes. This is *why* 17 markets ×
   N dirty feeds doesn't become an N×M maintenance disaster. Grasp this
   before submissions will make sense.
5. **The offline harness is the definition of done.** *(README "Offline
   development" + ARCHITECTURE §7.)* If `npm run local` is green, the
   change is proven; BigQuery deployment is a formality, not a test.
6. **Extensions = structural variance without model sprawl.**
   *(ARCHITECTURE §2 "Jurisdiction extensions".)* When a regulator needs
   a datum no other market has, it rides in a generic carrier or is a
   computed attribute — the shared core is never widened, and no
   per-market table is created. Domains (e.g. gaming) are opt-in per
   market for the same reason.
7. **Fault isolation is quarantine-first; correctness ≠ completeness.**
   *(ARCHITECTURE §6.)* A bad/late/held row affects only itself — the run
   never aborts for everyone. Failures are routed by *why* (DATA →
   quarantine, TRANSIENT → retry, COMPLETENESS → wait, COMPLIANCE → hold);
   "not arrived yet" is told from "legitimately doesn't exist" by terminal
   *state*, never by a missing row. The one hard block is that nothing
   held/quarantined/incomplete ever reaches a regulator.
8. **Two engines, one SQL source.** *(ARCHITECTURE §7.)* The only
   engine-specific SQL lives in `includes/dialect.js`; everything else is
   generated once and runs on both BigQuery and DuckDB.

---

## Guided code tour (step 6, for engineers)

Read the code in dependency order — config first, generated SQL last —
mirroring how the data actually flows (all paths under
`dataform-example/`):

1. `includes/jurisdictions.js` — **the single source of truth.** Every
   market as data. Start here; the rest is machinery that reads it.
2. `includes/fields.js`, `filters.js`, `queries.js` — one SQL expression
   per concept, composed into full statements.
3. `includes/rules.js` + `includes/validate.js` — rule *types* → violation
   SQL, and the config pre-flight that blocks invalid config from
   compiling.
4. `includes/nomenclature/` — canonical taxonomy, aliases, the normalise
   twins. The maintenance loop (`unmapped_*` queues).
5. `includes/extensions.js` — the per-market attribute layer (Option B).
6. `includes/providers.js`, `includes/player_protection.js` — the same
   patterns applied to feed-shape variance and cross-cutting compliance.
7. `includes/models.js` + `local/run.js` — the model SQL, and the offline
   runner that executes the whole DAG.
8. `test/` — unit tests for every generator; read a couple to see how
   behaviour is pinned. `local/expectations.js` holds the integration
   checks.

`CLAUDE.md`'s "Recipes" section is your reference once you start making
changes (add a market, add a field, add a rule, add a market-specific
attribute).

---

## Misconceptions to leave at the door

- **"It's an ORM / it hides the SQL."** No — it *generates explicit SQL*
  you can read any time with `node demo/compile-demo.js`. Nothing is
  hidden; the SQL is just written once and parameterised.
- **"17 per-market output tables means 17 lots of code."** No — the
  submission tables are produced by *one* loop over the config. There is
  zero hand-written SQL per market.
- **"Adding a market or a market-specific field needs schema changes."**
  No — a market is a config object; a bespoke datum rides in the
  extension carrier. The shared core model doesn't move.
- **"The rules are documentation."** No — they execute, block the
  pipeline on any violation, and are proven by negative tests.
- **"I'll just read the code first."** You can, but you'll hit the
  forbidden `if (market === …)` rule and other constraints without the
  context that makes them obviously right. Read the mental model first.

---

## Where to go after

- Making a change? Follow the **workflow** in
  [`dataform-example/CLAUDE.md`](dataform-example/CLAUDE.md) ("Workflow
  for any change") and its recipes; the offline harness is your gate.
- Evaluating the approach? [`OVERVIEW.md`](OVERVIEW.md)'s comparison
  table and trade-offs section are written for that decision.
- Want to *show* someone rather than tell them? The demo stack —
  fictitious gaming site, regulator SAFE and near-realtime submission
  engine — is documented in [`readme-web.md`](readme-web.md).
- Want to see how a **real change** lands here vs the legacy estate? Read
  the worked scenarios in [`requirements/`](requirements/): a regulatory one
  ([max-stake-limits](requirements/max-stake-limits/requirements.md) —
  UKGC-style age-banded, effective-dated stake caps) and two product ones
  ([golden-chips](requirements/golden-chips/requirements.md) —
  operator-funded promotional chips and their GGR/reconciliation
  consequences; [operator-jackpots](requirements/operator-jackpots/requirements.md)
  — an opt-in pooled jackpot plus gaming sessions reported on every play).
  Each goes requirement → overview → step-by-step implementation with every
  artifact traced back.
- Curious where it's headed? `dataform-example/CLAUDE.md`'s **open
  items** list the agreed next steps (reconciliation/parallel-run, the
  SOAP submission service, real GCP deployment, scaling past 6 markets).
