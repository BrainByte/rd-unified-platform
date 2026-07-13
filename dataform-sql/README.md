# dataform-sql — the generated SQL, written out for reading

**Understanding aid only.** The architecture's contract is that SQL is
*generated* from config and never hand-maintained — but SQL developers can't
trust a new architecture until they can read that SQL in their own terms.
This folder is for exactly that: every generated statement, written to disk,
transient like the SAFE's XML (`dataform-safe/`) and the reconciliation PDFs
(`dataform-reconciliation/`).

```bash
cd dataform-example
npm run emit-sql       # regenerates everything below (also runs in `npm run check`)
```

```
dataform-sql/
  duckdb/               exactly what the offline harness executes, with its own README
    models/             every table build, numbered in execution order (+ README)
    assertions/         every rule as a SELECT of violating rows (+ README)
  bigquery/             the SAME builders compiled for production (+ README)
    models/  assertions/
```

The `duckdb/` and `bigquery/` trees are **wiped and rewritten on every run**
and are gitignored — never edit them, never commit them, never reference them
as a source. The source of truth is `dataform-example/includes/` +
`jurisdictions.js`; the fastest way to *feel* the architecture is to change a
config value, re-run `npm run emit-sql`, and watch the SQL move.

## Suggested reading (in SQL developers' terms)

- **A submission file**: `duckdb/models/*_submission_ready_mt.sql` next to
  `*_submission_ready_es.sql` — two markets from one builder; every
  difference traces to one config value.
- **A "trigger"**: `duckdb/assertions/*_rule_MT_MT-103.sql` — the invariant
  ("voided slips report zero payout") as a SELECT of violating rows, named
  for the regulator clause it enforces.
- **A breach detector**: `duckdb/models/*_rg_breach_stake_limits.sql` — age
  bands and effective dates folded into plain CASE/LEAST SQL, straight from
  config.
- **Two engines, one source**: diff any file against its twin under
  `bigquery/` — every difference comes from `includes/dialect.js`, nowhere
  else.

New to this way of working? Start with
[`../technology-skills-migration.md`](../technology-skills-migration.md)
(the construct-by-construct translation from SQL Server / OLTP reporting) and
[`../dataform-example/ARCHITECTURE.md`](../dataform-example/ARCHITECTURE.md)
(the layer stack these files are projected from).
