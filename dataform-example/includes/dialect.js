// ============================================================================
// SQL DIALECT LAYER
//
// All generated SQL targets BigQuery in production and DuckDB for offline
// local runs (local/run.js). The two dialects agree on almost everything
// we use (QUALIFY, window functions, CONCAT, ROUND, IF, COALESCE); the
// genuinely divergent constructs live HERE and nowhere else.
//
// Dataform never calls setDialect() -> always bigquery.
// The local runner calls setDialect('duckdb') before building any SQL.
//
// RULE: if you need engine-specific SQL, add a function here with both
// implementations and a test in test/dialect.test.js. Never inline it.
// ============================================================================

const DIALECTS = {
  bigquery: {
    name: "bigquery",

    // lowercase, trim, collapse whitespace, strip diacritics, drop . and ,
    // TWIN of normalise() in nomenclature/mapping.js — keep equivalent.
    normaliseText: (expr) =>
      `LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(` +
      `REGEXP_REPLACE(NORMALIZE(${expr}, NFD), r'\\pM', ''),` +
      ` r'[.,]', ''), r'\\s+', ' ')))`,

    sha256Hex: (expr) => `TO_HEX(SHA256(CAST(${expr} AS STRING)))`,

    localDate: (expr, tz) => `DATE(${expr}, '${tz}')`,

    localDatetime: (expr, tz) => `DATETIME(${expr}, '${tz}')`,

    regexpContains: (expr, pattern) => `REGEXP_CONTAINS(${expr}, r'${pattern}')`,

    // date -> start of period. BigQuery weeks default to Sunday; pin Monday.
    dateTrunc: (part, expr) =>
      `DATE_TRUNC(${expr}, ${part.toUpperCase() === "WEEK" ? "WEEK(MONDAY)" : part.toUpperCase()})`,

    // add a (possibly computed) number of minutes to a timestamp — retry backoff.
    addMinutes: (ts, mins) => `TIMESTAMP_ADD(${ts}, INTERVAL CAST(${mins} AS INT64) MINUTE)`,

    // timestamp column type, for CAST(NULL AS ...) in the exception store.
    tsType: () => "TIMESTAMP",

    // whole years between a date of birth and a date (age at that date).
    // REQ: requirements/max-stake-limits (REQ-MSL-7) — age-banded stake caps.
    ageYears: (dob, date) =>
      `CAST(FLOOR(DATE_DIFF(${date}, ${dob}, DAY) / 365.2425) AS INT64)`,
  },

  duckdb: {
    name: "duckdb",

    // strip_accents replaces the NORMALIZE/\pM dance; DuckDB regexp_replace
    // needs the 'g' flag (BigQuery replaces all matches by default).
    normaliseText: (expr) =>
      `LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(` +
      `STRIP_ACCENTS(${expr}),` +
      ` '[.,]', '', 'g'), '\\s+', ' ', 'g')))`,

    // DuckDB's sha256() already returns lowercase hex.
    sha256Hex: (expr) => `SHA256(CAST(${expr} AS VARCHAR))`,

    localDate: (expr, tz) => `CAST((${expr}) AT TIME ZONE '${tz}' AS DATE)`,

    localDatetime: (expr, tz) => `(${expr}) AT TIME ZONE '${tz}'`,

    regexpContains: (expr, pattern) => `REGEXP_MATCHES(${expr}, '${pattern}')`,

    // DuckDB: part first, ISO weeks start Monday natively.
    dateTrunc: (part, expr) => `DATE_TRUNC('${part.toLowerCase()}', ${expr})`,

    // DuckDB: to_minutes(int) -> INTERVAL, added to a timestamptz.
    addMinutes: (ts, mins) => `(${ts} + to_minutes(CAST(${mins} AS INTEGER)))`,

    tsType: () => "TIMESTAMPTZ",

    // DuckDB date subtraction yields integer days directly.
    ageYears: (dob, date) =>
      `CAST(FLOOR((${date} - ${dob}) / 365.2425) AS INTEGER)`,
  },
};

let current = DIALECTS.bigquery;

function setDialect(name) {
  if (!DIALECTS[name]) throw new Error(`Unknown SQL dialect '${name}'`);
  current = DIALECTS[name];
}

function dialectName() {
  return current.name;
}

// Delegating functions — call sites never touch `current` directly.
const normaliseText = (expr) => current.normaliseText(expr);
const sha256Hex = (expr) => current.sha256Hex(expr);
const localDate = (expr, tz) => current.localDate(expr, tz);
const localDatetime = (expr, tz) => current.localDatetime(expr, tz);
const regexpContains = (expr, pattern) => current.regexpContains(expr, pattern);
const dateTrunc = (part, expr) => current.dateTrunc(part, expr);
const addMinutes = (ts, mins) => current.addMinutes(ts, mins);
const tsType = () => current.tsType();
const ageYears = (dob, date) => current.ageYears(dob, date);

module.exports = {
  setDialect, dialectName,
  normaliseText, sha256Hex, localDate, localDatetime, regexpContains, dateTrunc,
  addMinutes, tsType, ageYears,
};
