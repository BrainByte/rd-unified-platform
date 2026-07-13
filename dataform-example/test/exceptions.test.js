"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const ex = require("../includes/exceptions");
const dialect = require("../includes/dialect");
const { fakeCtx, squash } = require("./support/helpers");
const { jurisdictions } = require("../includes/jurisdictions");

test("exceptions: backoff is exponential (15 * 2^(attempt-1) minutes)", () => {
  assert.equal(ex.backoffMinutes(1), 15);
  assert.equal(ex.backoffMinutes(2), 30);
  assert.equal(ex.backoffMinutes(3), 60);
  assert.equal(ex.MAX_ATTEMPTS, 5);
});

test("exceptions: address validation encodes EVERY market's postcode format as data (a CASE, no branching in logic)", () => {
  const sql = squash(ex.dimAccountAddressValidated(fakeCtx));
  for (const j of Object.values(jurisdictions)) {
    assert.ok(j.addressValidation, `${j.code} has addressValidation config`);
    // each market's pattern appears in the generated CASE
    assert.ok(sql.includes(j.addressValidation.postcodePattern), `pattern for ${j.code}`);
  }
  // format failure is DATA, region failure is TRANSIENT
  assert.match(sql, /'postcode_format'/);
  assert.match(sql, /'region_not_found'/);
  assert.match(sql, /'DATA'/);
  assert.match(sql, /'TRANSIENT'/);
});

test("exceptions: admissibility filter excludes blocking statuses AND unready periods", () => {
  const sql = squash(ex.admissibilityFilter(fakeCtx, jurisdictions.MT));
  assert.match(sql, /NOT IN \(\s*SELECT entity_id FROM `core\.fct_exceptions`/);
  assert.match(sql, /status IN \('QUARANTINED', 'RETRYING', 'HELD'\)/);
  assert.match(sql, /rg_period_readiness/);
  assert.match(sql, /is_ready/);
});

test("exceptions: retry state machine escalates past MAX_ATTEMPTS and re-admits resolved entities", () => {
  const sql = squash(ex.opsExceptionStateNext(fakeCtx, "CURRENT_TIMESTAMP()"));
  // escalation: attempt beyond the max becomes QUARANTINED
  assert.match(sql, /attempt_count > 5 THEN 'QUARANTINED'/);
  assert.match(sql, /ELSE 'RETRYING'/);
  // resolution: a prior failure no longer present becomes RESOLVED
  assert.match(sql, /'RESOLVED'/);
  assert.match(sql, /NOT EXISTS/);
});

test("exceptions: the store routes all four failure classes to distinct statuses", () => {
  const sql = squash(ex.fctExceptions(fakeCtx, "CURRENT_TIMESTAMP()"));
  assert.match(sql, /'DATA'.*'QUARANTINED'/);
  assert.match(sql, /'COMPLETENESS'.*'WAITING_DATA'/);
  assert.match(sql, /'COMPLIANCE'.*'HELD'/);
  // compliance holds are fed by the breach detectors (no longer hard aborts)
  assert.match(sql, /rg_breach_activity_while_excluded/);
  assert.match(sql, /rg_breach_deposit_limits/);
});

test("exceptions: readiness gate compares the settlement watermark to the period date, fail-closed", () => {
  const sql = squash(ex.rgPeriodReadiness(fakeCtx));
  assert.match(sql, /cdc_source_watermarks/);
  assert.match(sql, /bet_settlement/);
  assert.match(sql, /COALESCE\(.*> .*, FALSE\) AS is_ready/); // missing watermark -> not ready
});

test("dialect: addMinutes + tsType differ per engine and round-trip back to bigquery", () => {
  dialect.setDialect("duckdb");
  assert.match(dialect.addMinutes("ts", "m"), /to_minutes/);
  assert.equal(dialect.tsType(), "TIMESTAMPTZ");
  dialect.setDialect("bigquery");
  assert.match(dialect.addMinutes("ts", "m"), /TIMESTAMP_ADD/);
  assert.equal(dialect.tsType(), "TIMESTAMP");
});
