// ============================================================================
// UPSTREAM ALIASES — varied/dirty upstream names -> canonical codes.
// This file GROWS over time: every entry in the unmapped queue
// (definitions/15_reference/unmapped_sports.sqlx) gets resolved by adding
// a row here. That makes feed-quality repair a one-line, reviewable,
// testable data diff — the ideal shape for an AI maintenance loop.
//
// Aliases are matched after normalisation (see mapping.js), so you only
// need one entry per genuinely different spelling, not per casing/space
// variant. `source` is optional documentation of which feed uses it.
// ============================================================================

const sportAliases = [
  { alias: "Soccer",        canonical: "FOOT", source: "feed_a" },
  { alias: "Football",      canonical: "FOOT", source: "feed_b" },
  { alias: "Fútbol",        canonical: "FOOT", source: "feed_es" },
  { alias: "Assoc Football",canonical: "FOOT", source: "legacy_import" },
  { alias: "Tennis",        canonical: "TENN" },
  { alias: "Lawn Tennis",   canonical: "TENN", source: "legacy_import" },
  { alias: "Horse Racing",  canonical: "HORS" },
  { alias: "Horses",        canonical: "HORS", source: "feed_a" },
  { alias: "Basketball",    canonical: "BASK" },
];

// Participants (teams/players) map the same way: dirty display names ->
// one canonical participant. Used to render consistent event names.
const participantAliases = [
  { alias: "Man Utd",               canonicalId: "T-0001", canonicalName: "Manchester United" },
  { alias: "Manchester United FC",  canonicalId: "T-0001", canonicalName: "Manchester United" },
  { alias: "Chelsea FC",            canonicalId: "T-0002", canonicalName: "Chelsea" },
  { alias: "Chelsea",               canonicalId: "T-0002", canonicalName: "Chelsea" },
  { alias: "Real Madrid",           canonicalId: "T-0003", canonicalName: "Real Madrid" },
  { alias: "R Madrid",              canonicalId: "T-0003", canonicalName: "Real Madrid" },
  { alias: "FC Barcelona",          canonicalId: "T-0004", canonicalName: "Barcelona" },
  { alias: "Barça",                 canonicalId: "T-0004", canonicalName: "Barcelona" },
  { alias: "R. Nadal",              canonicalId: "P-0101", canonicalName: "Rafael Nadal" },
  { alias: "N. Djokovic",           canonicalId: "P-0102", canonicalName: "Novak Djokovic" },
];

// Game-type names as they actually arrive from provider feeds
// (NetEnt, Evolution, Pragmatic Play etc. each label categories differently).
const gameTypeAliases = [
  { alias: "Video Slots",              canonical: "SLOT", source: "netent" },
  { alias: "Slots",                    canonical: "SLOT" },
  { alias: "Slot",                     canonical: "SLOT", source: "pragmatic" },
  { alias: "Live Roulette",            canonical: "ROUL", source: "evolution" },
  { alias: "Roulette",                 canonical: "ROUL" },
  { alias: "Table Games - Blackjack",  canonical: "BLKJ", source: "netent" },
  { alias: "Blackjack",                canonical: "BLKJ" },
  { alias: "Baccarat",                 canonical: "BACC" },
  { alias: "Punto Banco",              canonical: "BACC", source: "evolution" },
  { alias: "Poker - Cash",             canonical: "POKC", source: "poker_platform" },
  { alias: "Poker Tournament",         canonical: "POKT", source: "poker_platform" },
  { alias: "Operator Jackpot",         canonical: "OJACK", source: "operator" }, // phantom game
];

module.exports = { sportAliases, participantAliases, gameTypeAliases };
