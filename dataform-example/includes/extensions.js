// ============================================================================
// JURISDICTION EXTENSION LAYER  (the "Option B" attribute carrier)
//
// The core model is deliberately NARROW and jurisdiction-agnostic. When a
// regulator needs a datum no other market has, it does NOT get a new column
// on a shared table and it does NOT get a bespoke per-market table. Instead:
//
//   * data-sourced attributes ride in ONE generic carrier — cdc_reg_attributes
//     (entity_type, entity_id, attr_name, attr_value) — staged to
//     stg_reg_attributes and joined in per declared attribute. Adding a new
//     sourced attribute for market #18 = seed rows in the carrier + one
//     registry entry. No DDL on any shared table, ever.
//
//   * computed attributes are pure SQL over columns the core already carries
//     (or config), given a regulator-specific OUTPUT name here — so the same
//     expression (e.g. SHA-256 of the national id) can surface as
//     player_dni_hash / player_egn_hash / player_afm_hash without the global
//     field registry growing a near-duplicate entry per market.
//
// A market opts in via `extensions: [...]` in jurisdictions.js (mirroring
// reportFields). The validator checks every name is known here and treats
// extension columns as part of the file, so declarative rules can target
// them for free. This is the SAME idea the provider adapter layer uses for
// feed-shape variance — variance as config, normalising SQL generated.
// ============================================================================

const dialect = require("./dialect");

// entity_type -> the submission-file key the carrier row joins to.
const ENTITY_KEY = { ACCOUNT: "b.account_id", SLIP: "b.slip_id" };

// GR player-winnings withholding: a progressive, per-slip tiered tax on
// winnings. Bands are DATA (jurisdictions.js winningsTax.brackets), not code,
// so pinning them to the exact AADE decision — or effective-dating them
// (TODO open item #1) — never touches this expression.
function withholdingExpr(j) {
  const wt = j.winningsTax;
  const basis = `b.${wt.basis}`; // e.g. b.payout — the player's winnings
  // Progressive: each band taxes only the slice of the amount inside it.
  const terms = wt.brackets.map((br) => {
    const upper = br.to == null ? basis : `LEAST(${basis}, ${br.to})`;
    return `${br.rate} * GREATEST(0, ${upper} - ${br.from})`;
  });
  return `ROUND(${terms.join(" + ")}, ${j.rounding})`;
}

// Each entry is EITHER carrier-sourced ({ entity, carrier: true }) OR
// computed ({ sql: (j) => expression }). Aliases available to computed
// expressions match the submission FROM clause: b = fct_bet_slip_lifecycle,
// a = dim_customer_account.
const registry = {
  // Denmark (Spillemyndigheden): the TamperToken integrity signature stamped
  // on each SAFE "Standard Record". A per-record provenance token a generic
  // model has no column for — so it rides in the carrier.
  safe_tampertoken: {
    entity: "SLIP",
    carrier: true,
    description:
      "DK: TamperToken integrity signature on the record's SAFE Standard Record (Spillemyndigheden)",
  },

  // Bulgaria (NRA): the control reference returned when each bet is
  // registered in real time on the NRA central system (Decree No. 50/2021).
  nra_registration_id: {
    entity: "SLIP",
    carrier: true,
    description:
      "BG: NRA central-system real-time registration reference, issued per bet (Decree No. 50/2021)",
  },

  // Bulgaria: player identifier = SHA-256 of the EGN unified civil number.
  player_egn_hash: {
    sql: () => dialect.sha256Hex("a.national_id"),
    description: "BG: player identifier — SHA-256 of the EGN (ЕГН) unified civil number",
  },

  // Netherlands (KSA): the mandatory CRUKS self-exclusion check reference —
  // the KSA requires a real-time CRUKS lookup at every login/play, so each
  // session carries its check reference. Carrier-sourced (per slip).
  cruks_check_ref: {
    entity: "SLIP",
    carrier: true,
    description:
      "NL: CRUKS self-exclusion check reference (KSA mandates a check at every login/play)",
  },

  // Netherlands (KSA): the Controledatabank (CDB) near-real-time control
  // record reference the KSA can query per bet. Carrier-sourced (per slip).
  cdb_record_id: {
    entity: "SLIP",
    carrier: true,
    description:
      "NL: Controledatabank (CDB) near-real-time control record reference, per bet",
  },

  // Netherlands: pseudonymised player id = SHA-256 of the BSN. BSN use is
  // statutorily restricted and the CDB stores a pseudonym, so hashing fits.
  player_bsn_hash: {
    sql: () => dialect.sha256Hex("a.national_id"),
    description: "NL: pseudonymised player id — SHA-256 of the BSN (Burgerservicenummer)",
  },

  // Germany (REQ: de-regulator-addition): the cross-operator pseudonym used
  // by the LUGAS activity/limit file, plus the per-bet LUGAS reference.
  player_lugas_pseudonym: {
    sql: () => dialect.sha256Hex("a.national_id"),
    description: "DE: pseudonymised cross-operator player id for the LUGAS file (SHA-256)",
  },

  lugas_activity_id: {
    entity: "SLIP",
    carrier: true,
    description:
      "DE: LUGAS activity-file reference issued per bet (GlüStV cross-operator monitoring)",
  },

  // Greece: player identifier = SHA-256 of the AFM tax registration number.
  player_afm_hash: {
    sql: () => dialect.sha256Hex("a.national_id"),
    description: "GR: player identifier — SHA-256 of the AFM (ΑΦΜ) tax registration number",
  },

  // Greece (HGC/AADE): per-slip progressive withholding tax on player
  // winnings — a computed amount attached to each winning slip that no other
  // market in this repo levies.
  winnings_withholding_tax: {
    sql: (j) => withholdingExpr(j),
    description:
      "GR: per-slip progressive withholding tax on player winnings (HGC/AADE tiered scale)",
  },
};

function knownExtensions() {
  return Object.keys(registry);
}

function extensionEntry(name) {
  const e = registry[name];
  if (!e) {
    throw new Error(
      `Unknown extension attribute '${name}'. Add it to includes/extensions.js.`
    );
  }
  return e;
}

// SELECT fragment: one "expr AS name" per declared extension ("" if none).
function selectExtensionFields(j) {
  return (j.extensions || [])
    .map((name) => {
      const e = extensionEntry(name);
      const expr = e.carrier ? `x_${name}.attr_value` : e.sql(j);
      return `${expr} AS ${name}`;
    })
    .join(",\n      ");
}

// LEFT JOIN fragment for carrier-sourced extensions only ("" if none).
function extensionJoins(ctx, j) {
  return (j.extensions || [])
    .filter((name) => extensionEntry(name).carrier)
    .map((name) => {
      const e = registry[name];
      const alias = `x_${name}`;
      return `LEFT JOIN ${ctx.ref("stg_reg_attributes")} ${alias}
      ON ${alias}.entity_type = '${e.entity}'
      AND ${alias}.entity_id = ${ENTITY_KEY[e.entity]}
      AND ${alias}.attr_name = '${name}'`;
    })
    .join("\n    ");
}

module.exports = { knownExtensions, selectExtensionFields, extensionJoins };
