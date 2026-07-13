// ============================================================================
// CANONICAL TAXONOMY — the internal vocabulary everything maps through.
// Upstream variants map TO this; regulator codes map FROM this.
// Two-hop design means adding upstream feed #4 or regulator #18 never
// touches the other side (no N×M mapping explosion).
// ============================================================================

const canonicalSports = [
  { code: "FOOT", name: "Football" },
  { code: "TENN", name: "Tennis" },
  { code: "HORS", name: "Horse Racing" },
  { code: "BASK", name: "Basketball" },
];

// Gaming domain: canonical game types. MGA buckets these into Types 1-4;
// DGOJ licences each vertical individually — both map FROM this taxonomy.
const canonicalGameTypes = [
  { code: "SLOT", name: "Slots" },
  { code: "ROUL", name: "Roulette" },
  { code: "BLKJ", name: "Blackjack" },
  { code: "BACC", name: "Baccarat / Punto Banco" },
  { code: "POKC", name: "Poker Cash Game" },
  { code: "POKT", name: "Poker Tournament" },
  // Operator-run opt-in jackpot: a game of chance the OPERATOR offers on top
  // of provider games / sports bets. It needs a canonical type so the
  // "phantom game" that carries its wins can be correlated to a regulator
  // vertical — and BLOCKED in markets that don't license it.
  { code: "OJACK", name: "Operator Jackpot" },
];

module.exports = { canonicalSports, canonicalGameTypes };
