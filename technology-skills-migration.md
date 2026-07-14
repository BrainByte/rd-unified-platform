# Technology & Skills Migration — from SQL Server OLTP reporting to a config-driven warehouse pipeline

*For engineers who build regulatory/near-real-time reporting the traditional
way: SQL Server (or similar) with **tables, views, triggers, stored procedures,
functions**, scheduled by SQL Agent and surfaced through SSRS. You are about to
be asked to build the same regulatory outputs here — and your instinct will be
to look for the trigger, the proc, and the reporting table. This document maps
what you know onto what this codebase does, names the constructs that have
**moved or disappeared**, and shows the same requirement written both ways.*

**Read [`OVERVIEW.md`](OVERVIEW.md) first** for the *why* (17 stored-proc forks
→ one config-driven codebase). This page is the *how does my skill set
translate*. See also the visual model in
[`dataform-example/docs/diagrams/`](dataform-example/docs/diagrams/README.md) —
the [physical ER](dataform-example/docs/diagrams/ER-PHYSICAL.md) is deliberately
drawn in the tables-and-columns shape you already think in, and the
[data-flow diagram](dataform-example/docs/diagrams/DATA-FLOW.md) shows where
triggers/procs/views went.

---

## 1. The one reframe that unlocks everything

In an OLTP reporting system you write **imperative SQL that runs against a live,
mutable database**: a trigger fires on a row change, a proc walks a cursor or a
set and writes a reporting table, a view computes on read. The database *is* the
program state, and you edit it in place.

Here, you write **pure functions that *emit* SQL text**, and that SQL is run by a
build tool (Dataform in the cloud, a small runner offline) to **rebuild** derived
tables from immutable inputs. The pipeline is a **DAG** (directed acyclic graph)
of table-building steps, not a set of triggers reacting to writes.

> **You stop writing the SQL that computes the answer, and start writing the
> configuration + small functions that *generate* that SQL — once — for every
> market.**

Nothing is hidden (this is not an ORM): run `node demo/compile-demo.js` and you
see the exact SQL, the same `SELECT … FROM … JOIN …` you'd have hand-written.
The difference is it was written **once and parameterised by data**, instead of
copied and edited per market.

---

## 2. Where did my constructs go? (the translation table)

| SQL Server construct | You used it to… | Here it becomes… | Where |
|---|---|---|---|
| **Table** (base, OLTP) | Store transactional truth | Stays in the **source system**; replicated into the warehouse by **CDC** as append-only `cdc_*` landing tables (`_op`, `_commit_ts`) | `cdc_landing.*`, `definitions/00_sources` |
| **View** | Compute-on-read, hide joins | A **model** — a `SELECT` materialised as a view (`stg_*`) or table (`dim_*`/`fct_*`) by the build tool | `includes/models.js`, `definitions/10_staging`, `20_core`, `25_gaming` |
| **Stored procedure** (the report builder) | Imperative build of a reporting table, scheduled | A **query-builder function** `(ctx, config) => "SQL"` run by the DAG; **no cursors, no imperative flow** — set-based SQL generated from config | `includes/queries.js`, `models.js` |
| **Scalar / inline function** | Reusable expression (rounding, hashing, tz) | A **field/expression generator** (JS returning a SQL fragment) + the **dialect layer** for engine-specific bits | `includes/fields.js`, `includes/dialect.js` |
| **Trigger** (enforce an invariant on write) | "voided ⇒ payout 0", "no activity while excluded" | Split in two: the **model computes** the derived value once; a **declarative rule → assertion** *proves* the invariant and **blocks the pipeline** if violated | `includes/rules.js`, `definitions/90_assertions`, `player_protection.js` |
| **CHECK / FK / UNIQUE constraint** | Guarantee data shape | **Assertions** (`uniqueKey`, `nonNull`, rule violations) that fail the build; declarative, named, testable | model `assertions: {…}`, rule engine |
| **MERGE / UPSERT** | Keep a reporting table current | **Incremental models** + idempotent `CREATE OR REPLACE`; dedupe is a `QUALIFY ROW_NUMBER()` in staging, not a MERGE | `stg_*` models, `submission_ready_*` (incremental) |
| **Index / statistics tuning** | Make the report fast | **Partitioning / clustering** (e.g. `partitionBy: report_date`); columnar engines — you rarely hand-tune | `definitions/30_submissions`, BigQuery config |
| **SQL Agent job / schedule** | Run the procs periodically | The **DAG run** (Dataform schedule / orchestration); offline it's `npm run local` | `local/run.js`, Dataform |
| **SSRS / report layer** | Render the output | The **submission tables** are the deliverable (a regulator file/feed); rendering/submission is a separate concern (a future SOAP service) | `submission_ready_*`, `tax_summary_*` |
| **Per-market proc fork** (`usp_MT_*`, `usp_ES_*`) | One implementation per market | **One function + N config objects**; a loop fans out all markets | `jurisdictions.js` + `submissions.js` |
| **Linked-server / ETL for a new feed** | Bespoke import per provider | An **adapter registry** entry; normalising SQL generated | `includes/providers.js` |
| **Temp tables / CTEs in a proc** | Stage intermediate results | **Named models** in the DAG (each intermediate is a first-class, testable table) or CTEs inside one model | `includes/models.js` |
| **Dynamic SQL** (`sp_executesql`) | Parameterise structure | **JS string composition** — the safe, testable, reviewable version of dynamic SQL | all `includes/*.js` |

