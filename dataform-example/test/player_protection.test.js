"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const pp = require("../includes/player_protection");
const dialect = require("../includes/dialect");
const { validateMarket } = require("../includes/validate");
const { jurisdictions } = require("../includes/jurisdictions");
const { fakeCtx, validMarket, squash } = require("./support/helpers");

after(() => dialect.setDialect("bigquery"));

// ---- dialect: window truncation differs per engine ----
test("dialect: dateTrunc renders per engine with Monday-pinned weeks on BigQuery", () => {
  dialect.setDialect("bigquery");
  assert.equal(dialect.dateTrunc("WEEK", "d"), "DATE_TRUNC(d, WEEK(MONDAY))");
  assert.equal(dialect.dateTrunc("MONTH", "d"), "DATE_TRUNC(d, MONTH)");
  dialect.setDialect("duckdb");
  assert.equal(dialect.dateTrunc("WEEK", "d"), "DATE_TRUNC('week', d)");
  dialect.setDialect("bigquery");
});

// ---- effective limits ----
test("limits: nullSafeLeast is explicit (BigQuery LEAST(NULL,x)=NULL vs DuckDB ignores NULLs)", () => {
  const sql = pp.nullSafeLeast("a", "b");
  assert.match(sql, /CASE WHEN a IS NULL THEN b WHEN b IS NULL THEN a ELSE LEAST\(a, b\) END/);
});

test("limits: effective limits inject statutory defaults from config (ES 600/1500/3000, MT none)", () => {
  const sql = squash(pp.rgEffectiveDepositLimits(fakeCtx));
  assert.match(sql, /CASE c\.jurisdiction WHEN 'ES' THEN 600 ELSE NULL END/);
  assert.match(sql, /WHEN 'ES' THEN 1500/);
  assert.match(sql, /WHEN 'ES' THEN 3000/);
  assert.doesNotMatch(sql, /WHEN 'MT' THEN/); // MT: no statutory defaults
});

test("limits: breach detector windows use market-local day + Monday week + month, completed deposits only", () => {
  const sql = squash(pp.rgBreachDepositLimits(fakeCtx));
  assert.match(sql, /DATE\(p\.completed_ts, 'Europe\/Madrid'\)/);
  assert.match(sql, /DATE_TRUNC\(DATE\(p\.completed_ts, 'Europe\/Madrid'\), WEEK\(MONDAY\)\)/);
  assert.match(sql, /p\.direction = 'DEPOSIT' AND p\.status = 'COMPLETED'/);
  assert.match(sql, /w\.deposited > l\.effective_limit/);
  assert.match(sql, /l\.effective_limit IS NOT NULL/); // NULL = no cap, never breaches
});

// ---- exclusions ----
test("exclusions: breach detector covers deposits, bets AND gaming inside the window (end-exclusive, indefinite via NULL)", () => {
  const sql = squash(pp.rgBreachActivityWhileExcluded(fakeCtx));
  for (const src of ["'DEPOSIT'", "'BET_PLACED'", "'GAMING_ACTIVITY'"]) assert.match(sql, new RegExp(src));
  assert.match(sql, /p\.completed_ts >= x\.start_ts AND \(x\.end_ts IS NULL OR p\.completed_ts < x\.end_ts\)/);
  assert.match(sql, /b\.placed_at >= x\.start_ts/);
  assert.match(sql, /g\.occurred_at >= x\.start_ts/);
});

// ---- verification / withdrawals ----
test("KYC: withdrawal breach requires a VERIFIED identity check AT OR BEFORE completion time", () => {
  const sql = squash(pp.rgBreachUnverifiedWithdrawals(fakeCtx));
  assert.match(sql, /p\.direction = 'WITHDRAWAL' AND p\.status = 'COMPLETED'/);
  assert.match(sql, /NOT EXISTS/);
  assert.match(sql, /v\.status = 'VERIFIED' AND v\.event_ts <= p\.completed_ts/);
  assert.match(sql, /p\.jurisdiction IN \('MT', 'ES', 'DK', 'BG', 'GR', 'NL', 'DE'\)/); // every market requires it
});

// ---- compliance dim ----
test("compliance dim: latest identity status wins, only end_ts-NULL exclusions count as open, revoked limits excluded", () => {
  const sql = squash(pp.dimPlayerCompliance(fakeCtx));
  assert.match(sql, /check_type = 'IDENTITY' QUALIFY ROW_NUMBER\(\) OVER \(PARTITION BY account_id ORDER BY event_ts DESC\) = 1/);
  assert.match(sql, /WHERE end_ts IS NULL GROUP BY account_id/);
  assert.match(sql, /WHERE revoked_at IS NULL/);
  assert.match(sql, /COALESCE\(v\.verification_status, 'UNVERIFIED'\)/);
});

// ---- config validation ----
test("validate: a market that names a mandatory register but omits it from exclusion sources is rejected", () => {
  const j = validMarket({
    code: "ES",
    playerProtection: {
      defaultDepositLimits: { daily: 600, weekly: 1500, monthly: 3000 },
      selfExclusionSources: ["OPERATOR"], // missing the mandated register
      mandatoryRegister: "RGIAJ",
      withdrawalRequiresVerification: true,
    },
  });
  const errors = validateMarket(j, [], []);
  assert.ok(errors.some((e) => e.includes("RGIAJ") && e.includes("mandatory")));
});

test("validate: deposit limit defaults must be positive and non-decreasing daily<=weekly<=monthly", () => {
  const j = validMarket({
    playerProtection: {
      defaultDepositLimits: { daily: 600, weekly: 500, monthly: 3000 },
      selfExclusionSources: ["OPERATOR"],
      withdrawalRequiresVerification: true,
    },
  });
  const errors = validateMarket(j, [], []);
  assert.ok(errors.some((e) => e.includes("non-decreasing")));

  const j2 = validMarket({
    playerProtection: {
      defaultDepositLimits: { daily: -1, weekly: 1500, monthly: 3000 },
      selfExclusionSources: [],
      withdrawalRequiresVerification: "yes",
    },
  });
  const e2 = validateMarket(j2, [], []);
  assert.ok(e2.some((e) => e.includes("daily must be a positive number")));
  assert.ok(e2.some((e) => e.includes("non-empty array")));
  assert.ok(e2.some((e) => e.includes("must be boolean")));
});

test("validate: live playerProtection config for both markets is clean", () => {
  for (const j of Object.values(jurisdictions)) {
    const errors = validateMarket(j, [], []).filter((e) => e.includes("playerProtection") || e.includes("RGIAJ") || e.includes("Deposit"));
    assert.deepEqual(errors, [], `${j.code}: ${errors.join("; ")}`);
  }
});
