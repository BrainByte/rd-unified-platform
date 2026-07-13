"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { jurisdictions, commonRules, commonGamingRules } = require("../includes/jurisdictions");
const { validateAll, validateMarket } = require("../includes/validate");
const { gamingSubmissionQuery, gamingTaxSummaryQuery } = require("../includes/queries");
const { violationQuery } = require("../includes/rules");
const { gameTypeAliases } = require("../includes/nomenclature/aliases");
const { canonicalGameTypes } = require("../includes/nomenclature/canonical");
const { normalise } = require("../includes/nomenclature/mapping");
const { fakeCtx, validMarket, squash } = require("./support/helpers");

function gamingMarket(overrides = {}) {
  return validMarket({
    gamingReportFields: ["activity_id", "game_code", "vertical", "stake", "payout", "rake_or_fee", "gaming_ggr"],
    gamingNomenclature: {
      gameCodes: { SLOT: "1", POKC: "3" },
      unmappedPolicy: "default",
      defaultGameCode: "1",
    },
    gamingTaxRate: 0.05,
    jackpotPolicy: "deduct_contributions",
    gamingRules: [],
    ...overrides,
  });
}

test("gaming: live config (incl. gaming domain) is clean", () => {
  assert.deepEqual(validateAll(jurisdictions, commonRules, commonGamingRules), []);
});

test("gaming: alias data integrity — no game-type alias maps to two canonicals, all targets real", () => {
  const canon = new Set(canonicalGameTypes.map((g) => g.code));
  const seen = new Map();
  for (const a of gameTypeAliases) {
    const key = normalise(a.alias);
    assert.ok(!seen.has(key) || seen.get(key) === a.canonical, `alias '${a.alias}' conflicts`);
    seen.set(key, a.canonical);
    assert.ok(canon.has(a.canonical), `alias '${a.alias}' -> unknown canonical '${a.canonical}'`);
  }
});

test("gaming: GGR is rake/fee for poker, stake-payout(-contribution) for casino per jackpot policy, stake-payout for operator jackpot", () => {
  const sqlDeduct = squash(gamingSubmissionQuery(fakeCtx, gamingMarket()));
  assert.match(sqlDeduct, /CASE WHEN g\.vertical = 'CASINO_ROUND' THEN g\.stake - g\.payout - g\.jackpot_contribution WHEN g\.vertical = 'OPERATOR_JACKPOT' THEN g\.stake - g\.payout ELSE g\.rake_or_fee END/);

  const sqlGross = squash(gamingSubmissionQuery(fakeCtx, gamingMarket({ jackpotPolicy: "gross" })));
  // operator-jackpot arm is present regardless of jackpot policy
  assert.match(sqlGross, /WHEN g\.vertical = 'OPERATOR_JACKPOT' THEN g\.stake - g\.payout ELSE g\.rake_or_fee END/);
  assert.doesNotMatch(sqlGross, /jackpot_contribution WHEN/);
});

test("gaming: submission joins activity, account, game and this market's regulator map", () => {
  const sql = squash(gamingSubmissionQuery(fakeCtx, gamingMarket({ code: "ES" })));
  assert.match(sql, /FROM `core\.fct_gaming_activity` g/);
  assert.match(sql, /LEFT JOIN `core\.dim_game` gm ON g\.game_id = gm\.game_id/);
  assert.match(sql, /grm\.jurisdiction = 'ES' AND grm\.canonical_game_type = gm\.canonical_game_type/);
});

test("gaming: game_code degrades to default bucket under 'default', stays NULL-able under 'block'", () => {
  const d = squash(gamingSubmissionQuery(fakeCtx, gamingMarket()));
  assert.match(d, /COALESCE\(grm\.regulator_code, '1'\) AS game_code/);

  const j = gamingMarket();
  j.gamingNomenclature = { ...j.gamingNomenclature, unmappedPolicy: "block", defaultGameCode: null };
  j.gamingRules = [{ id: "X-1", type: "no_unlicensed_games", description: "d" }];
  const b = squash(gamingSubmissionQuery(fakeCtx, j));
  assert.match(b, /grm\.regulator_code AS game_code/);
});

