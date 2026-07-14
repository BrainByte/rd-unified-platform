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

// ---- SESSION rule types (REQ: requirements/session-tracking, REQ-ST-5) ----

function sessionMarket(granularity = "per_game") {
  return validMarket({
    code: "NL",
    sessionReporting: {
      granularity, timeoutMinutes: 30,
      endReasons: ["LOGOUT", "INACTIVITY"], reportEmptySessions: false, rules: [],
    },
  });
}

test("rules: activity_within_session flags plays outside the platform session window, scoped to the market's players", () => {
  const sql = squash(violationQuery(fakeCtx, sessionMarket(), { id: "ST-201", type: "activity_within_session" }));
  assert.match(sql, /JOIN `core\.fct_platform_sessions` s ON g\.session_id = s\.session_id/);
  assert.match(sql, /g\.occurred_at < s\.started_at/);
  assert.match(sql, /s\.ended_at IS NOT NULL AND g\.occurred_at > s\.ended_at/);
  assert.match(sql, /a\.jurisdiction = 'NL'/);
});

test("rules: single_open_session flags an account with more than one open platform session", () => {
  const sql = squash(violationQuery(fakeCtx, sessionMarket(), { id: "ST-202", type: "single_open_session" }));
  assert.match(sql, /s\.ended_at IS NULL/);
  assert.match(sql, /GROUP BY s\.account_id HAVING COUNT\(\*\) > 1/);
});

test("rules: end_reason_in_set takes its vocabulary from sessionReporting config, not the rule", () => {
  const sql = squash(violationQuery(fakeCtx, sessionMarket(), { id: "ST-203", type: "end_reason_in_set" },
    { table: "submission_sessions_nl", keyColumn: "session_id" }));
  assert.match(sql, /end_reason IS NULL OR end_reason NOT IN \('LOGOUT', 'INACTIVITY'\)/);
  assert.match(sql, /FROM `core\.submission_sessions_nl`/);
});

test("rules: end_reason_in_set validation requires a non-empty configured vocabulary", () => {
  const bare = sessionMarket();
  bare.sessionReporting.endReasons = [];
  const errors = RULE_TYPES.end_reason_in_set.validate({ id: "ST-203" }, bare);
  assert.ok(errors.some((e) => e.includes("endReasons")));
});

test("rules: single_game_session (THE invariant) groups the pre-aggregation set by game-session key and counts distinct games", () => {
  const sql = squash(violationQuery(fakeCtx, sessionMarket(), { id: "ST-204", type: "single_game_session" }));
  assert.match(sql, /FROM `core\.fct_game_session_activity` ga/);
  assert.match(sql, /GROUP BY ga\.game_session_id HAVING COUNT\(DISTINCT ga\.game_id\) > 1/);
});

test("rules: single_game_session only validates on per_game markets — a platform-granularity market never derives game sessions", () => {
  const errors = RULE_TYPES.single_game_session.validate({ id: "ST-204" }, sessionMarket("platform"));
  assert.ok(errors.some((e) => e.includes("per_game")));
  assert.deepEqual(RULE_TYPES.single_game_session.validate({ id: "ST-204" }, sessionMarket()), []);
});