---

## 3. The five things that will feel missing (and where they went)

### 3.1 "Where is my trigger?" — invariants are declarative, not reactive

In T-SQL you'd enforce *"a voided bet must report payout 0"* with a trigger or
inside the settlement proc:

```sql
-- Legacy: imperative, fires on write, lives per-market, easy to drift
CREATE TRIGGER trg_BetSlip_VoidZeroesPayout ON dbo.BetSlip
AFTER UPDATE AS
BEGIN
  UPDATE b SET b.Payout = 0
  FROM dbo.BetSlip b JOIN inserted i ON b.SlipId = i.SlipId
  WHERE i.Status = 'VOIDED';
END
```

Here it is **two separate, explicit things**:

1. **Compute it once**, in the lifecycle model — set-based, market-agnostic:
   ```js
   // includes/models.js — fct_bet_slip_lifecycle
   IF(l.voided_at IS NOT NULL, 0, l.payout) AS payout
   ```
2. **Prove it can never be wrong**, as a declarative rule that becomes a
   pipeline-blocking assertion named by the regulator's clause:
   ```js
   // includes/jurisdictions.js — a rule is DATA
   { id: "MT-103", type: "zero_when", field: "payout",
     whenField: "slip_status", equals: "VOIDED" }
   ```
   If any row ever violates it, the build **fails** with the clause id, and a
   **negative test** (`local/run.js`) deliberately corrupts a row to prove the
   check bites. A trigger silently fixes; an assertion loudly refuses to ship.

The compliance-critical invariants (deposit/loss limits, wallet overspend,
activity-while-excluded, unverified withdrawals) are all this shape:
`rg_breach_*` models that **must return zero rows**. See
`includes/player_protection.js`.

### 3.2 "Where is my stored procedure?" — a proc becomes a function + config

The classic per-market tax proc, duplicated 17× with the rate baked in:

```sql
-- Legacy: usp_MT_TaxSummary (and a near-identical usp_ES_TaxSummary, ...)
CREATE PROCEDURE dbo.usp_MT_TaxSummary @ReportDate date AS
BEGIN
  INSERT INTO dbo.TaxSummary_MT (ReportDate, Stake, Payout, TaxDue)
  SELECT @ReportDate, SUM(Stake), SUM(Payout),
         ROUND(SUM(Stake - Payout) * 0.05, 2)   -- MT rate hard-coded
  FROM dbo.BetSlip WHERE Status='SETTLED' AND Market='MT'
    AND CAST(SettledAt AS date) = @ReportDate;
END
```

Here there is **one** builder; the rate is **config** (and effective-dated), and
**eight markets come from one loop**:

```js
// includes/queries.js — ONE function, every market
ROUND(ggr_sum * (${rateSql(j.taxRate, "report_date")}), ${j.rounding}) AS tax_due
// includes/jurisdictions.js — the rate is data, versioned in time
taxRate: [{ rate: 0.20, to: "2026-01-01" }, { rate: 0.25, from: "2026-01-01" }]
// definitions/30_submissions/submissions.js — the fan-out (no per-market SQL)
for (const j of Object.values(jurisdictions)) { publish(`tax_summary_${j.code.toLowerCase()}`)… }
```

You never write `usp_XX_TaxSummary` again. Adding market #7's tax summary is a
config object, not a new proc.

### 3.3 "Where is `if @Market = 'ES'`?" — it is forbidden, on purpose

The single most important habit to unlearn: **you may not branch on the market
inside shared logic.** No `CASE WHEN market = 'ES'`, no `IF @Market`. That branch
is exactly how 17 forks drift. Market difference must be **a value in
`jurisdictions.js`** that the one code path reads. When a market needs a datum no
other market has, it does **not** get a new column or table — it rides in the
**extension layer** (a generic `cdc_reg_attributes` key/value carrier, or a
computed attribute), see `includes/extensions.js`. The shared model never widens.

### 3.4 "Where is my near-real-time?" — it becomes provable micro-batch

