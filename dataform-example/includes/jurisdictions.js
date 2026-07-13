// ============================================================================
// SINGLE SOURCE OF TRUTH for per-market regulatory variance.
// RULE: market differences live HERE as data — never in SQL.
//
// `rules` are declarative regulatory constraints. They compile to Dataform
// assertions via includes/rules.js. Rule ids are the regulator's clause
// reference where one exists — that's your audit trail.
// ============================================================================

// Rules every market must satisfy, regardless of local regulation.
const commonRules = [
  { id: "COM-001", type: "not_null", field: "slip_id", description: "Every row identifies a bet slip" },
  { id: "COM-002", type: "not_null", field: "report_date", description: "Every row has a reporting date" },
  { id: "COM-003", type: "non_negative", field: "stake", description: "Stake can never be negative" },
  { id: "COM-004", type: "non_negative", field: "payout", description: "Payout can never be negative" },
  { id: "COM-005", type: "unique", field: "slip_id", description: "One row per slip per file" },
];

// Rules every market's GAMING file must satisfy.
const commonGamingRules = [
  { id: "G-COM-001", type: "not_null", field: "activity_id", description: "Every gaming row identifies an activity" },
  { id: "G-COM-002", type: "non_negative", field: "stake", description: "Stake can never be negative" },
  { id: "G-COM-003", type: "non_negative", field: "rake_or_fee", description: "Rake/fee can never be negative" },
  { id: "G-COM-004", type: "unique", field: "activity_id", description: "One row per activity per file" },
  { id: "G-COM-005", type: "zero_when", field: "rake_or_fee", whenField: "vertical", equals: "CASINO_ROUND",
    description: "House games generate GGR from stake minus payout, never rake" },
];

