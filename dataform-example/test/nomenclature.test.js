"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalise, rowsToSelect, renderEventName, templateTokensValid,
} = require("../includes/nomenclature/mapping");
const { sportAliases, participantAliases } = require("../includes/nomenclature/aliases");
const { canonicalSports } = require("../includes/nomenclature/canonical");
const { violationQuery } = require("../includes/rules");
const { submissionQuery } = require("../includes/queries");
const { fakeCtx, validMarket, squash } = require("./support/helpers");

// ---- normalisation: the matching contract ----
test("normalise: case, whitespace, diacritics and punctuation collapse", () => {
  assert.equal(normalise("  FÚTBOL "), "futbol");
  assert.equal(normalise("R. Nadal"), "r nadal");
  assert.equal(normalise("Assoc   Football"), "assoc football");
  assert.equal(normalise("Barça"), "barca");
});

test("normalise: distinct sports stay distinct", () => {
  assert.notEqual(normalise("Football"), normalise("Basketball"));
});

// ---- alias data integrity (guards the growing data files) ----
test("aliases: no alias normalises to two different canonicals", () => {
  const seen = new Map();
  for (const a of sportAliases) {
    const key = normalise(a.alias);
    assert.ok(!seen.has(key) || seen.get(key) === a.canonical,
      `alias '${a.alias}' conflicts: ${seen.get(key)} vs ${a.canonical}`);
    seen.set(key, a.canonical);
  }
});

test("aliases: every sport alias targets a real canonical code", () => {
  const canon = new Set(canonicalSports.map((s) => s.code));
  for (const a of sportAliases) {
    assert.ok(canon.has(a.canonical), `alias '${a.alias}' -> unknown canonical '${a.canonical}'`);
  }
});

test("aliases: participant aliases sharing an id share a canonical name", () => {
  const names = new Map();
  for (const p of participantAliases) {
    assert.ok(!names.has(p.canonicalId) || names.get(p.canonicalId) === p.canonicalName,
      `participant ${p.canonicalId} has two names`);
    names.set(p.canonicalId, p.canonicalName);
  }
});

// ---- data-to-table helper ----
test("rowsToSelect: emits UNION ALL with escaped literals and NULLs", () => {
  const sql = rowsToSelect(
    [{ a: "it's", b: null }, { a: "x", b: "y" }],
    ["a", "b"]
  );
  assert.match(sql, /SELECT 'it\\'s' AS a, CAST\(NULL AS STRING\) AS b/);
  assert.match(sql, /UNION ALL/);
});

// ---- event name templates ----
test("renderEventName: template compiles to CONCAT of participants", () => {
  assert.equal(renderEventName("{home} v {away}"), "CONCAT(f.home_name, ' v ', f.away_name)");
  assert.equal(renderEventName("{home} - {away}"), "CONCAT(f.home_name, ' - ', f.away_name)");
});

test("templateTokensValid: rejects unknown tokens", () => {
  assert.ok(templateTokensValid("{home} v {away}"));
  assert.ok(!templateTokensValid("{home} v {team2}"));
});

// ---- nomenclature-aware market config for query/rule tests ----
function nomMarket(overrides = {}) {
  return validMarket({
    reportFields: ["slip_id", "stake", "payout", "sport_code", "event_name"],
    nomenclature: {
      sportCodes: { FOOT: "01", TENN: "02" },
      unmappedPolicy: "default",
      defaultSportCode: "99",
      eventNameTemplate: "{home} v {away}",
    },
    ...overrides,
  });
}

test("fields: sport_code degrades to default bucket under 'default' policy", () => {
  const sql = squash(submissionQuery(fakeCtx, nomMarket()));
  assert.match(sql, /COALESCE\(rm\.regulator_code, '99'\) AS sport_code/);
});

test("fields: sport_code stays NULL-able under 'block' policy (rule enforces)", () => {
  const j = nomMarket();
  j.nomenclature = { ...j.nomenclature, unmappedPolicy: "block", defaultSportCode: null };
  const sql = squash(submissionQuery(fakeCtx, j));
  assert.match(sql, /rm\.regulator_code AS sport_code/);
  assert.doesNotMatch(sql, /COALESCE\(rm\.regulator_code/);
});

test("queries: submission joins fixture and this market's regulator map", () => {
  const sql = squash(submissionQuery(fakeCtx, nomMarket({ code: "MT" })));
  assert.match(sql, /LEFT JOIN `core\.dim_fixture` f ON b\.fixture_id = f\.fixture_id/);
  assert.match(sql, /rm\.jurisdiction = 'MT' AND rm\.canonical_sport = f\.canonical_sport/);
});

// ---- nomenclature rule types ----
test("rules: valid_sport_code allows regulator codes plus the default bucket", () => {
  const sql = violationQuery(fakeCtx, nomMarket(), { id: "R1", type: "valid_sport_code" });
  assert.match(sql, /sport_code IS NULL OR sport_code NOT IN \('01', '02', '99'\)/);
});

test("rules: no_unmapped_fixtures flags slips whose sport has no regulator code", () => {
  const sql = squash(violationQuery(fakeCtx, nomMarket({ code: "ES" }), {
    id: "R2", type: "no_unmapped_fixtures",
  }));
  assert.match(sql, /LEFT JOIN `core\.map_sport_regulator` rm/);
  assert.match(sql, /WHERE rm\.regulator_code IS NULL/);
});