Your instinct is triggers keeping a reporting table live so SSRS reads current
data. Here the flow is **CDC → landing → scheduled DAG rebuild → submission
tables**:

- **Latency** moves from sub-second to micro-batch (seconds-to-minutes,
  scheduler-driven). That is a **deliberate trade**, and for *regulatory*
  reporting it's the right one: filings are daily/monthly, and what regulators
  demand is **provable correctness and reproducibility**, not sub-second freshness.
- What you gain for that latency: every run is **replayable** from immutable CDC,
  a change is **tested offline in seconds**, the **compliance gate** blocks bad
  data *before* it ships, and a historical period **resubmits exactly** (see
  effective-dating). A trigger-driven live table gives you none of those.
- If you genuinely need lower latency later, the DAG cadence is a scheduling
  choice (micro-batch / incremental), not a rewrite.

### 3.5 "Where is ACID / where are my transactions?" — different layer, different job

The **OLTP database still exists** — upstream, owned by the product. This
pipeline is the **reporting/warehouse layer fed from it by CDC**; it is not
trying to be your transactional store. So:

- No inter-row transactions to manage; models are **idempotent rebuilds**
  (`CREATE OR REPLACE` / incremental) — re-run any step and you get the same
  result.
- Integrity you'd get from FK/CHECK/UNIQUE is expressed as **assertions**
  (`uniqueKey`, `nonNull`, rule violations) that fail the build.
- "Current state" from a mutable table becomes a **dedupe** over append-only CDC:
  `QUALIFY ROW_NUMBER() OVER (PARTITION BY key ORDER BY _commit_ts DESC) = 1`
  in the `stg_*` models — that's your "latest row image", the equivalent of the
  OLTP row you'd have read live.

---

## 4. A worked example end-to-end (both ways)

**Requirement:** *"Produce Spain's daily settled-bet file and tax summary;
voided bets are excluded; the player identifier is the SHA-256 of the DNI; tax is
20% of GGR."*

**Legacy (SQL Server), roughly:**
- a reporting **view** `vw_ES_SettledBets` joining slips/accounts/fixtures with
  `WHERE Market='ES' AND Status='SETTLED'` and a `HASHBYTES('SHA2_256', DNI)`;
- a **proc** `usp_ES_DailyFile` that inserts it into `ES_Submission`;
- a **proc** `usp_ES_TaxSummary` with `* 0.20` baked in;
- a **SQL Agent** schedule;
- and **the whole thing copied** to build MT, DK, BG, GR, NL with their own
  `WHERE`, hash, and rate — six near-identical forks.

**Here:**
- The **shared** builders `submissionQuery` / `taxSummaryQuery`
  (`includes/queries.js`) already express the join, the settled/void filter, the
  tax maths — **once**.
- Spain is **one config object** in `jurisdictions.js`: `code:"ES"`,
  `taxRate: 0.20`, its void policy, `playerId` = hashed DNI (a field rule), its
  regulator sport codes, its declarative rules (`no-voids`, hash format).
- The fan-out loop in `definitions/30_submissions` emits `submission_ready_es`
  and `tax_summary_es` — and every other market — with **zero per-market SQL**.
- Correctness is proven by `npm run local`: the models build, the ES assertions
  pass, integration expectations pin the exact ES numbers, and negative tests
  prove the guardrails fire. No SQL Server, no manual review of six forks.

