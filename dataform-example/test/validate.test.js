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

// REQ: requirements/session-tracking (REQ-ST-2) — session reporting is
// config; a malformed block must fail validation before compiling anything.
function sessionMarket(sr = {}) {
  return validMarket({
    sessionReporting: {
      granularity: "platform", timeoutMinutes: 30,
      endReasons: ["LOGOUT", "INACTIVITY"], reportEmptySessions: false,
      rules: [], ...sr,
    },
  });
}

test("validate: a well-formed sessionReporting block passes (both granularities)", () => {
  assert.deepEqual(validateMarket(sessionMarket(), []), []);
  assert.deepEqual(validateMarket(sessionMarket({ granularity: "per_game" }), []), []);
});

test("validate: sessionReporting rejects unknown granularity, non-positive timeout and empty end-reason vocabulary", () => {
  const errors = [
    ...validateMarket(sessionMarket({ granularity: "per_round" }), []),
    ...validateMarket(sessionMarket({ timeoutMinutes: 0 }), []),
    ...validateMarket(sessionMarket({ endReasons: [] }), []),
  ];
  assert.ok(errors.some((e) => e.includes("granularity must be 'platform' or 'per_game'")));
  assert.ok(errors.some((e) => e.includes("timeoutMinutes must be a positive number")));
  assert.ok(errors.some((e) => e.includes("endReasons must be a non-empty array")));
});

test("validate: session column rule referencing a column absent from that granularity's file is caught", () => {
  // 'rounds' exists only at per_game grain — a platform market can't rule on it
  const errors = validateMarket(sessionMarket({
    rules: [{ id: "SX-1", type: "non_negative", field: "rounds", description: "d" }],
  }), []);
  assert.ok(errors.some((e) => e.includes("SX-1") && e.includes("'rounds'") && e.includes("session file")));
  // ...but a per_game market can
  const ok = validateMarket(sessionMarket({
    granularity: "per_game",
    rules: [{ id: "SX-1", type: "non_negative", field: "rounds", description: "d" }],
  }), []);
  assert.deepEqual(ok, []);
});

test("validate: the single-game invariant is rejected on a platform-granularity market", () => {
  const errors = validateMarket(sessionMarket({
    rules: [{ id: "ST-204", type: "single_game_session", description: "d" }],
  }), []);
  assert.ok(errors.some((e) => e.includes("ST-204") && e.includes("per_game")));
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
