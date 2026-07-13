// REQ: requirements/max-stake-limits — unit tests for the statutory slots
// stake caps (age-banded, effective-dated) and the stake-limit breach SQL.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const pp = require("../includes/player_protection");
const dialect = require("../includes/dialect");
const { validateAll } = require("../includes/validate");
const { jurisdictions, commonRules, commonGamingRules } = require("../includes/jurisdictions");
const { fakeCtx, squash } = require("./support/helpers");

test("stake limits: band expression encodes age bands AND effective dates, folded null-safe (REQ-MSL-1/3)", () => {
  const j = { playerProtection: { slotsStakeLimits: [
    { maxStake: 5.0, minAge: 18, from: "2026-08-01" },
    { maxStake: 2.0, minAge: 18, maxAge: 24, from: "2026-09-15" },
  ] } };
  const sql = squash(pp.statutorySlotsCapExpr(j, "age", "d"));
  assert.match(sql, /age >= 18 AND d >= DATE '2026-08-01' THEN 5\.00/);
  assert.match(sql, /age >= 18 AND age <= 24 AND d >= DATE '2026-09-15' THEN 2\.00/);
  assert.match(sql, /LEAST/);          // the tighter applicable band wins
});

test("stake limits: a market with no statutory bands yields NULL (player-set only, e.g. BG/GR)", () => {
  assert.match(pp.statutorySlotsCapExpr({ playerProtection: {} }, "age", "d"), /CAST\(NULL AS DECIMAL/);
  assert.match(pp.statutorySlotsCapExpr({}, "age", "d"), /CAST\(NULL AS DECIMAL/);
});

test("stake limits: the breach detector is written once — per-market values come from config (REQ-MSL-5)", () => {
  const sql = squash(pp.rgBreachStakeLimits(fakeCtx));
  assert.match(sql, /limit_type = 'STAKE_CASINO'/);            // personal cap, existing machinery
  assert.match(sql, /canonical_game_type = 'SLOT'/);           // statutory is slots-only (UKGC scope)
  assert.match(sql, /THEN 5\.00/);                             // MT adult band
  assert.match(sql, /THEN 2\.00/);                             // MT youth band
  assert.match(sql, /THEN 10\.00/);                            // ES flat cap
  // every market with playerProtection gets a branch — BG/GR/DE included
  for (const code of ["MT", "ES", "DK", "BG", "GR", "NL", "DE"]) {
    assert.ok(sql.includes(`'${code}' AS jurisdiction`), `branch for ${code}`);
  }
});

test("stake limits: the reference rows flatten config — MT staggered bands, DE graduated 2026 bands, none for BG/GR (REQ-MSL-6)", () => {
  const rows = pp.stakeLimitRows();
  assert.equal(rows.length, 8);
  assert.equal(rows.filter((r) => r.jurisdiction === "MT").length, 2);
  // Germany's real GGL progression: EUR 1 flat (2021-2026) -> EUR 1 for
  // 18-20 / EUR 3 for 21+ from 1 Jul 2026
  assert.equal(rows.filter((r) => r.jurisdiction === "DE").length, 3);
  assert.equal(rows.filter((r) => ["BG", "GR"].includes(r.jurisdiction)).length, 0);
});

test("dialect: ageYears exists for both engines and round-trips (REQ-MSL-7)", () => {
  dialect.setDialect("duckdb");
  assert.match(dialect.ageYears("dob", "d"), /365\.2425/);
  dialect.setDialect("bigquery");
  assert.match(dialect.ageYears("dob", "d"), /DATE_DIFF/);
});

test("stake limits: the validator rejects malformed bands before they can compile", () => {
  const clone = JSON.parse(JSON.stringify(jurisdictions));
  clone.MT.playerProtection.slotsStakeLimits = [{ maxStake: -1, minAge: 12, from: "soon" }];
  const errors = validateAll(clone, commonRules, commonGamingRules);
  assert.ok(errors.some((e) => /positive numeric maxStake/.test(e)));
  assert.ok(errors.some((e) => /minAge must be a number >= 18/.test(e)));
  assert.ok(errors.some((e) => /'from' must be a YYYY-MM-DD/.test(e)));
});