The ES/MT/DK/BG/GR/NL differences that would have been six code forks are, here,
[six rows of a table](OVERVIEW.md#market-comparison-matrix).

---

## 5. Habit swaps (unlearn → learn)

| Old habit | New habit |
|---|---|
| Edit the proc/table in place on the server | Edit a **pure function or config**, commit to git; the build reproduces state |
| Branch per market (`IF @Market`) | Add/adjust **data** in `jurisdictions.js`; never branch in shared logic |
| Enforce invariants with triggers | Express them as **declarative rules / assertions** that block the pipeline |
| New column/table for a market's quirk | Put it in the **extension carrier**; don't widen the shared model |
| Test by running procs on a SQL Server with sample data | `npm run check` — unit tests + the **whole pipeline offline in DuckDB**, seconds |
| "It works in prod" is the proof | **Green offline harness** is the definition of done; cloud deploy is a formality |
| Read comments to learn why a column exists | The **rule id = the regulator clause**; `git blame` = the change history |
| Tune indexes / rewrite for speed | Choose **partition/cluster keys** and incremental models; trust the columnar engine |
| Debug by stepping through a proc | Read the **generated SQL** (`compile-demo.js`), run the DAG, inspect the failing **assertion** |

---

## 6. A learning path tuned to your background

You already think in tables, joins and set logic — that transfers directly. The
new muscle is *"variance is data; logic is one generated SQL path."* Read in this
order:

1. **[`OVERVIEW.md`](OVERVIEW.md)** — the economic case; the 17-fork problem you
   may recognise.
2. **This page** — the construct-by-construct translation (you're here).
3. **Run it** — from `dataform-example/`: `node demo/compile-demo.js` then
   `npm run local` ([`dataform-example/SETUP.md`](dataform-example/SETUP.md) for
   prerequisites). Seeing the generated SQL — ordinary `SELECT`s you could have
   written — is the moment it clicks.
4. **[`ER-PHYSICAL.md`](dataform-example/docs/diagrams/ER-PHYSICAL.md)** — the
   real tables/columns per layer, in the shape you're used to; and
   **[`DATA-FLOW.md`](dataform-example/docs/diagrams/DATA-FLOW.md)** — where CDC,
   staging, the marts and the assertion gate sit (i.e. where your
   triggers/procs/views went).
5. **[`dataform-example/README.md`](dataform-example/README.md)** — the worked
   MT/ES/DK/BG/GR/NL/DE example and what the tests cover.
6. **[`dataform-example/ARCHITECTURE.md`](dataform-example/ARCHITECTURE.md)** —
   the layer stack (§2), the runtime DAG (§3), two-hop nomenclature (§4), the
   rule engine (§5), fault isolation (§6), and two-engines-one-source (§7).
7. **[`dataform-example/CLAUDE.md`](dataform-example/CLAUDE.md)** — the
   maintainer contract and the **recipes** ("add a market", "add a rule",
   "add a market-specific attribute") — your day-to-day reference.
8. **The code**, config-first (under `dataform-example/includes/`):
   `jurisdictions.js` → `fields/filters/queries.js` → `rules.js`/`validate.js`
   → `models.js` + `local/run.js`.

If a constraint (like the forbidden `if (market === …)`) looks arbitrary, you've
skipped the mental model — go back to `OVERVIEW.md` and step 3.

---

## 7. Quick FAQ

- **"Can I still write SQL?"** Yes — you write *more* SQL, more explicitly, but
  as reusable generated fragments, and you read the compiled SQL any time:
  `npm run emit-sql` writes **every** generated model and assertion to the
  repo-root [`dataform-sql/`](dataform-sql/README.md) folder (both DuckDB and
  BigQuery dialects, transient, purely for reading) — browse it exactly like
  a folder of stored-proc scripts, then change one config value and watch it
  regenerate.
- **"Do I need to learn BigQuery?"** Very little day-to-day: the only
  engine-specific SQL lives in `includes/dialect.js`; everything else runs
  identically on the offline DuckDB engine you develop against.
- **"What is Dataform, and why can this run without it?"** Dataform is the
  cloud scheduler/orchestrator role in your old world (think SQL Agent + the
  deployment scripts): it resolves table references into a dependency graph,
  creates the tables, and runs everything in order against BigQuery. Here it
  is kept deliberately thin — the `definitions/` files are wiring only, all
  SQL lives in plain functions, and offline a ~200-line runner
  (`local/run.js`) performs the same four jobs against DuckDB. Full
  explanation: `dataform-example/ARCHITECTURE.md` § 7.
- **"How do I do an upsert / keep it current?"** Incremental models +
  `partitionBy`; dedupe via `QUALIFY ROW_NUMBER()` in staging. No MERGE.
- **"Where do I put a shared helper (my old scalar function)?"** A field
  generator in `includes/fields.js` (or `dialect.js` if it's engine-specific).
- **"How do I add market #7?"** One object in `jurisdictions.js` — see the
  `CLAUDE.md` recipe. No new procs, views, tables, or triggers.
- **"What replaces SSRS?"** The submission tables *are* the machine-readable
  deliverable; human-facing rendering/submission is a separate downstream service
  (see `dataform-example/CLAUDE.md` open items — the SOAP submission engine; a
  working local prototype, a fictitious regulator SAFE fed near-realtime over
  SOAP, ships with the demo site — see [`readme-web.md`](readme-web.md)).

---

*Main documents: [`README_FIRST.md`](README_FIRST.md) (navigation) ·
[`OVERVIEW.md`](OVERVIEW.md) (why) ·
[`dataform-example/README.md`](dataform-example/README.md) (worked example) ·
[`dataform-example/ARCHITECTURE.md`](dataform-example/ARCHITECTURE.md) (how) ·
[`dataform-example/SETUP.md`](dataform-example/SETUP.md) (run it) ·
[`dataform-example/CLAUDE.md`](dataform-example/CLAUDE.md) (maintainer contract) ·
[`dataform-example/docs/diagrams/`](dataform-example/docs/diagrams/README.md)
(ER + data-flow diagrams) · [`readme-web.md`](readme-web.md) (live demo stack).*
