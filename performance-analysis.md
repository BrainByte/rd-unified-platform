# Performance analysis — this architecture vs hand-crafted SQL Server

*An in-depth comparison of the runtime, write-path, scale, and operational
performance of this config-driven, generated-SQL architecture (BigQuery +
Dataform in production, DuckDB offline) against the traditional estate it
replaces: hand-crafted stored procedures, views, triggers, functions and
tables on SQL Server. Written to be honest — including where the legacy
approach genuinely wins.*

---

## 0. Scope and method

"Performance" here is four distinct things, analysed separately because they
trade against each other:

1. **Runtime performance** — how fast the reporting computation executes.
2. **Write-path performance** — what reporting costs the transactional system.
3. **Scale performance** — behaviour as data volume and market count grow.
4. **Operational performance** — reruns, backfills, failure recovery.

Where numbers are given for this repo they are **measured on this machine**
(Windows 11, consumer laptop, Node 24, DuckDB 1.4 embedded) against the demo
dataset — small data, so treat them as *floor* evidence for orchestration
overheads, not as benchmarks of analytical scale. Engine-level claims (row
vs columnar behaviour, trigger costs, lock semantics) are architectural
properties, cited to how the engines actually work.

## 1. The most important fact: generated SQL has no runtime cost

The instinctive worry — "an abstraction layer must be slower than
hand-written SQL" — misreads *when* the abstraction runs. This is not an
ORM. The JS builders run at **compile time**; what executes is ordinary,
fully materialised, set-based SQL (`dataform-sql/` shows every statement).
Generating all seven markets' SQL takes **~0.3 s** (measured, `node
demo/compile-demo.js`), once, before execution. At runtime the engine sees
exactly what it would see from a hand-written script — same parser, same
optimizer, same plan.

So the honest comparison is never "generated vs hand-written SQL" — it is
**"the SQL this generator emits" vs "the SQL seventeen teams wrote by hand
over fourteen years"**, running on their respective engines. Three
consequences follow:

- **Uniformity beats artisanal tuning at portfolio scale.** A hand-tuned
  proc can beat a generated statement in a specific hot path. But the
  generator emits *one* pattern per concept: improve `taxSummaryQuery` once
  and all seventeen markets get the faster shape in the same commit. In the
  legacy estate, an optimisation is a per-fork campaign — in practice most
  forks never receive it.
- **The generator cannot write the slow patterns.** There is no cursor
  construct, no RBAR loop, no scalar-UDF-per-row in the builder vocabulary —
  the classic ways hand-written T-SQL degenerates (a cursor loop over a
  million rows; a scalar function forcing row-by-row execution and, before
  SQL 2019, killing parallelism) are structurally unavailable.
- **Plan pathologies shrink.** Seventeen near-identical proc forks populate
  a plan cache with seventeen families of variants, each exposed to
  parameter sniffing and stale-statistics regressions independently. One
  generated shape per concept means one plan family to reason about — and on
  BigQuery, no plan cache or sniffing at all (each query is planned against
  current table stats).

## 2. Engine fit: the workloads were never the same shape

The legacy estate runs *analytical* work (period aggregations, full-file
builds, reconciliations) on an engine optimised for *transactional* work.
The performance gap between the approaches is mostly this mismatch:

| Operation class | SQL Server (row store, B-trees) | BigQuery (columnar, MPP) | Winner |
|---|---|---|---|
| Single-row lookup / update by key | **~1 ms** — this is what it's for | ~1–3 s floor (job dispatch) | **SQL Server, by orders of magnitude** |
| Small transactional write + commit | Sub-ms to ms | Not its job (streaming/batch loads) | **SQL Server** |
| Aggregate 3 columns over 100M rows | Minutes: full scan through the buffer pool, all columns paid for | Seconds: reads only the 3 columns, thousands of workers | **Columnar, typically 10–100×** |
| Build 17 market files concurrently | Sequential proc runs or self-inflicted contention on one box | Independent slots per model — true parallel fan-out | **MPP** |
| Point-in-time consistent read of many tables | Locks/RCSI version-store pressure while OLTP writes | Immutable snapshot; zero contention | **Warehouse** |
| Sub-second data freshness in a report | Triggers deliver it (at a price — §3) | Micro-batch minutes | **SQL Server** |

The architecture's answer to this table is not "columnar wins" — it is
**segregation**: each operation runs on the engine shaped for it. The OLTP
keeps doing sub-millisecond transactional work (the demo site's DuckDB plays
this role); CDC ships the changes; the analytical work happens where scans
are cheap. The legacy estate's deepest performance problem is that it never
made this split.

## 3. The write path: what triggers really cost

Trigger-based reporting is *synchronous bookkeeping inside the customer's
transaction*:

- Every `INSERT`/`UPDATE` on a betting table also executes the trigger body
  — extra reads, extra writes to reporting tables, extra index maintenance —
  **inside the same transaction**, extending lock hold times and adding
  milliseconds (sometimes much more) to every customer action, at peak, on
  the most latency-sensitive system the operator owns.
- Reporting tables maintained by triggers acquire their own locks; a slow
  reporting query can block the trigger, which blocks the customer commit.
  The failure couples *backwards* into revenue-generating traffic.
- Trigger chains (trigger fires trigger) make write cost superlinear in
  feature count — each new reporting requirement taxes every transaction
  again. Seventeen markets' worth of requirements compound on shared tables.

The CDC approach costs the OLTP **one log-reader** (Datastream tails the
transaction log; SQL Server CDC/replication-grade overhead, typically low
single-digit % and *asynchronous* — it never extends a customer
transaction). Every downstream computation happens off-box. The performance
budget of the transactional system is returned to transactions.

The demo makes the same split visible at small scale: BetNova's front-door
checks (limits, exclusion, balance) are the *operational* enforcement — a
handful of indexed lookups per action — while every heavy proof (breach
detection, reconciliation) runs set-based, later, elsewhere.

## 4. The read path: reporting queries against OLTP vs the warehouse

On the legacy estate, end-of-day file builds scan the live tables:

- **Buffer-pool pollution**: a full scan of a year of bets evicts the hot
  working set; customer-facing latency degrades *during* every report run.
- **Lock/version overhead**: consistent reads require shared locks (blocking
  writers) or RCSI (tempdb version-store growth under long scans).
- **All-column tax**: a row store reads entire rows to aggregate three
  columns; covering indexes mitigate at the price of write amplification on
  the OLTP side — paying at transaction time to speed reports.
- **The nightly window**: seventeen markets' proc suites compete for the
  same box in the same batch window; the window grows every year until it
  collides with the business day.

The warehouse side reads **immutable, partitioned, columnar** data with no
writer to contend with. Two design choices in this repo matter specifically:

- `submission_ready_*` tables are **incremental and partitioned by
  `report_date`** — the daily run touches the new partition, and regulator
  resubmissions prune to the partitions they need instead of scanning
  history (which is also the BigQuery *cost* control, since billing follows
  bytes scanned).
- The heavy shared work (staging dedupe, lifecycle pivot, canonicalisation)
  is computed **once** and fanned out to all markets — the legacy estate
  computes its equivalents seventeen times, once per fork.

## 5. Rules and assertions vs triggers and constraints

The performance model of an invariant differs completely:

- **Trigger/constraint (legacy)**: enforced per-row, at write time, forever
  — a small tax on every one of millions of transactions, paid on the OLTP.
  The total cost is O(transactions) *on the expensive engine*.
- **Assertion (here)**: one set-based query per batch — `SELECT violating
  rows` over a columnar scan, amortising to microseconds per row on the
  cheap engine, off the transactional path. 87 assertions run in this repo's
  harness as part of a **4-second** total pipeline (measured, small data;
  the point is the *shape*: each is one scan, not N row-events).

The trade is timing: a trigger stops a bad row *before commit*; an assertion
catches it *before publication*. For regulatory reporting, publication is
the boundary that matters — and the operational enforcement that genuinely
needs write-time latency (limits, exclusions) lives in the application front
door, where it is a keyed lookup, not a trigger cascade.

## 6. Latency and freshness — the honest trade

This is the axis where the legacy approach genuinely wins, and the analysis
should say so plainly:

- **Triggers give sub-second freshness.** A trigger-maintained reporting
  table reflects a bet milliseconds after commit. The DAG gives minutes
  (scheduler cadence), and that is a real reduction in capability.
- The mitigation is that the *requirement* is daily/monthly filings — the
  freshness demand is hours, met with orders-of-magnitude headroom. Where
  the operator genuinely needs near-real-time (the per-record regulator
  feed), the demo shows the correct pattern: an **event-driven service at
  the operator layer** (the submission engine polls seconds-fresh OLTP and
  SOAPs each record) — NRT where NRT is required, batch analytics where
  correctness is required, neither pretending to be the other.
- What the batch buys with those minutes: **provability** (replayable
  immutable inputs, an offline gate, deterministic resubmissions) — things a
  trigger-maintained mutable table cannot offer at any latency.

## 7. Scale behaviour: data volume and market count

**Data volume.** The row-store estate scales vertically: bigger box, more
licences (SQL Server Enterprise is licensed per core), and the batch window
still grows with history unless archival surgery is performed. The columnar
DAG scales horizontally and *elastically* — BigQuery brings thousands of
slots to a heavy day and none to a quiet one, with partition pruning keeping
the daily marginal work proportional to the day, not to history.

**Market count — the decisive economic axis.** Legacy: market #18 adds a
whole new proc suite to the shared box and the shared window — compute cost,
contention, and tuning surface all scale **linearly** in markets. Here:
market #18 added two models to a parallel DAG (Germany, this repo, measured:
the fan-out loop picked it up with zero orchestration changes; `dataform
compile` went from 187 to 201 actions). The shared upstream computation is
unchanged; the marginal runtime is two partitioned queries running in
parallel with everything else.

## 8. Operational performance: reruns, backfills, recovery

Often the dominant real-world cost, and the widest gap:

| Scenario | Legacy (trigger-maintained state) | This architecture (derived state) |
|---|---|---|
| Report run fails midway | Reporting tables left half-updated; manual repair scripts, hours–days | Re-run; `CREATE OR REPLACE` is idempotent |
| Regulator requests a resubmission of last March | Archaeology: what did the code/rates look like then? One-off script, days | Deterministic recompute of the partition; effective-dated rates reproduce March's rules (proven: BG 2025 at 20%/FUT) |
| A trigger silently misfired for 3 weeks | The reporting table is *wrong* and nothing knows; reconstruction is bespoke | State is derived from immutable CDC — rebuild and the error never persisted; assertions/recon would have flagged the divergence |
| Verify a change before deploy | Restore a prod-sized environment, run the suite, inspect manually | **4.1 s** (measured): the entire 66-model, 87-assertion pipeline + 56 expectations + 16 negative tests, on a laptop |
| Bulk historical backfill | Batched proc runs babysat overnight, contending with OLTP | A partition-ranged rerun on elastic compute, zero OLTP impact |

That measured 4.1 seconds deserves emphasis for what it implies rather than
what it is: the *whole* regulatory estate — every model for seven markets,
every rule, deliberate corruption tests — executes faster than a legacy
environment takes to log in. The performance of the *feedback loop* is the
performance developers actually live in.

## 9. Measured numbers from this repo

| Operation | Measured | Notes |
|---|---|---|
| Generate all SQL, 7 markets (`demo`) | **~0.29 s** | The entire "abstraction cost", paid at compile time |
| Full offline pipeline (`npm run local`) | **~4.1 s** | Seed load + 66 models + 87 assertions + 56 expectations + 16 negative tests, embedded DuckDB, one laptop |
| Unit tests (119, `npm test`) | **~2.1 s** | Node test-runner wall time incl. npm overhead (~0.6 s inside the runner) |
| Emit every statement, both dialects (`emit-sql`) | **~2.4 s** | 306 files: 2 × (66 models + 87 assertions) |
| Genuine `dataform compile` | ~10 s (npx-dominated) | 201 actions / 66 datasets validated for BigQuery |

Small data, deliberately — these measure **orchestration and generation
overhead**, and show it is negligible. The analytical-scale claims in §2–§4
rest on engine architecture (columnar projection, slot parallelism,
partition pruning), which is precisely why production targets BigQuery
rather than the harness engine.

## 10. Where hand-crafted SQL Server genuinely wins

For honesty and for scoping future decisions:

- **Sub-second freshness** on operational dashboards fed by triggers (§6).
- **Point access patterns** — any workload dominated by single-row reads
  and writes belongs on the OLTP and stays there in this design.
- **Tiny scale** — one market, gigabytes not terabytes, an existing paid-for
  server: the columnar/CDC machinery is overhead you may never repay. This
  architecture's economics *depend* on the 17-market portfolio.
- **A single ultra-hot query** where a specialist with index hints, plan
  freezing and a covering index beats the generic shape — real, but a
  per-query victory that doesn't survive multiplication by seventeen forks,
  and the generated pattern can adopt the same optimisation once, for all.
- **No egress/scan billing surprises** — a capex box has flat costs;
  BigQuery requires partition/cluster discipline (this repo's partitioned
  incrementals are that discipline) to keep scan costs proportional.

## 11. Verdict

| Axis | Winner | Margin |
|---|---|---|
| Runtime of the SQL itself | Tie | Generated SQL *is* SQL; no runtime abstraction exists |
| Analytical computation at scale | This architecture | Columnar + parallel fan-out: typically 10–100× on scan-heavy work |
| Transactional write-path cost | This architecture | CDC is asynchronous; triggers tax every customer transaction |
| Data freshness | **Legacy** | Sub-second (triggers) vs minutes (DAG) — mitigated by requirement fit + an NRT operator-layer feed |
| Single-row access | **Legacy engine** | And this design agrees: that work stays on the OLTP |
| Scale with markets | This architecture | Marginal cost of market #18 ≈ two parallel partitioned queries (demonstrated with Germany) |
| Reruns / backfills / recovery | This architecture | Idempotent, deterministic, elastic — vs manual repair of mutable state |
| Verification feedback loop | This architecture | 4.1 s for the whole estate vs environment-sized regression cycles |
| Peak specialist tuning of one query | **Legacy, sometimes** | But an optimisation here deploys to all markets at once |

The pattern across every axis is the same: the legacy approach optimises
individual operations on a single engine; this architecture optimises the
**system** — putting each workload on the engine shaped for it, computing
shared work once, parallelising the per-market work, and making the
expensive human operations (verify, rerun, backfill, tune) cheap. At one
market the legacy estate is competitive; at seventeen, the system-level
design wins on nearly every axis while paying a bounded, requirement-safe
price in freshness.

---

*Companions: [`OVERVIEW.md`](OVERVIEW.md) (delivery-speed and maintainability
economics), [`technology-skills-migration.md`](technology-skills-migration.md)
(construct-by-construct translation),
[`dataform-example/ARCHITECTURE.md`](dataform-example/ARCHITECTURE.md) §7
(the two-engine design these numbers rest on), and
[`dataform-sql/`](dataform-sql/README.md) (read the generated SQL whose
performance is being discussed).*