const jurisdictions = {
  MT: {
    code: "MT",
    dataset: "reporting_mt",
    currency: "EUR",
    rounding: 2,
    timezone: "Europe/Malta",
    // Address data-quality validation (variance as data): each market's
    // postcode format differs. A row that fails this is a DATA exception
    // (quarantine); requireRegion adds a reference lookup whose absence is a
    // TRANSIENT exception (the region table may just be late).
    addressValidation: { postcodePattern: "^[A-Z]{3} [0-9]{4}$", requireRegion: true },
    submissionCadence: "daily",
    includeVoided: true, // voids reported with status column
    taxModel: "ggr",
    taxRate: 0.05,
    reportFields: [
      "slip_id", "account_id", "slip_status",
      "stake", "payout", "ggr",
      "sport_code", "event_name",
      "placed_at_local", "settled_at_local",
    ],
    // Regulator nomenclature: canonical code -> MGA code.
    // MT accepts an OTHER bucket, so unmapped sports degrade gracefully.
    nomenclature: {
      sportCodes: { FOOT: "01", TENN: "02", HORS: "03", BASK: "04" },
      unmappedPolicy: "default",   // unmapped -> defaultSportCode
      defaultSportCode: "99",      // MGA 'Other'
      eventNameTemplate: "{home} v {away}",
    },
    rules: [
      { id: "MT-101", type: "in_set", field: "slip_status", values: ["SETTLED", "VOIDED"],
        description: "MGA daily file contains settled and voided slips only" },
      { id: "MT-104", type: "valid_sport_code",
        description: "Sport code must be an MGA code from the published nomenclature" },
      { id: "MT-102", type: "max_value", field: "stake", value: 50000,
        description: "Stakes above EUR 50k indicate a data error; block the file" },
      { id: "MT-103", type: "zero_when", field: "payout", whenField: "slip_status", equals: "VOIDED",
        description: "Voided slips must report zero payout" },
    ],

    // ---- GAMING domain (casino / poker / jackpots) ----
    // MGA classifies games into Types: Type 1 = games of chance against
    // the house (slots, table games, live casino); Type 3 = commission-
    // based player-vs-player (poker rake, tournament fees). The MGA has
    // discretion to categorise edge cases, so unmapped types degrade to
    // Type 1 (the against-the-house catch-all). Gaming tax: 5% of GGR.
    gamingNomenclature: {
      // Operator jackpot (OJACK) is licensed under MGA Type 1 (against-the-
      // house games) — so the operator CAN offer it here and its wins
      // correlate to Type 1. ES holds no matching licence, so it is absent
      // from the ES map and the pipeline blocks it there (no_unlicensed_games).
      gameCodes: { SLOT: "1", ROUL: "1", BLKJ: "1", BACC: "1", POKC: "3", POKT: "3", OJACK: "1" },
      unmappedPolicy: "default",
      defaultGameCode: "1",
    },
    gamingTaxRate: 0.05,
    // Progressive jackpot contributions are diverted from each wager to a
    // ring-fenced pool, reducing base-game GGR (operator economics; exact
    // tax deductibility is a per-regulator decision — configurable here).
    jackpotPolicy: "deduct_contributions",
    gamingReportFields: [
      "activity_id", "account_id", "game_code", "game_name", "vertical",
      "stake", "payout", "rake_or_fee", "gaming_ggr", "occurred_at_local",
    ],
    gamingRules: [
      { id: "MT-201", type: "valid_game_code",
        description: "Game code must be an MGA game type (1/3, incl. default bucket)" },
    ],
    // ---- PLAYER PROTECTION & PAYMENTS ----
    // Malta: no statutory default deposit limits — limits are player-set
    // (MGA player-protection directives require offering them). Self-
    // exclusion is operator-level. KYC before withdrawal.
    playerProtection: {
      defaultDepositLimits: null,           // player-set only
      selfExclusionSources: ["OPERATOR"],
      withdrawalRequiresVerification: true,
      // REQ: requirements/max-stake-limits (REQ-MSL-1) — statutory online-
      // slots stake caps, UKGC-modelled: age-banded and effective-dated
      // (each band arms on its own date, like the 9 Apr / 21 May 2025
      // staggered rollout). Applies to SLOT games only; effective cap for a
      // stake = least applicable band (null-safe) min the player's personal
      // STAKE_CASINO limit. Values illustrative pending local legal review.
      slotsStakeLimits: [
        { maxStake: 5.00, minAge: 18, from: "2026-08-01" },             // all adults
        { maxStake: 2.00, minAge: 18, maxAge: 24, from: "2026-09-15" }, // young adults
      ],
    },
  },

  ES: {
    code: "ES",
    dataset: "reporting_es",
    currency: "EUR",
    rounding: 2,
    timezone: "Europe/Madrid",
    addressValidation: { postcodePattern: "^[0-9]{5}$" },
    submissionCadence: "daily",
    includeVoided: false, // voids never appear in the file
    taxModel: "ggr",
    taxRate: 0.2,
    reportFields: [
      "slip_id", "player_dni_hash",
      "stake", "payout",
      "sport_code", "event_name",
      "placed_at_local", "settled_at_local",
    ],
    // DGOJ publishes a closed code list with NO 'other' bucket, and only
    // licensed verticals may appear — so unmapped sports BLOCK the file.
    nomenclature: {
      sportCodes: { FOOT: "FUT", TENN: "TEN", BASK: "BAL" }, // no horse racing licence
      unmappedPolicy: "block",     // unmapped -> pipeline fails, row never ships
      defaultSportCode: null,
      eventNameTemplate: "{home} - {away}",
    },
    rules: [
      { id: "ES-101", type: "no_voided_slips",
        description: "DGOJ file must never contain a voided slip (checked against lifecycle)" },
      { id: "ES-103", type: "no_unmapped_fixtures",
        description: "Every slip in the file must resolve to a DGOJ sport code (closed list, no OTHER)" },
      { id: "ES-104", type: "valid_sport_code",
        description: "Sport code must be a DGOJ code from the published nomenclature" },
      { id: "ES-102", type: "matches", field: "player_dni_hash", pattern: "^[0-9a-f]{64}$",
        description: "Player identifier must be a lowercase SHA-256 hex digest" },
    ],

    // ---- GAMING domain ----
    // DGOJ licenses each vertical singularly ("licencias singulares"):
    // Máquinas de azar (slots), Ruleta, Blackjack, Póquer... A vertical
    // without a licence CANNOT be offered — this operator (like many real
    // ones) holds NO Punto y Banca licence, so baccarat and anything
    // unmapped must BLOCK the file, never degrade. Tax: 20% of GGR
    // (poker GGR = rake + tournament fees).
    gamingNomenclature: {
      gameCodes: { SLOT: "MAZ", ROUL: "RLT", BLKJ: "BLJ", POKC: "POC", POKT: "POT" },
      unmappedPolicy: "block",
      defaultGameCode: null,
    },
    gamingTaxRate: 0.2,
    jackpotPolicy: "gross", // contributions not deducted from GGR
    gamingReportFields: [
      "activity_id", "player_dni_hash", "game_code", "game_name", "vertical",
      "stake", "payout", "rake_or_fee", "gaming_ggr", "occurred_at_local",
    ],
    gamingRules: [
      { id: "ES-201", type: "no_unlicensed_games",
        description: "Every activity must map to a DGOJ-licensed vertical (no Punto y Banca licence held)" },
      { id: "ES-202", type: "valid_game_code",
        description: "Game code must be a held DGOJ singular-licence code" },
    ],
    // ---- PLAYER PROTECTION & PAYMENTS ----
    // Spain: RD 1614/2011 Art. 36 statutory DEFAULT deposit limits
    // (600/1500/3000 EUR day/week/month); the RGIAJ national self-
    // exclusion register is mandatory to honour — activity by an
    // RGIAJ-registered player is a breach of national law. KYC before
    // withdrawal. (Joint cross-operator limits 700/1750/3300 are in a
    // draft Royal Decree — see TODO.md backlog.)
    playerProtection: {
      defaultDepositLimits: { daily: 600, weekly: 1500, monthly: 3000 },
      selfExclusionSources: ["OPERATOR", "RGIAJ"],
      mandatoryRegister: "RGIAJ", // national register the operator MUST honour
      withdrawalRequiresVerification: true,
      // REQ: requirements/max-stake-limits (REQ-MSL-1) — flat cap, no bands.
      slotsStakeLimits: [{ maxStake: 10.00, minAge: 18, from: "2026-08-01" }],
    },
  },

  // ==========================================================================
  // DENMARK — Spillemyndigheden (Danish Gambling Authority), Act on Gambling.
  // Betting-domain example (no gaming config) proving a market can adopt a
  // subset of domains. Sourced from real 2025-26 guidelines: 28% GGR tax
  // (raised from 20% in 2021), monthly; MitID/CPR identity; ROFUS national
  // self-exclusion (mandatory real-time check); player-set deposit limits
  // (no statutory default amount). Sport codes are illustrative.
  // ==========================================================================
  DK: {
    code: "DK",
    dataset: "reporting_dk",
    currency: "DKK",
    rounding: 2,
    timezone: "Europe/Copenhagen",
    addressValidation: { postcodePattern: "^[0-9]{4}$" },
    submissionCadence: "monthly",
    includeVoided: true, // reported with a status column
    taxModel: "ggr",
    taxRate: 0.28,
    reportFields: [
      "slip_id", "account_id", "slip_status",
      "stake", "payout", "ggr",
      "sport_code", "event_name",
      "placed_at_local", "settled_at_local",
    ],
    // Spillemyndigheden requires the TamperToken signature on each SAFE
    // Standard Record — a per-record datum with no home in the core model,
    // so it rides in the generic attribute carrier (see includes/extensions.js).
    extensions: ["safe_tampertoken"],
    nomenclature: {
      sportCodes: { FOOT: "1", TENN: "2", BASK: "3" },
      unmappedPolicy: "default",
      defaultSportCode: "9", // catch-all category
      eventNameTemplate: "{home} - {away}",
    },
    rules: [
      { id: "DK-101", type: "in_set", field: "slip_status", values: ["SETTLED", "VOIDED"],
        description: "Danish monthly file contains settled and voided slips only" },
      { id: "DK-104", type: "valid_sport_code",
        description: "Sport code must be a Spillemyndigheden category code" },
      { id: "DK-201", type: "not_null", field: "safe_tampertoken",
        description: "Every SAFE Standard Record must carry a TamperToken signature" },
      { id: "DK-202", type: "matches", field: "safe_tampertoken", pattern: "^TT-[0-9A-F]{8}$",
        description: "TamperToken signature must be the prescribed TT-<hex8> format" },
    ],
    playerProtection: {
      defaultDepositLimits: null, // player-set; DK mandates setting one, no fixed amount
      selfExclusionSources: ["OPERATOR", "ROFUS"],
      mandatoryRegister: "ROFUS", // Register Over Frivilligt Udelukkede Spillere
      withdrawalRequiresVerification: true,
      // REQ: requirements/max-stake-limits (REQ-MSL-1) — flat cap, no bands.
      slotsStakeLimits: [{ maxStake: 7.50, minAge: 18, from: "2026-08-01" }],
    },
  },

  // ==========================================================================
  // BULGARIA — National Revenue Agency (НАП/NRA), Gambling Act. Supervision
  // moved from the State Commission on Gambling to the NRA in Aug 2020.
  // GGR tax 20% -> 25% from 1 Jan 2026 (rate below reflects the 2026 value;
  // effective-dating is TODO open item #1). EGN civil-number identity;
  // NRA national self-exclusion register (mandatory, min 1 year since 2025);
  // player-set deposit limits. Closed sport list (block policy). Codes
  // illustrative. Defining feature: real-time per-bet registration on the
  // NRA central system (Decree No. 50/2021) -> nra_registration_id extension.
  // ==========================================================================
  BG: {
    code: "BG",
    dataset: "reporting_bg",
    currency: "BGN",
    rounding: 2,
    timezone: "Europe/Sofia",
    addressValidation: { postcodePattern: "^[0-9]{4}$" },
    submissionCadence: "monthly",
    includeVoided: false,
    taxModel: "ggr",
    // Effective-dated: GGR tax 20% up to 2026, 25% from 1 Jan 2026. A
    // resubmission of a 2025 period reproduces the 20% rate.
    taxRate: [
      { rate: 0.20, to: "2026-01-01" },
      { rate: 0.25, from: "2026-01-01" },
    ],
    reportFields: [
      "slip_id",
      "stake", "payout",
      "sport_code", "event_name",
      "placed_at_local", "settled_at_local",
    ],
    extensions: ["player_egn_hash", "nra_registration_id"],
    nomenclature: {
      // NRA revised the football code from FUT to FTB effective 2026;
      // historical resubmissions must reproduce FUT.
      sportCodes: {
        FOOT: [{ code: "FUT", to: "2026-01-01" }, { code: "FTB", from: "2026-01-01" }],
        TENN: "TEN",
        BASK: "BKB",
      },
      unmappedPolicy: "block", // closed list; no OTHER bucket
      defaultSportCode: null,
      eventNameTemplate: "{home} - {away}",
    },
    rules: [
      { id: "BG-101", type: "no_unmapped_fixtures",
        description: "Every slip must resolve to an NRA sport code (closed list)" },
      { id: "BG-104", type: "valid_sport_code",
        description: "Sport code must be an NRA-published code" },
      { id: "BG-201", type: "not_null", field: "nra_registration_id",
        description: "Every bet must carry its NRA central-system registration reference" },
      { id: "BG-202", type: "matches", field: "nra_registration_id", pattern: "^BG-[0-9]{4}-[0-9]{9}$",
        description: "NRA registration reference must match the mandated BG-YYYY-<9 digit> format" },
      { id: "BG-203", type: "matches", field: "player_egn_hash", pattern: "^[0-9a-f]{64}$",
        description: "Player identifier must be a lowercase SHA-256 of the EGN" },
    ],
    playerProtection: {
      defaultDepositLimits: null, // player-set (statutory caps proposed, not yet law)
      selfExclusionSources: ["OPERATOR", "NRA_NSE"],
      mandatoryRegister: "NRA_NSE", // NRA national self-exclusion register
      withdrawalRequiresVerification: true,
    },
  },

  // ==========================================================================
  // GREECE — Hellenic Gaming Commission (Ε.Ε.Ε.Π./HGC), Law 4002/2011 as
  // amended by 4635/2019. Operator GGR tax 35% (Type 1 betting), monthly.
  // AFM tax-id identity. Standout requirement: a PER-SLIP progressive
  // withholding tax on player winnings (HGC/AADE tiered scale) — a computed
  // amount no other market levies, modelled as a config-driven extension.
  // National self-exclusion register status is unconfirmed in the research
  // (consultation stage) so no mandatoryRegister is asserted here. Codes and
  // withholding bands illustrative — pin to the AADE decision (TODO #1).
  // ==========================================================================
  GR: {
    code: "GR",
    dataset: "reporting_gr",
    currency: "EUR",
    rounding: 2,
    timezone: "Europe/Athens",
    addressValidation: { postcodePattern: "^[0-9]{3} [0-9]{2}$" },
    submissionCadence: "monthly",
    includeVoided: false,
    taxModel: "ggr",
    taxRate: 0.35,
    reportFields: [
      "slip_id",
      "stake", "payout",
      "sport_code", "event_name",
      "placed_at_local", "settled_at_local",
    ],
    extensions: ["player_afm_hash", "winnings_withholding_tax"],
    // Player-winnings withholding bands (per slip, on winnings). DATA, not
    // code — the extension expression is generated from these, so pinning to
    // the exact AADE decision or effective-dating them stays config-only.
    winningsTax: {
      basis: "payout",
      brackets: [
        { from: 100, to: 200, rate: 0.025 },
        { from: 200, to: 500, rate: 0.05 },
        { from: 500, to: null, rate: 0.075 },
      ],
    },
    nomenclature: {
      sportCodes: { FOOT: "FTB", TENN: "TNS", BASK: "BSK" },
      unmappedPolicy: "default",
      defaultSportCode: "OTH",
      eventNameTemplate: "{home} v {away}",
    },
    rules: [
      { id: "GR-101", type: "valid_sport_code",
        description: "Sport code must be an HGC-published code" },
      { id: "GR-201", type: "non_negative", field: "winnings_withholding_tax",
        description: "Withheld player-winnings tax can never be negative" },
      { id: "GR-202", type: "matches", field: "player_afm_hash", pattern: "^[0-9a-f]{64}$",
        description: "Player identifier must be a lowercase SHA-256 of the AFM" },
    ],
    playerProtection: {
      defaultDepositLimits: null, // player-set (mandatory to set; no fixed cap)
      selfExclusionSources: ["OPERATOR"],
      withdrawalRequiresVerification: true,
    },
  },

  // ==========================================================================
  // NETHERLANDS — Kansspelautoriteit (KSA), Wet kansspelen op afstand ("Koa"
  // Act, in force 1 Oct 2021). Single unified remote licence (betting +
  // casino). Real 2025-26 guidelines: kansspelbelasting on GGR, monthly, and
  // it steps UP over time — 30.5% (2024) -> 34.2% (2025) -> 37.8% (from 1 Jan
  // 2026), the value used here (effective-dating is TODO open item #1). Two
  // NL-unique structural controls drive extensions: CRUKS (central self-
  // exclusion register, mandatory real-time check at every login/play) and
  // the CDB / Controledatabank (near-real-time control records the KSA
  // queries per bet). Player id is a pseudonymised BSN. Codes illustrative.
  // ==========================================================================
  NL: {
    code: "NL",
    dataset: "reporting_nl",
    currency: "EUR",
    rounding: 2,
    timezone: "Europe/Amsterdam",
    addressValidation: { postcodePattern: "^[0-9]{4} [A-Z]{2}$" },
    submissionCadence: "monthly",
    includeVoided: false,
    taxModel: "ggr",
    // Effective-dated kansspelbelasting: 34.2% in 2025, 37.8% from 1 Jan 2026.
    taxRate: [
      { rate: 0.342, to: "2026-01-01" },
      { rate: 0.378, from: "2026-01-01" },
    ],
    reportFields: [
      "slip_id",
      "stake", "payout",
      "sport_code", "event_name",
      "placed_at_local", "settled_at_local",
    ],
    // Two carrier-sourced controls (CRUKS check + CDB record) plus the
    // pseudonymised BSN — all via the extension layer, core model untouched.
    extensions: ["player_bsn_hash", "cruks_check_ref", "cdb_record_id"],
    nomenclature: {
      sportCodes: { FOOT: "VB", TENN: "TN", BASK: "BB" }, // VB = voetbal
      unmappedPolicy: "default",
      defaultSportCode: "OV", // overig / other
      eventNameTemplate: "{home} - {away}",
    },
    rules: [
      { id: "NL-101", type: "valid_sport_code",
        description: "Sport code must be a KSA-published code" },
      { id: "NL-201", type: "not_null", field: "cdb_record_id",
        description: "Every bet must have a Controledatabank (CDB) control record reference" },
      { id: "NL-202", type: "matches", field: "cdb_record_id", pattern: "^NL-CDB-[0-9]{10}$",
        description: "CDB record reference must match the mandated NL-CDB-<10 digit> format" },
      { id: "NL-203", type: "not_null", field: "cruks_check_ref",
        description: "Every session must record its mandatory CRUKS self-exclusion check" },
      { id: "NL-204", type: "matches", field: "cruks_check_ref", pattern: "^CRUKS-[0-9A-F]{8}$",
        description: "CRUKS check reference must be the prescribed CRUKS-<hex8> format" },
      { id: "NL-205", type: "matches", field: "player_bsn_hash", pattern: "^[0-9a-f]{64}$",
        description: "Player identifier must be a lowercase SHA-256 of the BSN" },
    ],
    playerProtection: {
      // Player-set here. NL's Oct-2024 zorgplicht adds age-banded MONTHLY
      // defaults (EUR 350 for 25+, EUR 150 for 18-24) and affordability
      // triggers above EUR 700 / EUR 300 — modelling age bands is future
      // work, so no statutory default is asserted yet (relates to TODO #1).
      defaultDepositLimits: null,
      selfExclusionSources: ["OPERATOR", "CRUKS"],
      mandatoryRegister: "CRUKS", // Centraal Register Uitsluiting Kansspelen
      withdrawalRequiresVerification: true,
      // REQ: requirements/max-stake-limits (REQ-MSL-1) — flat cap, no bands.
      slotsStakeLimits: [{ maxStake: 5.00, minAge: 18, from: "2026-08-01" }],
    },
  },

  // ==========================================================================
  // GERMANY — Gemeinsame Glücksspielbehörde der Länder (GGL), under the
  // Glücksspielstaatsvertrag 2021 (GlüStV). Researched July 2026. The market
  // that stretches the config model furthest:
  //   - TAX ON TURNOVER, not GGR: 5.3% of STAKES (RennwLottG) for sports
  //     betting / virtual slots / online poker — taxModel 'turnover'.
  //   - LUGAS: the cross-operator activity & limit file — enforces the
  //     EUR 1,000/month cross-operator deposit limit (monthly-ONLY: the
  //     per-period-null defaultDepositLimits case), one-account login and
  //     exclusion checks; every bet carries a LUGAS activity reference.
  //   - OASIS: the national self-exclusion register (mandatory).
  //   - Slot stake caps, GRADUATED from 1 Jul 2026: EUR 1 flat since 2021
  //     -> EUR 1 for 18-20 / EUR 3 for 21+ (the EUR 5 clean-90-days tier
  //     needs a behavioural flag — out of scope, noted). Real dates.
  //   - Restrictive licensing -> closed sport list (block unmapped).
  //   Player id: pseudonymised (SHA-256) for the cross-operator file.
  //   Codes/formats illustrative — pin against GGL technical specs.
  // ==========================================================================
  DE: {
    code: "DE",
    dataset: "reporting_de",
    currency: "EUR",
    rounding: 2,
    timezone: "Europe/Berlin",
    addressValidation: { postcodePattern: "^[0-9]{5}$" }, // 5-digit PLZ
    submissionCadence: "monthly", // monthly Steueranmeldung
    includeVoided: false,         // voided stakes are refunded, not taxed
    // THE GERMAN DIFFERENCE: tax base is STAKES (turnover), not GGR.
    taxModel: "turnover",
    taxRate: 0.053,               // 5.3% of stakes (RennwLottG)
    reportFields: [
      "slip_id",
      "stake", "payout",
      "sport_code", "event_name",
      "placed_at_local", "settled_at_local",
    ],
    // Pseudonymised player id + the per-bet LUGAS activity reference — both
    // via the extension layer, core model untouched.
    extensions: ["player_lugas_pseudonym", "lugas_activity_id"],
    nomenclature: {
      sportCodes: { FOOT: "FUSS", TENN: "TEN", BASK: "BKB" },
      unmappedPolicy: "block",    // restrictive licensing: no catch-all bucket
      eventNameTemplate: "{home} - {away}",
    },
    rules: [
      { id: "DE-101", type: "no_voided_slips",
        description: "Voided bets are refunded and never taxed — none may reach the GGL file" },
      { id: "DE-102", type: "valid_sport_code",
        description: "Sport code must be a GGL-licensed code (closed list)" },
      { id: "DE-103", type: "no_unmapped_fixtures",
        description: "Unlicensed sport = unlicensed offering; block the pipeline" },
      { id: "DE-104", type: "matches", field: "player_lugas_pseudonym", pattern: "^[0-9a-f]{64}$",
        description: "Player identifier must be the pseudonymised (SHA-256) cross-operator id" },
      { id: "DE-201", type: "not_null", field: "lugas_activity_id",
        description: "Every bet must carry its LUGAS activity-file reference" },
      { id: "DE-202", type: "matches", field: "lugas_activity_id", pattern: "^LUGAS-[0-9A-F]{12}$",
        description: "LUGAS reference must match the mandated LUGAS-<hex12> format" },
    ],
    playerProtection: {
      // LUGAS cross-operator limit: EUR 1,000 per MONTH — and only per
      // month (daily/weekly nulls exercise per-period statutory defaults).
      defaultDepositLimits: { daily: null, weekly: null, monthly: 1000 },
      selfExclusionSources: ["OPERATOR", "OASIS"],
      mandatoryRegister: "OASIS", // Spielersperrsystem OASIS
      withdrawalRequiresVerification: true,
      // REQ: requirements/max-stake-limits — Germany's REAL graduated caps:
      // EUR 1 flat from GlüStV 2021 until 30 Jun 2026, then EUR 1 for
      // 18-20 and EUR 3 for 21+ from 1 Jul 2026. (The EUR 5 tier for
      // players with a clean 90-day assessment needs a behavioural flag —
      // future work.)
      slotsStakeLimits: [
        { maxStake: 1.00, minAge: 18, from: "2021-07-01", to: "2026-07-01" },
        { maxStake: 1.00, minAge: 18, maxAge: 20, from: "2026-07-01" },
        { maxStake: 3.00, minAge: 21, from: "2026-07-01" },
      ],
    },
  },
};

module.exports = { jurisdictions, commonRules, commonGamingRules };
