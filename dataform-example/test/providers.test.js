"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { providers, validateProviders, normalisedRounds, providerGgrRecon } = require("../includes/providers");
const { fakeCtx, squash } = require("./support/helpers");

test("providers: live registry is valid (grains, mappings, unique prefixes)", () => {
  assert.deepEqual(validateProviders(), []);
});

test("providers: registry validation catches missing map keys, bad grain, duplicate prefixes", () => {
  const broken = {
    a: { displayName: "A", prefix: "AA", feed: "f", grain: "round", scale: 1,
         map: { roundRef: "r", playerRef: "p", gameRef: "g", wager: "w", ts: "t" } }, // payout missing
    b: { displayName: "B", prefix: "AA", feed: "f2", grain: "stream", scale: 0,
         map: {} },
  };
  const errors = validateProviders(broken);
  assert.ok(errors.some((e) => e.includes("[a]") && e.includes("'payout'")));
  assert.ok(errors.some((e) => e.includes("[b]") && e.includes("unknown grain 'stream'")));
  assert.ok(errors.some((e) => e.includes("duplicate prefix 'AA'")));
  assert.ok(errors.some((e) => e.includes("scale must be a positive number")));
});

test("providers: round ids are provider-namespaced (refs collide across providers)", () => {
  const sql = normalisedRounds(fakeCtx);
  assert.match(sql, /CONCAT\('NE:', f\.round_ref\) AS round_id/);
  assert.match(sql, /CONCAT\('PT:', f\.round_ref\) AS round_id/);
  assert.match(sql, /CONCAT\('EV:', t\.round_ref\) AS round_id/);
});

test("providers: NetEnt round-grain adapter renames provider fields and carries jackpot columns", () => {
  const sql = squash(normalisedRounds(fakeCtx));
  assert.match(sql, /f\.bet_amount AS wager/);
  assert.match(sql, /f\.win_amount AS payout/);
  assert.match(sql, /COALESCE\(f\.jp_contribution, 0\)[\s\S]*AS jackpot_contribution/);
});

test("providers: Evolution transaction-grain adapter aggregates BET/WIN and scales cents", () => {
  const sql = squash(normalisedRounds(fakeCtx));
  assert.match(sql, /SUM\(CASE WHEN tx_type = 'BET' THEN amount_cents ELSE 0 END\) AS bet_minor/);
  assert.match(sql, /ROUND\(t\.bet_minor \* 0\.01, 2\) AS wager/);
  // transactions deduped on tx_id before aggregation (CDC replays)
  assert.match(sql, /PARTITION BY tx_id ORDER BY _commit_ts DESC/);
});

test("providers: game resolution uses composite catalogue key; aggregator resolves via sub_provider", () => {
  const sql = squash(normalisedRounds(fakeCtx));
  assert.match(sql, /ON cat\.provider = 'NetEnt' AND cat\.provider_game_ref = f\.game_ref/);
  assert.match(sql, /ON cat\.provider = 'Playtech' AND cat\.provider_game_ref = f\.game_code/);
  assert.match(sql, /ON cat\.provider = f\.sub_provider AND cat\.provider_game_ref = f\.game_ref/);
});

test("providers: providers without jackpot fields emit zero contribution / NULL pool", () => {
  const sql = squash(normalisedRounds(fakeCtx));
  const playtechBlock = sql.split("CONCAT('PT:'")[1].split("UNION ALL")[0];
  assert.match(playtechBlock, /0 AS jackpot_contribution/);
  assert.match(playtechBlock, /CAST\(NULL AS STRING\) AS jackpot_id/);
});

test("providers: GGR recon full-outer-joins internal vs statements with tolerance and break types", () => {
  const sql = squash(providerGgrRecon(fakeCtx));
  assert.match(sql, /FULL OUTER JOIN reported r/);
  assert.match(sql, /ABS\(i\.internal_ggr - r\.reported_ggr\) > 0\.005/);
  assert.match(sql, /'statement with no internal activity'/);
  assert.match(sql, /'internal activity with no statement'/);
});

test("providers: adding a provider is one registry entry — generated union grows, nothing else changes", () => {
  const extended = {
    ...providers,
    pragmatic: {
      displayName: "Pragmatic Play", prefix: "PP", feed: "cdc_pragmatic_rounds",
      grain: "round", scale: 1,
      map: { roundRef: "round_id", playerRef: "player_id", gameRef: "game_symbol",
             wager: "bet", payout: "win", ts: "created_at" },
    },
  };
  assert.deepEqual(validateProviders(extended), []);
  const sql = normalisedRounds(fakeCtx, extended);
  assert.match(sql, /CONCAT\('PP:', f\.round_id\) AS round_id/);
  assert.match(sql, /cat\.provider = 'Pragmatic Play'/);
});