test("gaming: tax summary applies the market's gaming rate to summed GGR", () => {
  const sql = squash(gamingTaxSummaryQuery(fakeCtx, gamingMarket({ gamingTaxRate: 0.2 })));
  assert.match(sql, /ggr_sum \* \(0\.2\), 2\) AS gaming_tax_due/);
});

test("gaming: effective-dated gaming rate resolves by report_date", () => {
  const sql = squash(gamingTaxSummaryQuery(fakeCtx, gamingMarket({
    gamingTaxRate: [{ rate: 0.05, to: "2026-01-01" }, { rate: 0.1, from: "2026-01-01" }],
  })));
  assert.match(sql, /CASE WHEN report_date < DATE '2026-01-01' THEN 0\.05 WHEN report_date >= DATE '2026-01-01' THEN 0\.1 ELSE NULL END/);
});

test("gaming rules: valid_game_code allows held codes plus default bucket, deduped", () => {
  const sql = violationQuery(fakeCtx, gamingMarket(), { id: "R1", type: "valid_game_code" },
    { table: "gaming_submission_ready_xx", keyColumn: "activity_id" });
  assert.match(sql, /game_code IS NULL OR game_code NOT IN \('1', '3'\)/); // '1' deduped, default '1' not repeated
  assert.match(sql, /activity_id AS row_key/);
});

test("gaming rules: no_unlicensed_games joins game catalogue and regulator map", () => {
  const sql = squash(violationQuery(fakeCtx, gamingMarket({ code: "ES" }),
    { id: "R2", type: "no_unlicensed_games" },
    { table: "gaming_submission_ready_es", keyColumn: "activity_id" }));
  assert.match(sql, /JOIN `core\.fct_gaming_activity` g ON s\.activity_id = g\.activity_id/);
  assert.match(sql, /WHERE grm\.regulator_code IS NULL/);
});

test("gaming rules: rule engine options don't disturb betting defaults", () => {
  const sql = violationQuery(fakeCtx, gamingMarket({ code: "MT" }),
    { id: "R3", type: "not_null", field: "slip_id" });
  assert.match(sql, /FROM `core\.submission_ready_mt`/);
  assert.match(sql, /slip_id AS row_key/);
});

test("gaming validate: block policy without no_unlicensed_games rule is caught", () => {
  const j = gamingMarket();
  j.gamingNomenclature = { ...j.gamingNomenclature, unmappedPolicy: "block", defaultGameCode: null };
  const errors = validateMarket(j, [], []);
  assert.ok(errors.some((e) => e.includes("requires a no_unlicensed_games rule")));
});

test("gaming validate: unknown canonical game type in codes map is caught", () => {
  const j = gamingMarket();
  j.gamingNomenclature = { ...j.gamingNomenclature, gameCodes: { SLOT: "1", SLTO: "9" } };
  const errors = validateMarket(j, [], []);
  assert.ok(errors.some((e) => e.includes("unknown canonical game type 'SLTO'")));
});

test("gaming validate: unknown gaming field and invalid jackpotPolicy are caught", () => {
  const j = gamingMarket({ jackpotPolicy: "maybe", gamingReportFields: ["activity_id", "made_up"] });
  const errors = validateMarket(j, [], []);
  assert.ok(errors.some((e) => e.includes("unknown field 'made_up'")));
  assert.ok(errors.some((e) => e.includes("jackpotPolicy must be")));
});

test("gaming validate: gaming rule referencing a column absent from the gaming file is caught", () => {
  const j = gamingMarket({
    gamingRules: [{ id: "X-9", type: "in_set", field: "slip_status", values: ["A"], description: "d" }],
  });
  const errors = validateMarket(j, [], []);
  assert.ok(errors.some((e) => e.includes("X-9") && e.includes("gaming file")));
});
