# rd-unified-platform

A working proof-of-concept for migrating a 14-year legacy regulatory-reporting
estate — **17 gaming markets**, each historically its own fork of SQL Server
stored procedures — to **one config-driven codebase** where every market
difference is *data* and every piece of logic exists *once*. Production targets
BigQuery + Dataform; the entire pipeline also runs offline in DuckDB in seconds.

*Authored by **Jonathan (Jono) Hudson** — purpose and a guided reading path in
[`AUTHOR.md`](AUTHOR.md).*

> **Start here → [`README_FIRST.md`](README_FIRST.md)** — the guided reading
> path. Three minutes there saves an hour everywhere else.

## What's in this repo

| Where | What |
|---|---|
| [`README_FIRST.md`](README_FIRST.md) | **The map** — how to digest this material, in order |
| [`OVERVIEW.md`](OVERVIEW.md) | The *why*, for technical decision-makers: 17 stored-proc forks vs one config-driven codebase |
| [`technology-skills-migration.md`](technology-skills-migration.md) | For SQL Server / OLTP engineers: where the triggers, procs, views and `IF @Market` went |
| [`performance-analysis.md`](performance-analysis.md) | In-depth performance comparison vs hand-crafted procs/triggers/views — runtime, write-path, scale and operational axes, with measured numbers and an honest "where legacy wins" |
| [`sql-developers-skill-gap.md`](sql-developers-skill-gap.md) | The people side: which SQL skills transfer, which are genuinely new, the psychological gap, failure patterns, and a realistic learning path using this repo as the curriculum |
| [`dataform-example/`](dataform-example/) | **The pipeline** — config-driven reporting for seven markets (MT, ES, DK, BG, GR, NL, DE), rule engine, nomenclature, player protection, fault isolation, offline DuckDB harness. See its `README.md`, `ARCHITECTURE.md`, `SETUP.md`, `CLAUDE.md` and `docs/diagrams/` |
| [`dataform-website/`](dataform-website/) + [`readme-web.md`](readme-web.md) | **The live demo** — a fictitious gaming site (BetNova), a SOAP regulator SAFE and a near-realtime submission engine, for demonstrating the architecture end to end by clicking |
| [`dataform-safe/`](dataform-safe/) | Where the demo SAFE stores accepted regulator records (pretty-printed XML) |
| [`dataform-sql/`](dataform-sql/README.md) | **The generated SQL, written out for reading** (transient; `npm run emit-sql`) — every model and assertion in both DuckDB and BigQuery dialects, so SQL developers can see the architecture in their own terms |
| [`financial-reconciliations.md`](financial-reconciliations.md) + [`dataform-reconciliation/`](dataform-reconciliation/README.md) | **Financial reconciliation** — daily & monthly PDF per jurisdiction reconciling the OLTP against what was reported to each regulator: cash vs settlement GGR with the open-bets bridge, three-way completeness, and the GGR duty computation |
| [`requirements/`](requirements/) | **Worked change scenarios**, each taken from requirement → overview → implementation with full traceability: [max-stake-limits](requirements/max-stake-limits/requirements.md) (a UKGC-style regulatory change: age-banded, effective-dated slots stake caps), [golden-chips](requirements/golden-chips/requirements.md) (a promotional product: operator-funded table-game chips and what they do to GGR and the reconciliation) and [operator-jackpots](requirements/operator-jackpots/requirements.md) (an opt-in play incentive with pooled contributions, RNG draws, gaming sessions on every play, and a magic-number game type) — showing how this architecture absorbs change vs the legacy estate |
| `dataform-starter/` | The wider migration scaffold (CDC strategy, recon generators, submission-service skeleton) |

## Two-minute quick start

```bash
# the pipeline, fully offline (needs Node 18+)
cd dataform-example
npm install && npm run check     # tests + demo + whole pipeline in DuckDB

# the live demo (needs Python 3.14; venv at the repo root)
py -3.14 -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python dataform-website/app.py    # site :5001, SAFE :5002
```

Everything in the demo is fictitious — no real money, odds, brands or gambling.
