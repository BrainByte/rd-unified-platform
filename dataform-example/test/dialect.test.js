"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const dialect = require("../includes/dialect");
const { submissionQuery } = require("../includes/queries");
const { violationQuery } = require("../includes/rules");
const { fakeCtx, validMarket, squash } = require("./support/helpers");

// Every test here restores bigquery afterwards so ordering never matters.
after(() => dialect.setDialect("bigquery"));

function nomMarket() {
  return validMarket({
    reportFields: ["slip_id", "player_dni_hash", "stake", "payout", "sport_code", "event_name",
      "placed_at_local", "settled_at_local"],
    nomenclature: {
      sportCodes: { FOOT: "01" }, unmappedPolicy: "default",
      defaultSportCode: "99", eventNameTemplate: "{home} v {away}",
    },
  });
}

test("dialect: bigquery is the default and survives module load order", () => {
  assert.equal(dialect.dialectName(), "bigquery");
});

test("dialect: unknown dialect is rejected", () => {
  assert.throws(() => dialect.setDialect("oracle"), /Unknown SQL dialect/);
});

test("dialect: bigquery renders BQ-specific constructs", () => {
  dialect.setDialect("bigquery");
  assert.equal(dialect.sha256Hex("x"), "TO_HEX(SHA256(CAST(x AS STRING)))");
  assert.equal(dialect.localDate("ts", "Europe/Malta"), "DATE(ts, 'Europe/Malta')");
  assert.match(dialect.normaliseText("x"), /NORMALIZE\(x, NFD\)/);
  assert.equal(dialect.regexpContains("f", "^a$"), "REGEXP_CONTAINS(f, r'^a$')");
});

test("dialect: duckdb renders DuckDB equivalents (accents, tz, hash, regex flags)", () => {
  dialect.setDialect("duckdb");
  assert.equal(dialect.sha256Hex("x"), "SHA256(CAST(x AS VARCHAR))");
  assert.equal(dialect.localDate("ts", "Europe/Malta"), "CAST((ts) AT TIME ZONE 'Europe/Malta' AS DATE)");
  const norm = dialect.normaliseText("x");
  assert.match(norm, /STRIP_ACCENTS\(x\)/);
  assert.match(norm, /'g'/); // global replace flag — BQ replaces all by default
  assert.equal(dialect.regexpContains("f", "^a$"), "REGEXP_MATCHES(f, '^a$')");
  dialect.setDialect("bigquery");
});

test("dialect: whole submission query switches engine cleanly", () => {
  const j = nomMarket();

  dialect.setDialect("bigquery");
  const bq = squash(submissionQuery(fakeCtx, j));
  assert.match(bq, /TO_HEX\(SHA256/);
  assert.match(bq, /DATETIME\(b\.placed_at, 'Europe\/Malta'\)/);

  dialect.setDialect("duckdb");
  const dd = squash(submissionQuery(fakeCtx, j));
  assert.match(dd, /SHA256\(CAST\(a\.national_id AS VARCHAR\)\)/);
  assert.match(dd, /\(b\.placed_at\) AT TIME ZONE 'Europe\/Malta'/);
  assert.doesNotMatch(dd, /TO_HEX|NORMALIZE\(/);

  // engine choice never changes WHAT is selected, only HOW
  dialect.setDialect("bigquery");
  // lowercase aliases only — excludes type casts like AS STRING / AS DATE
  const fieldList = (sql) => (sql.match(/AS [a-z_]+/g) || []).join(",");
  assert.equal(fieldList(bq), fieldList(dd));
});

test("dialect: matches rule renders per engine", () => {
  const j = nomMarket();
  const rule = { id: "R1", type: "matches", field: "player_dni_hash", pattern: "^[0-9a-f]{64}$" };

  dialect.setDialect("duckdb");
  assert.match(violationQuery(fakeCtx, j, rule), /NOT REGEXP_MATCHES\(player_dni_hash/);
  dialect.setDialect("bigquery");
  assert.match(violationQuery(fakeCtx, j, rule), /NOT REGEXP_CONTAINS\(player_dni_hash/);
});
