"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateMarket, validateAll } = require("../includes/validate");
const { jurisdictions, commonRules } = require("../includes/jurisdictions");
const { validMarket } = require("./support/helpers");

test("validate: the real production config is clean", () => {
  assert.deepEqual(validateAll(jurisdictions, commonRules), []);
});

test("validate: a minimal valid market passes", () => {
  assert.deepEqual(validateMarket(validMarket(), []), []);
});

test("validate: missing required key is reported by name", () => {
  const j = validMarket();
  delete j.taxRate;
  const errors = validateMarket(j, []);
  assert.ok(errors.some((e) => e.includes("missing required config key 'taxRate'")));
});

test("validate: unknown report field points to fields.js", () => {
  const errors = validateMarket(validMarket({ reportFields: ["slip_id", "made_up"] }), []);
  assert.ok(errors.some((e) => e.includes("unknown field 'made_up'") && e.includes("fields.js")));
});

test("validate: includeVoided requires slip_status in the file", () => {
  const errors = validateMarket(
    validMarket({ includeVoided: true, reportFields: ["slip_id", "stake", "payout"] }),
    []
  );
  assert.ok(errors.some((e) => e.includes("requires 'slip_status'")));
});

test("validate: duplicate rule ids are caught", () => {
  const errors = validateMarket(
    validMarket({
      rules: [
        { id: "X-1", type: "not_null", field: "slip_id", description: "a" },
        { id: "X-1", type: "non_negative", field: "stake", description: "b" },
      ],
    }),
    []
  );
  assert.ok(errors.some((e) => e.includes("duplicate rule id 'X-1'")));
});

test("validate: rule without description fails (audit trail)", () => {
  const errors = validateMarket(
    validMarket({ rules: [{ id: "X-2", type: "not_null", field: "slip_id" }] }),
    []
  );
  assert.ok(errors.some((e) => e.includes("X-2") && e.includes("no description")));
});

test("validate: column rule referencing a field absent from the file is caught", () => {
  const errors = validateMarket(
    validMarket({
      // slip_status is NOT in reportFields for this market
      rules: [{ id: "X-3", type: "in_set", field: "slip_status", values: ["SETTLED"], description: "d" }],
    }),
    []
  );
  assert.ok(errors.some((e) => e.includes("X-3") && e.includes("'slip_status'") && e.includes("not in the")));
});

test("validate: unknown rule type is caught at config time", () => {
  const errors = validateMarket(
    validMarket({ rules: [{ id: "X-4", type: "vibes", description: "d" }] }),
    []
  );
  assert.ok(errors.some((e) => e.includes("unknown type 'vibes'")));
});

test("validate: rule-type parameter validation surfaces (max_value without value)", () => {
  const errors = validateMarket(
    validMarket({ rules: [{ id: "X-5", type: "max_value", field: "stake", description: "d" }] }),
    []
  );
  assert.ok(errors.some((e) => e.includes("X-5") && e.includes("numeric 'value'")));
});

// REQ: de-regulator-addition — the two config-model extensions Germany needed.
test("validate: taxModel accepts ggr/turnover and rejects anything else", () => {
  assert.equal(validateMarket(validMarket({ taxModel: "turnover" }), []).length, 0);
  const errors = validateMarket(validMarket({ taxModel: "revenue" }), []);
  assert.ok(errors.some((e) => e.includes("taxModel must be 'ggr' or 'turnover'")));
});

test("validate: defaultDepositLimits allows per-period nulls (DE: monthly-only LUGAS 1000)", () => {
  const ok = validateMarket(validMarket({
    playerProtection: { defaultDepositLimits: { daily: null, weekly: null, monthly: 1000 },
                        selfExclusionSources: ["OPERATOR"], withdrawalRequiresVerification: true },
  }), []);
  assert.equal(ok.length, 0);
  const bad = validateMarket(validMarket({
    playerProtection: { defaultDepositLimits: { daily: null, weekly: null, monthly: null },
                        selfExclusionSources: ["OPERATOR"], withdrawalRequiresVerification: true },
  }), []);
  assert.ok(bad.some((e) => e.includes("at least one period")));
});
