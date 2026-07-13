// ============================================================================
// GAME PROVIDER ADAPTER LAYER
//
// Real-world problem: every provider integrates differently.
//   - NetEnt: round-grain feed, euros, jackpot contribution embedded
//   - Evolution (live casino): TRANSACTION-grain feed — separate BET and
//     WIN rows per round — with amounts in MINOR UNITS (cents)
//   - Playtech: round-grain, euros, identifies games by its own codes
//   - Long-tail studios (Spribe etc.): via an AGGREGATOR feed that carries
//     a sub_provider column (the Hub88/SoftSwiss-style integration model)
//
// The adapter layer normalises all of them into ONE canonical round shape:
//   (round_id, provider, account_id, game_id, wager, payout,
//    jackpot_contribution, jackpot_id, round_ts)
//
// Provider variance is CONFIG (this registry); the normalising SQL is
// generated. Adding provider #5 = one registry entry (+ its CDC feed
// declaration and seed) — no SQL edits.
//
// Round IDs are NAMESPACED with a provider prefix ('NE:', 'EV:', ...)
// because provider round refs collide across providers.
// ============================================================================

const providers = {
  netent: {
    displayName: "NetEnt",
    prefix: "NE",
    feed: "cdc_netent_rounds",
    grain: "round",
    scale: 1, // amounts already in major units (EUR)
    map: {
      roundRef: "round_ref",
      playerRef: "player_ref",
      gameRef: "game_ref",
      wager: "bet_amount",
      payout: "win_amount",
      contribution: "jp_contribution", // jackpot contribution embedded
      jackpotRef: "jp_id",
      ts: "round_ts",
    },
  },

  evolution: {
    displayName: "Evolution",
    prefix: "EV",
    feed: "cdc_evolution_transactions",
    grain: "transaction", // BET / WIN rows aggregated to round grain
    scale: 0.01, // amounts arrive in cents
    map: {
      roundRef: "round_ref",
      playerRef: "player_ref",
      gameRef: "table_ref", // live tables, not game ids
      txType: "tx_type",    // 'BET' | 'WIN'
      amount: "amount_cents",
      ts: "tx_ts",
    },
  },

  playtech: {
    displayName: "Playtech",
    prefix: "PT",
    feed: "cdc_playtech_rounds",
    grain: "round",
    scale: 1,
    map: {
      roundRef: "round_ref",
      playerRef: "player_ref",
      gameRef: "game_code", // Playtech's own game codes
      wager: "stake",
      payout: "payout",
      ts: "round_ts",
    },
  },

  aggregator: {
    displayName: "Aggregator",
    prefix: "AG",
    feed: "cdc_aggregator_rounds",
    grain: "round",
    scale: 1,
    subProviderColumn: "sub_provider", // catalogue provider comes from the feed
    map: {
      roundRef: "round_ref",
      playerRef: "player_ref",
      gameRef: "game_ref",
      wager: "bet",
      payout: "win",
      ts: "round_ts",
    },
  },
};

const REQUIRED_MAP_KEYS = {
  round: ["roundRef", "playerRef", "gameRef", "wager", "payout", "ts"],
  transaction: ["roundRef", "playerRef", "gameRef", "txType", "amount", "ts"],
};

function validateProviders(registry = providers) {
  const errors = [];
  const prefixes = new Set();
  for (const [key, p] of Object.entries(registry)) {
    if (!p.prefix) errors.push(`[${key}] missing round-id prefix`);
    if (prefixes.has(p.prefix)) errors.push(`[${key}] duplicate prefix '${p.prefix}'`);
    prefixes.add(p.prefix);
    if (typeof p.scale !== "number" || p.scale <= 0) errors.push(`[${key}] scale must be a positive number`);
    if (!REQUIRED_MAP_KEYS[p.grain]) {
      errors.push(`[${key}] unknown grain '${p.grain}' (round|transaction)`);
      continue;
    }
    for (const k of REQUIRED_MAP_KEYS[p.grain]) {
      if (!p.map[k]) errors.push(`[${key}] map missing '${k}' for grain '${p.grain}'`);
    }
  }
  return errors;
}

// amount expression with minor-unit scaling
function amt(expr, p) {
  return p.scale === 1 ? expr : `ROUND(${expr} * ${p.scale}, 2)`;
}

// Game resolution: provider game refs -> internal game_id via the
// catalogue. Direct providers match on their fixed display name; the
// aggregator carries the real studio in sub_provider.
function catalogueJoin(ctx, p, alias) {
  const providerExpr = p.subProviderColumn
    ? `${alias}.${p.subProviderColumn}`
    : `'${p.displayName}'`;
  return `JOIN ${ctx.ref("stg_games")} cat
      ON cat.provider = ${providerExpr}
      AND cat.provider_game_ref = ${alias}.${p.map.gameRef}`;
}

