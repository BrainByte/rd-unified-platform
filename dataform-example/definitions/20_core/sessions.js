// Session-tracking core models — wiring only, SQL lives in
// includes/models.js (shared with the offline runner in local/run.js).
// Platform sessions are STORED (the login lifecycle is the source of
// truth); per-game sessions are DERIVED from the activity stamped with
// them, so the operator-jackpot shadow session emerges from the same
// GROUP BY that produces the slots session — no OJACK-specific SQL.
// REQ: requirements/session-tracking (REQ-ST-1, REQ-ST-3, REQ-ST-4)
const m = require("includes/models");

publish("fct_platform_sessions", {
  type: "table", schema: "core", tags: ["core", "sessions"],
  description: "One row per platform session (login -> logout/inactivity): the stored lifecycle joined to the aggregates of the gaming activity stamped with it (plays, staked, won, first/last play).",
  bigquery: { partitionBy: "DATE(started_at)" },
  assertions: {
    uniqueKey: ["session_id"],
    nonNull: ["session_id", "account_id", "started_at"],
    rowConditions: [
      // lifecycle invariants — executable spec
      "ended_at IS NULL OR ended_at >= started_at",
      "ended_at IS NULL OR end_reason IS NOT NULL",
      "plays = 0 OR first_play_ts IS NOT NULL",
    ],
  },
}).query((ctx) => m.fctPlatformSessions(ctx));

publish("fct_game_session_activity", {
  type: "table", schema: "core", tags: ["core", "sessions"],
  description: "The pre-aggregation set for the per-game derivation: every session-stamped play with its derived game-session key (platform session x game). The ST-204 single-game invariant is asserted over this set.",
  assertions: {
    uniqueKey: ["activity_id"],
    nonNull: ["activity_id", "session_id", "game_session_id", "game_id"],
  },
}).query((ctx) => m.fctGameSessionActivity(ctx));

publish("fct_game_sessions", {
  type: "table", schema: "core", tags: ["core", "sessions"],
  description: "Derived per-game sessions: one row per (platform session x game) — start = first play of that game, end = last, rounds/rounds_won/staked/won aggregated. Never stored: a regulator changing granularity is a config change.",
  assertions: {
    uniqueKey: ["game_session_id"],
    nonNull: ["game_session_id", "session_id", "account_id", "game_id"],
    rowConditions: [
      "ended_at >= started_at",
      "rounds >= rounds_won",
      "rounds > 0",
    ],
  },
}).query((ctx) => m.fctGameSessions(ctx));
