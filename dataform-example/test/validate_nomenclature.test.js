"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateMarket } = require("../includes/validate");
const { validMarket } = require("./support/helpers");

function nomMarket(nomOverrides = {}, marketOverrides = {}) {
  return validMarket({
    reportFields: ["slip_id", "stake", "payout", "sport_code", "event_name"],
    nomenclature: {
      sportCodes: { FOOT: "01" },
      unmappedPolicy: "default",
      defaultSportCode: "99",
      eventNameTemplate: "{home} v {away}",
      ...nomOverrides,
    },
    ...marketOverrides,
  });
}

test("validate: clean nomenclature config passes", () => {
  assert.deepEqual(validateMarket(nomMarket(), []), []);
});

test("validate: sport_code field without nomenclature config is caught", () => {
  const j = nomMarket();
  delete j.nomenclature;
  const errors = validateMarket(j, []);
  assert.ok(errors.some((e) => e.includes("require nomenclature config")));
});

test("validate: mapping a non-existent canonical sport is caught with pointer", () => {
  const errors = validateMarket(nomMarket({ sportCodes: { FOOT: "01", FOTB: "02" } }), []);
  assert.ok(errors.some((e) =>
    e.includes("unknown canonical sport 'FOTB'") && e.includes("canonical.js")));
});

test("validate: 'default' policy without a default code is caught", () => {
  const errors = validateMarket(nomMarket({ defaultSportCode: null }), []);
  assert.ok(errors.some((e) => e.includes("requires defaultSportCode")));
});

test("validate: 'block' policy without an enforcing rule is caught", () => {
  const errors = validateMarket(
    nomMarket({ unmappedPolicy: "block", defaultSportCode: null }),
    []
  );
  assert.ok(errors.some((e) => e.includes("requires a no_unmapped_fixtures rule")));
});

test("validate: 'block' policy WITH the enforcing rule passes", () => {
  const j = nomMarket({ unmappedPolicy: "block", defaultSportCode: null }, {
    rules: [{ id: "X-1", type: "no_unmapped_fixtures", description: "closed list" }],
  });
  assert.deepEqual(validateMarket(j, []), []);
});

test("validate: unknown template token is caught", () => {
  const errors = validateMarket(nomMarket({ eventNameTemplate: "{home} vs {opponent}" }), []);
  assert.ok(errors.some((e) => e.includes("{home} and {away}")));
});

test("validate: invalid unmappedPolicy value is caught", () => {
  const errors = validateMarket(nomMarket({ unmappedPolicy: "ignore" }), []);
  assert.ok(errors.some((e) => e.includes("'default' or 'block'")));
});
