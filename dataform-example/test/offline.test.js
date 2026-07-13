"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { buildBigQuerySql, buildDuckDbStatements } = require("../seed/generate");
const models = require("../includes/models");
const dialect = require("../includes/dialect");

after(() => dialect.setDialect("bigquery"));
const ctx = { ref: (n) => n };

test("seed: BigQuery script has schema, typed DDL and all six slips", () => {
  const sql = buildBigQuerySql();
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS cdc_landing/);
  assert.match(sql, /cdc_landing\.cdc_bet_slip_events \(slip_id STRING.*stake NUMERIC/);
  for (const s of ["S1", "S2", "S3", "S4", "S5", "S6"]) assert.match(sql, new RegExp(`'${s}'`));
  assert.match(sql, /TIMESTAMP '2026-07-08 10:00:00\+00'/);
});

test("seed: DuckDB statements use TIMESTAMPTZ/DECIMAL and flat names", () => {
  const stmts = buildDuckDbStatements();
  const ddl = stmts.find((s) => s.startsWith("CREATE OR REPLACE TABLE cdc_bet_slip_events"));
  assert.match(ddl, /event_ts TIMESTAMPTZ/);
  assert.match(ddl, /stake DECIMAL\(18,2\)/);
  assert.ok(!ddl.includes("cdc_landing."), "local runner uses a flat namespace");
  const insert = stmts.find((s) => s.startsWith("INSERT INTO cdc_bet_slip_events"));
  assert.match(insert, /TIMESTAMPTZ '2026-07-08 10:00:00\+00'/);
});

test("seed: both engines load identical row counts", () => {
  const bq = buildBigQuerySql();
  const dd = buildDuckDbStatements().join("\n");
  const count = (sql) => (sql.match(/\('S\d'/g) || []).length;
  assert.equal(count(bq), count(dd));
});

test("models: builders produce engine-valid SQL under both dialects", () => {
  for (const name of ["duckdb", "bigquery"]) {
    dialect.setDialect(name);
    const fixture = models.dimFixture(ctx);
    // dim_fixture is the dialect-sensitive one (normalised alias joins)
    if (name === "duckdb") assert.match(fixture, /STRIP_ACCENTS/);
    if (name === "bigquery") assert.match(fixture, /NORMALIZE\(/);
    // structural spine identical either way
    assert.match(fixture, /LEFT JOIN ref_sport_aliases sa/);
    assert.match(models.fctBetSlipLifecycle(ctx), /WHEN l\.voided_at\s+IS NOT NULL THEN 'VOIDED'/);
    assert.match(models.stgAccounts(ctx), /QUALIFY ROW_NUMBER\(\)/);
  }
  dialect.setDialect("bigquery");
});

test("models: unmapped queue counts betting impact", () => {
  const sql = models.unmappedSports(ctx);
  assert.match(sql, /WHERE f\.canonical_sport IS NULL/);
  assert.match(sql, /COUNT\(b\.slip_id\) AS slips_affected/);
});
