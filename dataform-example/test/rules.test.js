"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { RULE_TYPES, violationQuery, marketRules } = require("../includes/rules");
const { fakeCtx, validMarket, squash } = require("./support/helpers");

test("rules: every rule type declares validate and violations", () => {
  for (const [name, type] of Object.entries(RULE_TYPES)) {
    assert.equal(typeof type.validate, "function", `${name}.validate`);
    assert.equal(typeof type.violations, "function", `${name}.violations`);
  }
});

test("rules: not_null selects rows where the field is null", () => {
  const j = validMarket({ code: "MT" });
  const sql = squash(violationQuery(fakeCtx, j, { id: "R1", type: "not_null", field: "slip_id" }));
  assert.match(sql, /FROM `core\.submission_ready_mt` WHERE slip_id IS NULL/);
  assert.match(sql, /'R1' AS rule_id/);
});

test("rules: in_set flags values outside the allowed set", () => {
  const sql = violationQuery(fakeCtx, validMarket(), {
    id: "R2", type: "in_set", field: "slip_status", values: ["SETTLED", "VOIDED"],
  });
  assert.match(sql, /slip_status NOT IN \('SETTLED', 'VOIDED'\)/);
});

test("rules: zero_when flags non-zero payout on voided slips", () => {
  const sql = violationQuery(fakeCtx, validMarket(), {
    id: "R3", type: "zero_when", field: "payout", whenField: "slip_status", equals: "VOIDED",
  });
  assert.match(sql, /slip_status = 'VOIDED' AND payout != 0/);
});

test("rules: unique groups by field and flags duplicates", () => {
  const sql = squash(violationQuery(fakeCtx, validMarket(), {
    id: "R4", type: "unique", field: "slip_id",
  }));
  assert.match(sql, /GROUP BY slip_id HAVING COUNT\(\*\) > 1/);
});

test("rules: no_voided_slips joins the lifecycle fact (cross-domain check)", () => {
  const sql = squash(violationQuery(fakeCtx, validMarket({ code: "ES" }), {
    id: "R5", type: "no_voided_slips",
  }));
  assert.match(sql, /JOIN `core\.fct_bet_slip_lifecycle` b USING \(slip_id\)/);
  assert.match(sql, /b\.slip_status = 'VOIDED'/);
});

test("rules: matches uses a raw regex against the field", () => {
  const sql = violationQuery(fakeCtx, validMarket(), {
    id: "R6", type: "matches", field: "player_dni_hash", pattern: "^[0-9a-f]{64}$",
  });
  assert.match(sql, /NOT REGEXP_CONTAINS\(player_dni_hash, r'\^\[0-9a-f\]\{64\}\$'\)/);
});

test("rules: unknown rule type throws with rule id and market", () => {
  assert.throws(
    () => violationQuery(fakeCtx, validMarket({ code: "MT" }), { id: "R9", type: "telepathy" }),
    /Unknown rule type 'telepathy' \(rule R9, market MT\)/
  );
});

test("rules: marketRules prepends common rules to market rules", () => {
  const common = [{ id: "C1", type: "not_null", field: "slip_id" }];
  const j = validMarket({ rules: [{ id: "M1", type: "non_negative", field: "stake" }] });
  assert.deepEqual(marketRules(j, common).map((r) => r.id), ["C1", "M1"]);
});
