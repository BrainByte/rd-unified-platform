"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fieldSql, selectFields } = require("../includes/fields");
const { validMarket, squash } = require("./support/helpers");

test("fields: rounding config is applied to monetary fields", () => {
  const j = validMarket({ rounding: 3 });
  assert.equal(fieldSql("stake", j), "ROUND(b.stake, 3)");
  assert.equal(fieldSql("payout", j), "ROUND(b.payout, 3)");
});

test("fields: timezone config drives local timestamp conversion", () => {
  const j = validMarket({ timezone: "Europe/Madrid" });
  assert.equal(fieldSql("placed_at_local", j), "DATETIME(b.placed_at, 'Europe/Madrid')");
});

test("fields: ggr derives from stake minus payout", () => {
  const j = validMarket();
  assert.equal(fieldSql("ggr", j), "ROUND(b.stake - b.payout, 2)");
});

test("fields: unknown field throws with actionable message", () => {
  const j = validMarket();
  assert.throws(() => fieldSql("mystery_field", j), /Unknown field 'mystery_field'.*includes\/fields\.js/);
});

test("fields: selectFields emits every configured field with alias, in order", () => {
  const j = validMarket({ reportFields: ["slip_id", "ggr"] });
  const sql = squash(selectFields(j));
  assert.equal(sql, "b.slip_id AS slip_id, ROUND(b.stake - b.payout, 2) AS ggr");
});
