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

// Rules every market's PERIODIC REGISTER files must satisfy. Registers are
// aggregate-grained (one row per player per period), so only the columns
// every register carries may appear here.
// REQ: requirements/dgoj-periodic-reporting (REQ-DGOJ-3, REQ-DGOJ-4)
const commonPeriodicRules = [
  { id: "P-COM-001", type: "not_null", field: "player_ref", description: "Every register row identifies a player" },
  { id: "P-COM-002", type: "not_null", field: "period_start", description: "Every register row has a reporting period" },
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
    // ---- PERIODIC REGISTERS (DGOJ monitoring-system data model) ----
    // The Modelo de datos (BOE-A-2024-12639) files registers at different
    // cadences: a daily detailed user register (RUD-style) and a monthly
    // totalized one (RUT-style). Which registers, cadence, fields and rules
    // are DATA — any market can adopt registers by adding this key.
    // REQ: requirements/dgoj-periodic-reporting (REQ-DGOJ-1, REQ-DGOJ-2, REQ-DGOJ-4)
    periodicReports: [
      {
        id: "RUD", cadence: "daily", playerField: "player_dni_hash",
        fields: ["bets_settled", "stake_sum", "winnings_sum", "ggr_sum"],
        rules: [
          { id: "ES-RUD-101", type: "matches", field: "player_ref", pattern: "^[0-9a-f]{64}$",
            description: "Register identifies the player by lowercase SHA-256 DNI digest" },
          { id: "ES-RUD-102", type: "non_negative", field: "stake_sum",
            description: "A day's totalised stakes can never be negative" },
        ],
      },
      {
        id: "RUT", cadence: "monthly", playerField: "player_dni_hash",
        fields: ["bets_settled", "stake_sum", "winnings_sum", "ggr_sum"],
        rules: [
          { id: "ES-RUT-101", type: "matches", field: "player_ref", pattern: "^[0-9a-f]{64}$",
            description: "Register identifies the player by lowercase SHA-256 DNI digest" },
          { id: "ES-RUT-102", type: "non_negative", field: "stake_sum",
            description: "A month's totalised stakes can never be negative" },
        ],
      },
    ],
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
    // ---- SESSION REPORTING (REQ: requirements/session-tracking, REQ-ST-2/7) ----
    // The Netherlands defines sessions PER GAME: the CDB WOK_Game_Session
    // carries exactly one Game_ID, and the kansspelbelasting (KSB) GAT report
    // needs the same single-game basis — so game sessions are DERIVED from
    // the stored platform session plus the activity stamped with it
    // (REQ-ST-3), and the operator-jackpot shadow session emerges from that
    // derivation because OJ1 contributions are stamped gaming activity of
    // their own game (REQ-ST-4). Timeout minutes are config, not code.
    sessionReporting: {
      granularity: "per_game",          // platform | per_game
      timeoutMinutes: 30,               // inactivity disconnect
      endReasons: ["LOGOUT", "INACTIVITY"],
      reportEmptySessions: false,       // a login with no play is not reported
      rules: [
        { id: "ST-201", type: "activity_within_session",
          description: "Every session-stamped play must fall inside its platform session's [start, end] window" },
        { id: "ST-202", type: "single_open_session",
          description: "At most one open platform session per player (Koa concurrent-login policy)" },
        { id: "ST-203", type: "end_reason_in_set",
          description: "Session end reason must come from the configured vocabulary (LOGOUT/INACTIVITY)" },
        { id: "ST-204", type: "single_game_session",
          description: "THE CDB/GAT invariant: no derived game session may aggregate more than one game" },
      ],
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

  // ==========================================================================
  // FRANCE — Autorité Nationale des Jeux (ANJ), loi n° 2010-476 du 12 mai
  // 2010 (ANJ replaced ARJEL in 2020, ordonnance 2019-1015). The EIGHTH
  // market. Licensable online verticals: sports betting (PASP), horse-race
  // betting (PAHI — a separate licence this operator does NOT hold, so no
  // HORS mapping) and poker (PO); ONLINE CASINO IS NOT LICENSED in France —
  // the whole casino vertical is blocked, the ES no_unlicensed_games
  // precedent inverted. The reporting regime is an EVENT LOG: one XML trace
  // per player action into a sealed local vault (coffre-fort) the regulator
  // INSPECTS rather than receives — so voids (ANNUL) are first-class traces
  // (includeVoided) and the player is identified by CLEAR operator account
  // id inside the sealed vault (no pseudonymisation). Levy rates, sport
  // labels and poker codes are ILLUSTRATIVE — pin to the loi 2010-476 levy
  // articles and the ANJ authorised-competitions decisions before
  // production. REQ: requirements/fr-new-jurisdiction (REQ-FR-1/2/3/7)
  // ==========================================================================
  FR: {
    code: "FR",
    dataset: "reporting_fr",
    currency: "EUR",
    rounding: 2,
    timezone: "Europe/Paris",
    addressValidation: { postcodePattern: "^[0-9]{5}$" }, // 5-digit code postal
    submissionCadence: "daily",
    includeVoided: true, // ANNUL traces are first-class events in the vault
    taxModel: "ggr",
    // Sports-betting levy on GGR (the produit brut des jeux): effective-dated
    // like BG/NL — 54.9% to 30 Jun 2025, 59.3% from 1 Jul 2025 (LFSS 2025
    // uplift). ILLUSTRATIVE — pin to the primary levy articles before use.
    taxRate: [
      { rate: 0.549, to: "2025-07-01" },
      { rate: 0.593, from: "2025-07-01" },
    ],
    reportFields: [
      "slip_id", "account_id", "slip_status",
      "stake", "payout", "ggr",
      "sport_code", "event_name",
      "placed_at_local", "settled_at_local",
    ],
    // ANJ authorises competitions and bet types per sport — a CLOSED list
    // with no OTHER bucket, so unmapped sports BLOCK the file. Horse racing
    // is the separate PAHI licence (not held), hence no HORS entry.
    nomenclature: {
      sportCodes: { FOOT: "FOOTBALL", TENN: "TENNIS", BASK: "BASKETBALL" },
      unmappedPolicy: "block",
      defaultSportCode: null,
      eventNameTemplate: "{home} - {away}",
    },
    rules: [
      { id: "FR-101", type: "in_set", field: "slip_status", values: ["SETTLED", "VOIDED"],
        description: "loi 2010-476: vault traces cover settled (GAIN) and voided (ANNUL) bets only — open bets have no terminal trace" },
      { id: "FR-102", type: "zero_when", field: "payout", whenField: "slip_status", equals: "VOIDED",
        description: "loi 2010-476: an ANNUL trace refunds the stake — a voided bet must report zero payout" },
      { id: "FR-103", type: "no_unmapped_fixtures",
        description: "loi 2010-476 art. 12: only ANJ-authorised competitions may be offered — an unmapped sport blocks the file" },
      { id: "FR-104", type: "valid_sport_code",
        description: "Sport code must be on the ANJ authorised-competitions list (closed, no OTHER bucket)" },
      { id: "FR-105", type: "max_value", field: "stake", value: 50000,
        description: "Stakes above EUR 50k indicate a data error; block the file" },
    ],

    // ---- GAMING domain: poker licensed, casino NOT (REQ-FR-2/3) ----
    // loi 2010-476 art. 14 licenses online poker ("jeux de cercle") ONLY;
    // slots/roulette/blackjack/baccarat and the operator jackpot have no
    // French licence, so they are absent from the map and unmappedPolicy
    // 'block' + no_unlicensed_games keeps them out of every FR file.
    gamingNomenclature: {
      gameCodes: { POKC: "PO-CG", POKT: "PO-TR" }, // cash game / tournoi
      unmappedPolicy: "block",
      defaultGameCode: null,
    },
    // NOTE: the true French poker levy is STAKES-based (a fraction of the
    // mises/pot), not GGR-based — when the rate is pinned to the primary
    // sources this should reuse the DE 'turnover' mechanics via a gaming
    // taxModel arm rather than new machinery. GGR basis kept here with an
    // illustrative rate until legal pinning.
    gamingTaxRate: 0.1,
    // No operator-jackpot licence in France (OJACK is unmapped and blocked),
    // so the policy is moot — declared 'gross' (validator requires one).
    jackpotPolicy: "gross",
    gamingReportFields: [
      "activity_id", "account_id", "game_code", "game_name", "vertical",
      "stake", "payout", "rake_or_fee", "gaming_ggr", "occurred_at_local",
    ],
    gamingRules: [
      { id: "FR-201", type: "no_unlicensed_games",
        description: "loi 2010-476 art. 14: only poker (jeux de cercle) is licensed online — any casino activity in an FR file is an unlicensed offering" },
      { id: "FR-202", type: "valid_game_code",
        description: "Game code must be a held PO (poker) licence code" },
    ],
    // ---- PLAYER PROTECTION & PAYMENTS ----
    playerProtection: {
      // French law makes PLAYER-SET limits mandatory at registration (the
      // CJ trace family records them via LIMITMISE) but sets no statutory
      // default amount — so no statutory arm here.
      defaultDepositLimits: null,
      // National register of excluded players (fichier des interdits de
      // jeux, held by the ANJ) — mandatory to honour, like ES's RGIAJ and
      // NL's CRUKS.
      selfExclusionSources: ["OPERATOR", "NATIONAL"],
      mandatoryRegister: "NATIONAL", // interdits de jeux (ANJ national file)
      withdrawalRequiresVerification: true,
    },
  },

  // ==========================================================================
  // PORTUGAL — SRIJ (Serviço de Regulação e Inspeção de Jogos, Turismo de
  // Portugal), RJO (Decreto-Lei n.º 66/2015) + Regulamento n.º 903-B/2015
  // (technical regime, analysed in docs/regulator/pt/pt-data-model.md). The
  // NINTH market. A Safe/vault PULL regime: the operator's Captor deposits
  // hourly AJOG_/TRAN_/JGDR_ XML files, packaged daily by 01:00, into an
  // in-country Safe that SRIJ collects over FTPS — so the cadence here is
  // daily and voids are FIRST-CLASS (refund triplets r_saldo_ini/r_valor/
  // r_saldo_fim and the RESF_ total_reembolsos are part of the wire format).
  // Full-KYC regime (nome/NIF/id_cidadao per secção 5.2.1): the player is
  // identified by CLEAR operator account id, no pseudonymisation.
  // THE PORTUGUESE DIFFERENCE — SPLIT TAX BASES (IEJO): fixed-odds sports
  // betting is taxed on TURNOVER (stakes — the DE RennwLottG mechanics,
  // reused exactly) while casino/poker games are taxed on GGR — the first
  // market combining taxModel 'turnover' with a GGR gamingTaxRate.
  // LICENSING — HOMOLOGATION: PT licenses the full portfolio, but every
  // game must be individually homologated (type-approved) by SRIJ before
  // offer (secção 3.2.1) — the fourth posture of the licensing story
  // (MT licenses OJACK, ES blocks one game, FR blocks the casino vertical,
  // PT blocks any NON-HOMOLOGATED game). Rates and codes ILLUSTRATIVE —
  // pin to the IEJO articles and SRIJ's current Modelo de Dados before
  // production. REQ: requirements/pt-new-jurisdiction (REQ-PT-1/2/3/7)
  // ==========================================================================
  PT: {
    code: "PT",
    dataset: "reporting_pt",
    currency: "EUR",
    rounding: 2,
    timezone: "Europe/Lisbon",
    addressValidation: { postcodePattern: "^[0-9]{4}-[0-9]{3}$" }, // código postal NNNN-NNN
    submissionCadence: "daily", // daily package window (files by 01:00, Anexo 1)
    includeVoided: true, // refund triplets / total_reembolsos are first-class
    // IEJO on fixed-odds sports betting taxes the STAKES (turnover) — reuse
    // the DE mechanics. 8% is ILLUSTRATIVE — pin to the IEJO articles
    // (Decreto-Lei 66/2015 anexo) before production; the effective-dated
    // schedule shape is already proven on BG/NL/FR if a change lands.
    taxModel: "turnover",
    taxRate: 0.08,
    reportFields: [
      "slip_id", "account_id", "slip_status",
      "stake", "payout", "ggr",
      "sport_code", "event_name",
      "placed_at_local", "settled_at_local",
    ],
    // SRIJ authorises competitions per licence — a CLOSED list with no OTHER
    // bucket, so unmapped sports BLOCK the file. No horse racing: apostas
    // hípicas (the AJOG_ 'hipica' sub-record family) are a separate licence
    // this operator does not hold, hence no HORS entry. Codes illustrative.
    nomenclature: {
      sportCodes: { FOOT: "FUTB", TENN: "TENI", BASK: "BASQ" },
      unmappedPolicy: "block",
      defaultSportCode: null,
      eventNameTemplate: "{home} - {away}",
    },
    // ---- SESSION REPORTING (REQ: requirements/session-tracking, REQ-ST-2/7) ----
    // Portugal reports the LOGIN itself: the SESS_ record family carries
    // LOGIN/LOGOUT events for the platform session, so PT reads the stored
    // platform sessions directly — 'platform' granularity, same stored facts
    // as NL's per-game regime (REQ-ST-3: a granularity change is config, not
    // a migration). No single-game invariant applies at this grain.
    sessionReporting: {
      granularity: "platform",
      timeoutMinutes: 30,
      endReasons: ["LOGOUT", "INACTIVITY"],
      reportEmptySessions: false,
      rules: [
        { id: "ST-201", type: "activity_within_session",
          description: "Every session-stamped play must fall inside its platform session's [start, end] window" },
        { id: "ST-202", type: "single_open_session",
          description: "At most one open platform session per player" },
        { id: "ST-203", type: "end_reason_in_set",
          description: "SESS_ tipo_log vocabulary: end reason must be LOGOUT or INACTIVITY" },
      ],
    },
    rules: [
      { id: "PT-101", type: "in_set", field: "slip_status", values: ["SETTLED", "VOIDED"],
        description: "Regulamento 903-B/2015 Anexo 1 (AJOG_): the daily file carries settled operations and refunds (reembolsos) only — open bets have no terminal record" },
      { id: "PT-102", type: "zero_when", field: "payout", whenField: "slip_status", equals: "VOIDED",
        description: "Regulamento 903-B/2015 Anexo 1: a refunded bet reports its stake back via the r_* triplet — a voided slip must report zero winnings" },
      { id: "PT-103", type: "no_unmapped_fixtures",
        description: "RJO art. 10.º / secção 3.2.1: only SRIJ-authorised competitions may be offered — an unmapped sport blocks the file" },
      { id: "PT-104", type: "valid_sport_code",
        description: "Sport code must be on the SRIJ authorised list (closed, no OTHER bucket)" },
      { id: "PT-105", type: "max_value", field: "stake", value: 50000,
        description: "Stakes above EUR 50k indicate a data error; block the file" },
    ],

    // ---- GAMING domain: homologation (REQ-PT-2) ----
    // PT licenses the full demo portfolio (RJO art. 5.º: fixed-odds betting,
    // poker, blackjack, games of chance), but ONLY games homologated by SRIJ
    // (secção 3.2.1) may be offered. The map is therefore CLOSED over the
    // homologated set, keyed to the AJOG_ sub-record families ('fortazar' =
    // games of chance: roulette/slots; 'bjack'; 'poker'). NOT homologated:
    //   - BACC (the 'pbanca' family exists in the regime, but this operator
    //     never had its baccarat games type-approved), and
    //   - OJACK (the operator jackpot was never submitted for homologation)
    // — both are absent from the map, so unmappedPolicy 'block' +
    // no_unlicensed_games keeps them out of every PT file.
    gamingNomenclature: {
      gameCodes: { SLOT: "fortazar", ROUL: "fortazar", BLKJ: "bjack", POKC: "poker", POKT: "poker" },
      unmappedPolicy: "block",
      defaultGameCode: null,
    },
    // THE SPLIT-BASIS MARKET (REQ-PT-3): betting duty above is TURNOVER
    // (stakes x taxRate) while gaming duty here is GGR x gamingTaxRate —
    // both IEJO arms in one entry. 25% is the ILLUSTRATIVE online-games
    // rate — pin to the IEJO articles before production.
    gamingTaxRate: 0.25,
    // No homologated operator-jackpot game (OJACK is unmapped and blocked),
    // so the policy is moot — declared 'gross' (validator requires one).
    jackpotPolicy: "gross",
    gamingReportFields: [
      "activity_id", "account_id", "game_code", "game_name", "vertical",
      "stake", "payout", "rake_or_fee", "gaming_ggr", "occurred_at_local",
    ],
    gamingRules: [
      { id: "PT-201", type: "no_unlicensed_games",
        description: "RJO / secção 3.2.1: every game offered must be SRIJ-homologated — a non-homologated game in a PT file is an unlicensed offering" },
      { id: "PT-202", type: "valid_game_code",
        description: "Game code must be a homologated AJOG_ sub-record family (fortazar/bjack/poker)" },
    ],
    // ---- PLAYER PROTECTION & PAYMENTS (REQ-PT-7) ----
    playerProtection: {
      // secção 5.3.2: player-set deposit AND bet limits, each at daily/
      // weekly/monthly granularity (reductions immediate, relaxations after
      // 24h) — mandatory to OFFER, but no statutory default amount, so no
      // statutory arm here.
      defaultDepositLimits: null,
      // SRIJ's national self-exclusion register (lista de autoexcluídos) —
      // consumed via the ListaExcluidos SOAP pull + real-time push in
      // reality; mandatory to honour, like ES's RGIAJ and NL's CRUKS.
      selfExclusionSources: ["OPERATOR", "NATIONAL"],
      mandatoryRegister: "NATIONAL", // SRIJ lista de autoexcluídos
      // Full KYC with AT (tax authority) / civil-registry verification at
      // registration (secção 5.2.1); withdrawal requires a verified identity.
      withdrawalRequiresVerification: true,
    },
  },
};

module.exports = { jurisdictions, commonRules, commonGamingRules, commonPeriodicRules };
