// Reference tables published FROM the in-repo mapping data.
// Git is the source of truth; BigQuery holds compiled copies.
// A mapping change = data diff in includes/nomenclature/ = full audit trail.
const { canonicalSports } = require("includes/nomenclature/canonical");
const { sportAliases, participantAliases, gameTypeAliases } = require("includes/nomenclature/aliases");
const { jurisdictions } = require("includes/jurisdictions");
const { normalise, rowsToSelect } = require("includes/nomenclature/mapping");
const { codeRows } = require("includes/effective_dating");
const { stakeLimitRows } = require("includes/player_protection");

// Canonical taxonomy.
publish("ref_sport_canonical", { type: "table", schema: "reference", tags: ["reference"] })
  .query(() => rowsToSelect(canonicalSports, ["code", "name"]));

// Upstream alias -> canonical. Aliases stored normalised so the SQL side
// only ever normalises the upstream value (see dim_fixture).
publish("ref_sport_aliases", {
  type: "table", schema: "reference", tags: ["reference"],
  assertions: { uniqueKey: ["alias_norm"] }, // one alias, one meaning
}).query(() =>
  rowsToSelect(
    sportAliases.map((a) => ({ alias_norm: normalise(a.alias), canonical: a.canonical, source: a.source || null })),
    ["alias_norm", "canonical", "source"]
  )
);

publish("ref_participant_aliases", {
  type: "table", schema: "reference", tags: ["reference"],
  assertions: { uniqueKey: ["alias_norm"] },
}).query(() =>
  rowsToSelect(
    participantAliases.map((a) => ({
      alias_norm: normalise(a.alias),
      canonical_id: a.canonicalId,
      canonical_name: a.canonicalName,
    })),
    ["alias_norm", "canonical_id", "canonical_name"]
  )
);

// Canonical -> regulator codes, flattened from jurisdiction config.
// One table, one row per (jurisdiction, canonical_sport).
// Effective-dated: one row per (jurisdiction, canonical_sport, version).
publish("map_sport_regulator", {
  type: "table", schema: "reference", tags: ["reference"],
  assertions: { uniqueKey: ["jurisdiction", "canonical_sport", "valid_from"] },
}).query(() => {
  const rows = [];
  for (const j of Object.values(jurisdictions)) {
    if (!j.nomenclature) continue;
    for (const row of codeRows(j.nomenclature.sportCodes)) {
      rows.push({ jurisdiction: j.code, canonical_sport: row.canonical, regulator_code: row.code, valid_from: row.valid_from, valid_to: row.valid_to });
    }
  }
  return rowsToSelect(rows, ["jurisdiction", "canonical_sport", "regulator_code", "valid_from", "valid_to"]);
});

// ---- gaming domain reference ----
publish("ref_game_type_aliases", {
  type: "table", schema: "reference", tags: ["reference", "gaming"],
  assertions: { uniqueKey: ["alias_norm"] },
}).query(() =>
  rowsToSelect(
    gameTypeAliases.map((a) => ({ alias_norm: normalise(a.alias), canonical: a.canonical, source: a.source || null })),
    ["alias_norm", "canonical", "source"]
  )
);

// Canonical game type -> regulator code (MGA Types / DGOJ singular
// licence verticals), flattened from jurisdiction config.
// Effective-dated: one row per (jurisdiction, canonical_game_type, version).
publish("map_game_regulator", {
  type: "table", schema: "reference", tags: ["reference", "gaming"],
  assertions: { uniqueKey: ["jurisdiction", "canonical_game_type", "valid_from"] },
}).query(() => {
  const rows = [];
  for (const j of Object.values(jurisdictions)) {
    if (!j.gamingNomenclature) continue;
    for (const row of codeRows(j.gamingNomenclature.gameCodes)) {
      rows.push({ jurisdiction: j.code, canonical_game_type: row.canonical, regulator_code: row.code, valid_from: row.valid_from, valid_to: row.valid_to });
    }
  }
  return rowsToSelect(rows, ["jurisdiction", "canonical_game_type", "regulator_code", "valid_from", "valid_to"]);
});

// Statutory online-slots stake caps in force, flattened from jurisdiction
// config — age-banded and effective-dated, so any period's applicable caps
// are queryable. REQ: requirements/max-stake-limits (REQ-MSL-6).
publish("ref_stake_limits", {
  type: "table", schema: "reference", tags: ["reference", "player_protection"],
  assertions: { uniqueKey: ["jurisdiction", "min_age", "valid_from"] },
}).query(() =>
  rowsToSelect(stakeLimitRows(),
    ["jurisdiction", "game_scope", "max_stake", "min_age", "max_age", "valid_from", "valid_to"])
);
