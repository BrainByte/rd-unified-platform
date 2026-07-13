// ============================================================================
// EMIT GENERATED SQL — an UNDERSTANDING AID, nothing else.
//
//   npm run emit-sql        (also runs as part of `npm run check`)
//
// The architecture's contract is that SQL is generated from config and never
// hand-maintained — but a brand-new architecture is opaque to SQL developers
// until they can READ that SQL in their own terms. This script writes every
// generated statement (every model and every assertion, in execution order)
// to the transient repo-root folder:
//
//   dataform-sql/duckdb/    what the offline harness executes
//   dataform-sql/bigquery/  the same builders compiled for production
//
// The subfolders are wiped and rewritten on every run (gitignored, like the
// SAFE's XML and the reconciliation PDFs) and carry their own generated
// READMEs; the top-level dataform-sql/README.md is committed and pins the
// folder. The CONFIG is the source of truth — the SQL here is a projection:
// edit config, re-run, watch the SQL move.
// ============================================================================
"use strict";
const fs = require("fs");
const path = require("path");

// requiring run.js sets the duckdb dialect and gives us the exact plan the
// offline harness executes
const { buildPlan } = require("./run");
const { setDialect } = require("../includes/dialect");

const OUT_ROOT = path.join(__dirname, "..", "..", "dataform-sql");

function slug(name) {
  return name.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
}

const DIALECT_README = {
  duckdb: `# duckdb/ — exactly what the offline harness executes

GENERATED (\`npm run emit-sql\`) — do not edit; transient, wiped every run.

These are the statements \`dataform-example/local/run.js\` executes, in this
exact order, when you run \`npm run local\`: every reference table, staging
view, core/gaming/player-protection model, per-market submission and tax
table (\`models/\`), then every rule assertion and gate (\`assertions/\`).
When the harness is green, THIS SQL ran clean end to end.

Table references are bare names because the offline harness uses one flat
namespace. Compare any file with its twin under \`../bigquery/\` — the only
differences come from \`includes/dialect.js\` (text normalisation, hashing,
timezone/date handling, regex syntax, age arithmetic). That diff IS the
"two engines, one SQL source" claim, visible.
`,
  bigquery: `# bigquery/ — the same builders, compiled for production

GENERATED (\`npm run emit-sql\`) — do not edit; transient, wiped every run.

Identical builder functions to \`../duckdb/\`, compiled with the BigQuery
dialect. In real production Dataform wires these via \`definitions/\`:
it qualifies each table into its dataset (reference/staging/core/
reporting_<mkt>/compliance), manages the DDL (table vs view vs incremental,
partitioning), and runs assertions as first-class Dataform assertions —
so treat the \`CREATE OR REPLACE TABLE\` wrappers here as illustrative.
The SELECT bodies are byte-for-byte what production runs.

Diff any file against its \`../duckdb/\` twin to see the complete list of
engine differences — every one lives in \`includes/dialect.js\` and nowhere
else.
`,
};

const KIND_README = {
  models: `# models/ — every table build, numbered in execution order

GENERATED — do not edit. One file per model, ordered so that any file only
reads tables built by lower-numbered files (the dependency order the
offline harness executes and Dataform derives from \`ctx.ref\`).

Reading tips for SQL developers:
- The staging views (\`stg_*\`) are the MERGE/latest-row-image replacement:
  \`QUALIFY ROW_NUMBER() ... ORDER BY _commit_ts DESC\` over append-only CDC.
- Compare \`submission_ready_mt\` with \`submission_ready_es\`: same generated
  shape, and every difference (voids, hashed ids, extension columns, codes)
  traces to one value in \`includes/jurisdictions.js\`.
- Nothing here was written by hand — if a column looks wrong, the fix is in
  config or a builder function, never in these files.
`,
  assertions: `# assertions/ — every rule, as a SELECT of violating rows

GENERATED — do not edit. This is the trigger/constraint replacement: each
file SELECTS THE ROWS THAT BREAK A RULE, so zero rows = the rule holds.
File names carry the regulator clause id (e.g. \`rule_MT_MT-103\`) — the
audit trail from a failing check straight back to the law it enforces.

Under the quarantine-first model a compliance breach holds the breaching
entity (see \`fct_exceptions\` in models/) rather than aborting the run; the
one hard gate is isolation itself (\`isolation gate ...\` files): no held,
quarantined or incomplete entity may ever appear in a submission.
`,
};

function emit(dialect) {
  setDialect(dialect);
  const plan = buildPlan();
  const dir = path.join(OUT_ROOT, dialect);
  fs.rmSync(dir, { recursive: true, force: true });   // transient: wipe + rewrite
  fs.mkdirSync(path.join(dir, "models"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assertions"), { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), DIALECT_README[dialect]);
  fs.writeFileSync(path.join(dir, "models", "README.md"), KIND_README.models);
  fs.writeFileSync(path.join(dir, "assertions", "README.md"), KIND_README.assertions);

  let models = 0, assertions = 0;
  plan.forEach((step, i) => {
    const seq = String(i + 1).padStart(3, "0");
    const kindDir = step.kind === "model" ? "models" : "assertions";
    const header =
      `-- GENERATED SQL — understanding aid only, DO NOT EDIT.\n` +
      `-- Regenerate: npm run emit-sql   (source of truth: includes/ + jurisdictions.js)\n` +
      `-- dialect: ${dialect}   |   step ${seq} of ${plan.length}   |   ${step.kind}: ${step.name}\n` +
      (step.kind === "assertion"
        ? `-- An assertion SELECTS VIOLATING ROWS: zero rows = the rule holds.\n`
        : "") +
      (step.rule && step.rule.description ? `-- rule: ${step.rule.description}\n` : "") +
      `\n`;
    fs.writeFileSync(path.join(dir, kindDir, `${seq}_${slug(step.name)}.sql`),
                     header + step.sql.trim() + "\n");
    if (step.kind === "model") models++; else assertions++;
  });
  return { models, assertions };
}

function main() {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  const duck = emit("duckdb");
  const bq = emit("bigquery");
  setDialect("duckdb");   // leave the process how run.js expects it
  console.log(`✔ generated SQL emitted to dataform-sql/ — ` +
              `duckdb: ${duck.models} models + ${duck.assertions} assertions, ` +
              `bigquery: ${bq.models} models + ${bq.assertions} assertions ` +
              `(transient; understanding aid only)`);
}

main();
