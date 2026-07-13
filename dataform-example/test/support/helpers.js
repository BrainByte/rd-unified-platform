// Shared test helpers.
"use strict";

// Minimal stand-in for Dataform's ctx.
const fakeCtx = { ref: (name) => `\`core.${name}\`` };

// A minimal valid market config; tests override single keys to create
// exactly one deliberate defect at a time.
function validMarket(overrides = {}) {
  return {
    code: "XX",
    dataset: "reporting_xx",
    currency: "EUR",
    rounding: 2,
    timezone: "Europe/Malta",
    submissionCadence: "daily",
    includeVoided: false,
    taxModel: "ggr",
    taxRate: 0.1,
    reportFields: ["slip_id", "stake", "payout"],
    rules: [],
    ...overrides,
  };
}

// Normalise whitespace so tests assert on SQL content, not formatting.
function squash(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

module.exports = { fakeCtx, validMarket, squash };
