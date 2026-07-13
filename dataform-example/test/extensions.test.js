"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const dialect = require("../includes/dialect");
const { selectExtensionFields, extensionJoins, knownExtensions } = require("../includes/extensions");
const { submissionQuery } = require("../includes/queries");
const { validateMarket } = require("../includes/validate");
const { jurisdictions } = require("../includes/jurisdictions");
const { fakeCtx, validMarket, squash } = require("./support/helpers");

after(() => dialect.setDialect("bigquery"));

test("extensions: carrier-sourced attribute selects the carrier value and joins the generic carrier on the entity key", () => {
  const dk = jurisdictions.DK;
  assert.match(selectExtensionFields(dk), /x_safe_tampertoken\.attr_value AS safe_tampertoken/);
  const joins = squash(extensionJoins(fakeCtx, dk));
  assert.match(joins, /LEFT JOIN `core\.stg_reg_attributes` x_safe_tampertoken/);
  assert.match(joins, /x_safe_tampertoken\.entity_type = 'SLIP'/);
  assert.match(joins, /x_safe_tampertoken\.entity_id = b\.slip_id/);
  assert.match(joins, /x_safe_tampertoken\.attr_name = 'safe_tampertoken'/);
});

test("extensions: computed hash attribute needs no carrier join (BG EGN hash)", () => {
  const bg = jurisdictions.BG;
  assert.match(selectExtensionFields(bg), /AS player_egn_hash/);
  // egn hash is computed -> only the carrier-sourced nra_registration_id joins
  const joins = extensionJoins(fakeCtx, bg);
  assert.match(joins, /x_nra_registration_id/);
  assert.doesNotMatch(joins, /x_player_egn_hash/);
});

test("extensions: GR winnings withholding is generated from the config brackets (progressive tiers)", () => {
  const gr = jurisdictions.GR;
  const sql = squash(selectExtensionFields(gr));
  // 2.5% band 100-200, 5% band 200-500, 7.5% band 500+, on b.payout
  assert.match(sql, /0\.025 \* GREATEST\(0, LEAST\(b\.payout, 200\) - 100\)/);
  assert.match(sql, /0\.05 \* GREATEST\(0, LEAST\(b\.payout, 500\) - 200\)/);
  assert.match(sql, /0\.075 \* GREATEST\(0, b\.payout - 500\)/);
  assert.match(sql, /AS winnings_withholding_tax/);
});

test("extensions: a market with no extensions adds nothing — the shared core query is unchanged", () => {
  const plain = validMarket({ code: "MT" });
  assert.equal(selectExtensionFields(plain), "");
  assert.equal(extensionJoins(fakeCtx, plain), "");
  const sql = submissionQuery(fakeCtx, plain);
  assert.doesNotMatch(sql, /stg_reg_attributes/);
});

test("extensions: an unknown attribute is rejected at build time and by the validator", () => {
  const bad = validMarket({ extensions: ["not_a_real_attribute"] });
  assert.throws(() => selectExtensionFields(bad), /Unknown extension attribute/);
  const errors = validateMarket(bad, []);
  assert.ok(errors.some((e) => e.includes("unknown attribute 'not_a_real_attribute'")));
  // sanity: the real registry is non-empty
  assert.ok(knownExtensions().length >= 3);
});