// Round-grain adapter: rename, scale, namespace, dedupe.
function roundGrainSql(ctx, key, p) {
  const m = p.map;
  const providerExpr = p.subProviderColumn ? `f.${p.subProviderColumn}` : `'${p.displayName}'`;
  return `
    SELECT
      CONCAT('${p.prefix}:', f.${m.roundRef}) AS round_id,
      ${providerExpr} AS provider,
      f.${m.playerRef} AS account_id,
      cat.game_id,
      ${amt(`f.${m.wager}`, p)} AS wager,
      ${amt(`f.${m.payout}`, p)} AS payout,
      ${m.contribution ? amt(`COALESCE(f.${m.contribution}, 0)`, p) : "0"} AS jackpot_contribution,
      ${m.jackpotRef ? `f.${m.jackpotRef}` : "CAST(NULL AS STRING)"} AS jackpot_id,
      f.${m.ts} AS round_ts
    FROM (
      SELECT * FROM ${ctx.ref(p.feed)}
      QUALIFY ROW_NUMBER() OVER (PARTITION BY ${m.roundRef} ORDER BY _commit_ts DESC) = 1
        AND _op != 'D'
    ) f
    ${catalogueJoin(ctx, p, "f")}`;
}

// Transaction-grain adapter: dedupe transactions, pivot BET/WIN to a
// round, scale from minor units, namespace.
function transactionGrainSql(ctx, key, p) {
  const m = p.map;
  return `
    SELECT
      CONCAT('${p.prefix}:', t.${m.roundRef}) AS round_id,
      '${p.displayName}' AS provider,
      t.account_id,
      cat.game_id,
      ${amt("t.bet_minor", p)} AS wager,
      ${amt("t.win_minor", p)} AS payout,
      0 AS jackpot_contribution,
      CAST(NULL AS STRING) AS jackpot_id,
      t.round_ts
    FROM (
      SELECT
        ${m.roundRef},
        MIN(${m.playerRef}) AS account_id,
        MIN(${m.gameRef}) AS ${m.gameRef},
        SUM(CASE WHEN ${m.txType} = 'BET' THEN ${m.amount} ELSE 0 END) AS bet_minor,
        SUM(CASE WHEN ${m.txType} = 'WIN' THEN ${m.amount} ELSE 0 END) AS win_minor,
        MIN(${m.ts}) AS round_ts
      FROM (
        SELECT * FROM ${ctx.ref(p.feed)}
        QUALIFY ROW_NUMBER() OVER (PARTITION BY tx_id ORDER BY _commit_ts DESC) = 1
          AND _op != 'D'
      )
      GROUP BY ${m.roundRef}
    ) t
    ${catalogueJoin(ctx, p, "t")}`;
}

// The unified normalised rounds model: UNION ALL over every provider.
function normalisedRounds(ctx, registry = providers) {
  const errors = validateProviders(registry);
  if (errors.length) throw new Error("Invalid provider registry:\n" + errors.join("\n"));
  return Object.entries(registry)
    .map(([key, p]) =>
      p.grain === "transaction" ? transactionGrainSql(ctx, key, p) : roundGrainSql(ctx, key, p)
    )
    .join("\n    UNION ALL\n");
}

// Provider revenue-share reconciliation: providers invoice on THEIR
// reported GGR, so operators must reconcile it daily against internally
// recorded activity. Break rows = disputes to raise with the provider.
function providerGgrRecon(ctx, tolerance = 0.005) {
  return `
    WITH internal AS (
      SELECT
        provider,
        ${require("./dialect").localDate("round_ts", "UTC")} AS statement_date,
        ROUND(SUM(wager - payout), 2) AS internal_ggr
      FROM ${ctx.ref("stg_game_rounds")}
      GROUP BY 1, 2
    ),
    reported AS (
      SELECT provider, statement_date, reported_ggr
      FROM ${ctx.ref("cdc_provider_statements")}
    )
    SELECT
      COALESCE(i.provider, r.provider) AS provider,
      COALESCE(i.statement_date, r.statement_date) AS statement_date,
      i.internal_ggr,
      r.reported_ggr,
      CASE
        WHEN i.provider IS NULL THEN 'statement with no internal activity'
        WHEN r.provider IS NULL THEN 'internal activity with no statement'
        ELSE 'ggr mismatch'
      END AS break_type
    FROM internal i
    FULL OUTER JOIN reported r
      ON i.provider = r.provider AND i.statement_date = r.statement_date
    WHERE i.provider IS NULL OR r.provider IS NULL
       OR ABS(i.internal_ggr - r.reported_ggr) > ${tolerance}
  `;
}

module.exports = { providers, validateProviders, normalisedRounds, providerGgrRecon };
