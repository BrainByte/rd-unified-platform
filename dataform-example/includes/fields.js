// ============================================================================
// FIELD REGISTRY — the only place a submission field's SQL is defined.
// Each entry: (jurisdictionConfig) => SQL expression.
// Aliases: b = fct_bet_slip_lifecycle, a = dim_customer_account.
// ============================================================================

const { renderEventName } = require("./nomenclature/mapping");
const dialect = require("./dialect");

// Aliases: b = fct_bet_slip_lifecycle, a = dim_customer_account,
//          f = dim_fixture, rm = map_sport_regulator (this market's rows).
const registry = {
  slip_id:          () => "b.slip_id",
  account_id:       () => "b.account_id",
  slip_status:      () => "b.slip_status",
  player_dni_hash:  () => dialect.sha256Hex("a.national_id"),
  stake:            (j) => `ROUND(b.stake, ${j.rounding})`,
  payout:           (j) => `ROUND(b.payout, ${j.rounding})`,
  ggr:              (j) => `ROUND(b.stake - b.payout, ${j.rounding})`,
  placed_at_local:  (j) => dialect.localDatetime("b.placed_at", j.timezone),
  settled_at_local: (j) => dialect.localDatetime("b.settled_at", j.timezone),

  // Regulator sport code. Policy is a config decision:
  //   'default' -> unmapped degrade to the regulator's OTHER bucket
  //   'block'   -> stays NULL and the no_unmapped_fixtures rule fails the run
  sport_code: (j) =>
    j.nomenclature.unmappedPolicy === "default"
      ? `COALESCE(rm.regulator_code, '${j.nomenclature.defaultSportCode}')`
      : `rm.regulator_code`,

  // Event name in the regulator's format, from canonicalised participants.
  event_name: (j) => renderEventName(j.nomenclature.eventNameTemplate),
};

// ---------------------------------------------------------------------------
// GAMING registry. Aliases: g = fct_gaming_activity, a = dim_customer_account,
// gm = dim_game, grm = map_game_regulator (this market's rows).
// GGR mechanics differ by vertical (real-world economics):
//   CASINO_ROUND      -> stake - payout (- jackpot contribution, per policy:
//                        the diverted slice funds the ring-fenced pool)
//   POKER_CASH        -> rake only (pot moves between players, not operator)
//   POKER_TOURNAMENT  -> entry fee only (buy-ins fund the prize pool)
// Jackpot WINS are paid from the pool, never from operator GGR — they are
// tracked in fct_jackpot_liability, not here.
const gamingRegistry = {
  activity_id:      () => "g.activity_id",
  account_id:       () => "g.account_id",
  player_dni_hash:  () => dialect.sha256Hex("a.national_id"),
  game_name:        () => "gm.game_name",
  vertical:         () => "g.vertical",
  stake:            (j) => `ROUND(g.stake, ${j.rounding})`,
  payout:           (j) => `ROUND(g.payout, ${j.rounding})`,
  rake_or_fee:      (j) => `ROUND(g.rake_or_fee, ${j.rounding})`,
  occurred_at_local:(j) => dialect.localDatetime("g.occurred_at", j.timezone),

  game_code: (j) =>
    j.gamingNomenclature.unmappedPolicy === "default"
      ? `COALESCE(grm.regulator_code, '${j.gamingNomenclature.defaultGameCode}')`
      : `grm.regulator_code`,

  gaming_ggr: (j) => {
    const casinoGgr =
      j.jackpotPolicy === "deduct_contributions"
        ? `g.stake - g.payout - g.jackpot_contribution`
        : `g.stake - g.payout`;
    // Operator jackpot GGR = contribution (stake) - win (payout), same shape
    // as casino; poker verticals earn rake/fee only (the ELSE branch).
    return `ROUND(CASE WHEN g.vertical = 'CASINO_ROUND' THEN ${casinoGgr} ` +
           `WHEN g.vertical = 'OPERATOR_JACKPOT' THEN g.stake - g.payout ` +
           `ELSE g.rake_or_fee END, ${j.rounding})`;
  },
};

function gamingFieldSql(name, j) {
  const fn = gamingRegistry[name];
  if (!fn) {
    throw new Error(`Unknown gaming field '${name}' (market ${j.code}). Add it to includes/fields.js.`);
  }
  return fn(j);
}

function selectGamingFields(j) {
  return j.gamingReportFields
    .map((f) => `${gamingFieldSql(f, j)} AS ${f}`)
    .join(",\n      ");
}

function knownGamingFields() {
  return Object.keys(gamingRegistry);
}

function fieldSql(name, j) {
  const fn = registry[name];
  if (!fn) {
    throw new Error(
      `Unknown field '${name}' (market ${j.code}). Add it to includes/fields.js.`
    );
  }
  return fn(j);
}

function selectFields(j) {
  return j.reportFields
    .map((f) => `${fieldSql(f, j)} AS ${f}`)
    .join(",\n      ");
}

function knownFields() {
  return Object.keys(registry);
}

module.exports = { fieldSql, selectFields, knownFields, gamingFieldSql, selectGamingFields, knownGamingFields };
