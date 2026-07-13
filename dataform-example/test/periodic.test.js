// Periodic regulator registers (REQ: requirements/dgoj-periodic-reporting):
// config validation, the register query builder, and the daily<->monthly
// completeness check.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { periodicReportQuery, periodicCompletenessQuery } = require("../includes/queries");
const { periodicRules, violationQuery } = require("../includes/rules");
const { validateMarket } = require("../includes/validate");
const { commonRules, commonPeriodicRules } = require("../includes/jurisdictions");
const { fakeCtx, validMarket, squash } = require("./support/helpers");

const RUD = {
  id: "RUD", cadence: "daily", playerField: "player_dni_hash",
  fields: ["bets_settled", "stake_sum", "winnings_sum", "ggr_sum"],
};
const RUT = {
  id: "RUT", cadence: "monthly", playerField: "player_dni_hash",
  fields: ["bets_settled", "stake_sum", "winnings_sum", "ggr_sum"],
};

function periodicMarket(overrides = {}) {
  return validMarket({ code: "ES", periodicReports: [RUD, RUT], ...overrides });
}

// ---- query builder ----------------------------------------------------------

test("periodic: daily register groups by the local report date", () => {
  const sql = squash(periodicReportQuery(fakeCtx, periodicMarket({ timezone: "Europe/Madrid" }), RUD));
  assert.match(sql, /DATE\(COALESCE\(b\.settled_at, b\.voided_at\), 'Europe\/Madrid'\) AS period_start/);
  assert.match(sql, /GROUP BY 1, 2, 3, 4/);
  assert.match(sql, /'RUD' AS register_id/);
});

test("periodic: monthly register truncates the report date to month via the dialect", () => {
  const sql = squash(periodicReportQuery(fakeCtx, periodicMarket(), RUT));
  assert.match(sql, /DATE_TRUNC\(DATE\(COALESCE\(b\.settled_at, b\.voided_at\), '[^']+'\), MONTH\) AS period_start/);
});

test("periodic: registers totalise SETTLED activity only and keep the admissibility filter", () => {
  const sql = squash(periodicReportQuery(fakeCtx, periodicMarket(), RUD));
  assert.match(sql, /b\.slip_status = 'SETTLED'/);
  assert.match(sql, /fct_exceptions/);       // quarantined/held excluded
  assert.match(sql, /rg_period_readiness/);  // incomplete periods excluded
});

test("periodic: the player is identified via the market's field registry (ES: DNI hash)", () => {
  const sql = squash(periodicReportQuery(fakeCtx, periodicMarket(), RUD));
  assert.match(sql, /SHA256\(CAST\(a\.national_id AS STRING\)\)/i);
});

test("periodic: an unknown periodic field fails at compile time", () => {
  assert.throws(
    () => periodicReportQuery(fakeCtx, periodicMarket(), { ...RUD, fields: ["nope"] }),
    /Unknown periodic field 'nope'/
  );
});

// ---- completeness (REQ-DGOJ-3) ----------------------------------------------

test("periodic: completeness rolls dailies up per player-month and flags any mismatch", () => {
  const sql = squash(periodicCompletenessQuery(fakeCtx, periodicMarket(), RUD, RUT));
  assert.match(sql, /FULL OUTER JOIN/);
  assert.match(sql, /SUM\(stake_sum\) AS stake_sum/);
  assert.match(sql, /ABS\(m\.stake_sum - d\.stake_sum\) > 0\.005/);
  assert.match(sql, /m\.player_ref IS NULL OR d\.player_ref IS NULL/);
});

// ---- rule assertions over registers ------------------------------------------

test("periodic: register rules target the register table with player_ref/period_start", () => {
  const rule = { id: "P-COM-001", type: "not_null", field: "player_ref" };
  const sql = squash(violationQuery(fakeCtx, periodicMarket(), rule,
    { table: "submission_rud_es", keyColumn: "player_ref", dateColumn: "period_start" }));
  assert.match(sql, /FROM `core\.submission_rud_es`/);
  assert.match(sql, /player_ref AS row_key/);
  assert.match(sql, /period_start AS report_date/);
});

test("periodic: event-file assertions still default to report_date (engine unchanged for existing rules)", () => {
  const rule = { id: "COM-001", type: "not_null", field: "slip_id" };
  const sql = squash(violationQuery(fakeCtx, validMarket(), rule));
  assert.match(sql, /slip_id AS row_key, report_date/);
});

test("periodic: periodicRules merges the common structural rules with the register's own", () => {
  const merged = periodicRules({ ...RUD, rules: [{ id: "X-1", type: "non_negative", field: "stake_sum" }] },
    commonPeriodicRules);
  assert.deepEqual(merged.map((r) => r.id), ["P-COM-001", "P-COM-002", "X-1"]);
});

// ---- config validation (REQ-DGOJ-4) ------------------------------------------

test("validate: a well-formed periodicReports config passes", () => {
  assert.deepEqual(validateMarket(periodicMarket(), commonRules), []);
});

test("validate: unknown cadence is rejected", () => {
  const errors = validateMarket(periodicMarket({ periodicReports: [{ ...RUD, cadence: "weekly" }] }), commonRules);
  assert.ok(errors.some((e) => e.includes("cadence must be 'daily' or 'monthly'")));
});

test("validate: unknown periodic field is rejected", () => {
  const errors = validateMarket(periodicMarket({ periodicReports: [{ ...RUD, fields: ["nope"] }] }), commonRules);
  assert.ok(errors.some((e) => e.includes("unknown periodic field 'nope'")));
});

test("validate: playerField must exist in the betting field registry", () => {
  const errors = validateMarket(periodicMarket({ periodicReports: [{ ...RUD, playerField: "nope" }] }), commonRules);
  assert.ok(errors.some((e) => e.includes("playerField 'nope'")));
});

test("validate: duplicate register ids are rejected", () => {
  const errors = validateMarket(periodicMarket({ periodicReports: [RUD, { ...RUT, id: "RUD" }] }), commonRules);
  assert.ok(errors.some((e) => e.includes("duplicate periodic register id 'RUD'")));
});

test("validate: a daily+monthly pair must share its player identification", () => {
  const errors = validateMarket(
    periodicMarket({ periodicReports: [RUD, { ...RUT, playerField: "account_id" }] }), commonRules);
  assert.ok(errors.some((e) => e.includes("must share playerField")));
});

test("validate: register rules may only reference the register's columns", () => {
  const bad = { ...RUD, rules: [{ id: "X-9", type: "not_null", field: "slip_id", description: "wrong grain" }] };
  const errors = validateMarket(periodicMarket({ periodicReports: [bad] }), commonRules);
  assert.ok(errors.some((e) => e.includes("references 'slip_id' which is not in that register")));
});
