"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { submissionQuery, taxSummaryQuery } = require("../includes/queries");
const { statusFilter } = require("../includes/filters");
const { fakeCtx, validMarket, squash } = require("./support/helpers");

test("queries: includeVoided=true admits SETTLED and VOIDED", () => {
  assert.equal(
    statusFilter(validMarket({ includeVoided: true })),
    "b.slip_status IN ('SETTLED', 'VOIDED')"
  );
});

test("queries: includeVoided=false admits SETTLED only", () => {
  assert.equal(statusFilter(validMarket({ includeVoided: false })), "b.slip_status = 'SETTLED'");
});

test("queries: submission filters on the market's jurisdiction", () => {
  const sql = squash(submissionQuery(fakeCtx, validMarket({ code: "MT" })));
  assert.match(sql, /WHERE a\.jurisdiction = 'MT'/);
  assert.match(sql, /'MT' AS jurisdiction/);
});

test("queries: submission joins both domains (lifecycle + account)", () => {
  const sql = squash(submissionQuery(fakeCtx, validMarket()));
  assert.match(sql, /FROM `core\.fct_bet_slip_lifecycle` b/);
  assert.match(sql, /JOIN `core\.dim_customer_account` a ON b\.account_id = a\.account_id/);
});

test("queries: report_date is local settlement date, void date for voids", () => {
  const sql = submissionQuery(fakeCtx, validMarket({ timezone: "Europe/Malta" }));
  assert.match(sql, /DATE\(COALESCE\(b\.settled_at, b\.voided_at\), 'Europe\/Malta'\) AS report_date/);
});

test("queries: tax summary always excludes voids regardless of includeVoided", () => {
  const sql = squash(taxSummaryQuery(fakeCtx, validMarket({ includeVoided: true })));
  assert.match(sql, /b\.slip_status = 'SETTLED'/);
  assert.doesNotMatch(sql, /VOIDED/);
});

test("queries: tax rate from config appears in tax_due", () => {
  const sql = squash(taxSummaryQuery(fakeCtx, validMarket({ taxRate: 0.2 })));
  assert.match(sql, /SUM\(b\.stake - b\.payout\) AS ggr_sum/);
  assert.match(sql, /ggr_sum \* \(0\.2\), 2\) AS tax_due/);
});

test("queries: effective-dated tax rate compiles to a report_date CASE", () => {
  const sql = squash(taxSummaryQuery(fakeCtx, validMarket({
    taxRate: [{ rate: 0.2, to: "2026-01-01" }, { rate: 0.25, from: "2026-01-01" }],
  })));
  assert.match(sql, /CASE WHEN report_date < DATE '2026-01-01' THEN 0\.2 WHEN report_date >= DATE '2026-01-01' THEN 0\.25 ELSE NULL END/);
});

// REQ: de-regulator-addition — Germany taxes STAKES (RennwLottG 5.3%),
// not GGR. The tax BASE is config; a new model is one generator arm.
test("queries: taxModel 'turnover' taxes stakes; default/'ggr' taxes stake - payout", () => {
  const turnover = squash(taxSummaryQuery(fakeCtx, validMarket({ taxModel: "turnover", taxRate: 0.053 })));
  assert.match(turnover, /stake_sum \* \(0\.053\), 2\) AS tax_due/);
  const ggr = squash(taxSummaryQuery(fakeCtx, validMarket({ taxModel: "ggr", taxRate: 0.053 })));
  assert.match(ggr, /ggr_sum \* \(0\.053\), 2\) AS tax_due/);
});
