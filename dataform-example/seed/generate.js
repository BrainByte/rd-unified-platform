// ============================================================================
// SEED GENERATOR — renders seed/data.js for each engine.
//   node seed/generate.js       -> rewrites seed/bigquery_setup.sql
//   buildDuckDbStatements()     -> used by local/run.js to load DuckDB
// ============================================================================

const fs = require("fs");
const path = require("path");
const { tables } = require("./data");

const TYPE_MAP = {
  bigquery: { str: "STRING", ts: "TIMESTAMP", num: "NUMERIC", date: "DATE" },
  duckdb: { str: "VARCHAR", ts: "TIMESTAMPTZ", num: "DECIMAL(18,2)", date: "DATE" },
};

function literal(value, type, engine) {
  if (value === null || value === undefined) return "NULL";
  if (type === "ts") return engine === "duckdb" ? `TIMESTAMPTZ '${value}'` : `TIMESTAMP '${value}'`;
  if (type === "date") return `DATE '${value}'`;
  if (type === "num") return String(value);
  // DuckDB/standard SQL escapes a single quote by doubling it; BigQuery uses backslash.
  const escaped = engine === "duckdb"
    ? String(value).replace(/'/g, "''")
    : String(value).replace(/'/g, "\\'");
  return `'${escaped}'`;
}

function createTable(name, spec, engine, schema) {
  const cols = spec.columns
    .map(([col, type]) => `${col} ${TYPE_MAP[engine][type]}`)
    .join(", ");
  const qualified = schema ? `${schema}.${name}` : name;
  return `CREATE OR REPLACE TABLE ${qualified} (${cols})`;
}

function insertRows(name, spec, engine, schema) {
  const qualified = schema ? `${schema}.${name}` : name;
  const values = spec.rows
    .map((row) => `(${row.map((v, i) => literal(v, spec.columns[i][1], engine)).join(", ")})`)
    .join(",\n  ");
  return `INSERT INTO ${qualified} VALUES\n  ${values}`;
}

// Full BigQuery script (pasteable into the console).
function buildBigQuerySql() {
  const parts = [
    "-- GENERATED FILE — edit seed/data.js and run `node seed/generate.js`.",
    "-- Seed data simulating the CDC landing layer. See README.md for the",
    "-- lifecycle/nomenclature coverage and expected outputs.",
    "CREATE SCHEMA IF NOT EXISTS cdc_landing;",
  ];
  for (const [name, spec] of Object.entries(tables)) {
    parts.push(createTable(name, spec, "bigquery", "cdc_landing") + ";");
    parts.push(insertRows(name, spec, "bigquery", "cdc_landing") + ";");
  }
  return parts.join("\n\n") + "\n";
}

// Ordered statements for the offline DuckDB runner (flat schema).
function buildDuckDbStatements() {
  const statements = [];
  for (const [name, spec] of Object.entries(tables)) {
    statements.push(createTable(name, spec, "duckdb", null));
    statements.push(insertRows(name, spec, "duckdb", null));
  }
  return statements;
}

if (require.main === module) {
  const out = path.join(__dirname, "bigquery_setup.sql");
  fs.writeFileSync(out, buildBigQuerySql());
  console.log(`Wrote ${out}`);
}

module.exports = { buildBigQuerySql, buildDuckDbStatements };
