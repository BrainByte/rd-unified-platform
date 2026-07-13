// ============================================================================
// SEED DATA — single source of truth for test data, consumed by:
//   - seed/generate.js  -> regenerates seed/bigquery_setup.sql
//   - local/run.js      -> loads DuckDB directly for offline runs
// Covers every lifecycle path and every nomenclature case (see README).
// ============================================================================

const accounts = [
  // account_id, jurisdiction, national_id, date_of_birth, kyc_status, opened_at, _op, _commit_ts
  // date_of_birth: REQ requirements/max-stake-limits (REQ-MSL-7) — a
  // UNIVERSAL datum (age-banded stake caps need it in every market), so it
  // widens the shared account model rather than riding the extension carrier.
  ["A1001", "MT", "111", "1988-04-12", "VERIFIED", "2025-01-10 09:00:00+00", "I", "2025-01-10 09:00:01+00"],
  ["A1002", "MT", "222", "1992-09-30", "VERIFIED", "2025-03-02 14:30:00+00", "I", "2025-03-02 14:30:01+00"],
  ["A2001", "ES", "333", "1985-02-17", "VERIFIED", "2025-02-20 11:00:00+00", "I", "2025-02-20 11:00:01+00"],
  ["A2002", "ES", "444", "1979-11-05", "VERIFIED", "2025-05-15 16:45:00+00", "I", "2025-05-15 16:45:01+00"],
  // A2003: ES player, never identity-verified, RGIAJ self-excluded —
  // exercises exclusion + verification checks WITHOUT any completed
  // activity (the platform correctly blocked everything).
  ["A2003", "ES", "555", "1998-07-21", "PENDING", "2026-05-01 10:00:00+00", "I", "2026-05-01 10:00:01+00"],
  // CDC update replay for A1001 — staging must dedupe to latest
  ["A1001", "MT", "111", "1988-04-12", "VERIFIED", "2025-01-10 09:00:00+00", "U", "2026-07-01 08:00:00+00"],
  // New markets (betting-domain extensibility test): DK/BG/GR players.
  ["A3001", "DK", "DK-CPR-1001", "1990-01-15", "VERIFIED", "2026-01-05 09:00:00+00", "I", "2026-01-05 09:00:01+00"],
  ["A4001", "BG", "BG-EGN-2002", "1983-06-08", "VERIFIED", "2026-02-05 09:00:00+00", "I", "2026-02-05 09:00:01+00"],
  ["A5001", "GR", "GR-AFM-3003", "1975-12-01", "VERIFIED", "2026-03-05 09:00:00+00", "I", "2026-03-05 09:00:01+00"],
  ["A6001", "NL", "NL-BSN-4004", "1995-03-22", "VERIFIED", "2026-04-05 09:00:00+00", "I", "2026-04-05 09:00:01+00"],
  // A4002 (BG) exists to exercise EFFECTIVE-DATING: a 2025 bet resubmitted
  // must reproduce the 2025 tax rate (20%) and the 2025 football code (FUT).
  ["A4002", "BG", "BG-EGN-2005", "1980-05-19", "VERIFIED", "2025-11-01 09:00:00+00", "I", "2025-11-01 09:00:01+00"],
  // ---- FAULT-ISOLATION demo accounts (MT) — each exercises exactly one
  // exception route so the pipeline continues for everyone else. All funded
  // (deposit >= stake) so the only exception each raises is the intended one.
  ["A7001", "MT", "701", "1991-01-10", "VERIFIED", "2026-06-01 09:00:00+00", "I", "2026-06-01 09:00:01+00"], // bad postcode -> DATA quarantine
  ["A7002", "MT", "702", "1991-02-11", "VERIFIED", "2026-06-01 09:00:00+00", "I", "2026-06-01 09:00:01+00"], // region ref late -> TRANSIENT retry
  ["A7003", "MT", "703", "1991-03-12", "VERIFIED", "2026-06-01 09:00:00+00", "I", "2026-06-01 09:00:01+00"], // bet while excluded -> COMPLIANCE hold
  ["A7004", "MT", "704", "1991-04-13", "VERIFIED", "2026-06-01 09:00:00+00", "I", "2026-06-01 09:00:01+00"], // period not closed -> COMPLETENESS hold
  ["A7005", "MT", "705", "1991-05-14", "VERIFIED", "2026-06-01 09:00:00+00", "I", "2026-06-01 09:00:01+00"], // region ref late, retries exhausted -> escalated
  // A8001: a YOUNG ADULT (21 in 2026) with no activity — exists so the 18-24
  // slots stake band is demonstrable (REQ: requirements/max-stake-limits,
  // negative tests inject their stakes) without disturbing any expectation.
  ["A8001", "MT", "801", "2005-03-15", "VERIFIED", "2026-06-15 09:00:00+00", "I", "2026-06-15 09:00:01+00"],
  // Germany (REQ: de-regulator-addition): the 7th market — added as config.
  ["A9001", "DE", "DE-PA-556677", "1994-08-25", "VERIFIED", "2026-05-20 09:00:00+00", "I", "2026-05-20 09:00:01+00"],
];

// ---- FAULT ISOLATION seed (see includes/exceptions.js) ----
// Customer addresses; postcode format is validated per market (variance as
// data). A missing region reference is a TRANSIENT (late) failure.
const accountAddresses = [
  // account_id, postcode, city, _op, _commit_ts
  ["A1001", "VLT 1117", "Valletta", "I", "2026-06-01 09:00:05+00"], // valid (region present) — happy path
  ["A7001", "BADPC",    "Valletta", "I", "2026-06-01 09:00:05+00"], // invalid MT format -> DATA
  ["A7002", "MST 1234", "Mosta",    "I", "2026-06-01 09:00:05+00"], // valid format, region MST absent -> TRANSIENT
  ["A7003", "VLT 1117", "Valletta", "I", "2026-06-01 09:00:05+00"], // valid
  ["A7004", "SLM 2345", "Sliema",   "I", "2026-06-01 09:00:05+00"], // valid
  ["A7005", "MST 5678", "Mosta",    "I", "2026-06-01 09:00:05+00"], // valid format, region MST absent -> TRANSIENT
];

// Postcode-prefix -> region reference. 'MST' (Mosta) is intentionally NOT yet
// loaded, so A7002/A7005 fail region resolution as a TRANSIENT (late) error.
const postcodeRegions = [
  // postcode_prefix, region_name
  ["VLT", "Valletta"],
  ["SLM", "Sliema"],
];

// Source freshness watermarks: the settlement feed is complete THROUGH the
// given instant per market. 2026-07-09 covers every existing period (incl. the
// BG 2025 resubmission) but NOT 2026-07-10 — so A7004's later-settling slip is
// held as COMPLETENESS (period not closed), not shipped partial.
const sourceWatermarks = [
  // source, jurisdiction, complete_through
  ["bet_settlement", "MT", "2026-07-09 00:00:00+00"],
  ["bet_settlement", "ES", "2026-07-09 00:00:00+00"],
  ["bet_settlement", "DK", "2026-07-09 00:00:00+00"],
  ["bet_settlement", "BG", "2026-07-09 00:00:00+00"],
  ["bet_settlement", "GR", "2026-07-09 00:00:00+00"],
  ["bet_settlement", "NL", "2026-07-09 00:00:00+00"],
  // DE (REQ: de-regulator-addition). NOTE: forgetting this line is caught by
  // the fail-closed readiness gate — the DE player is held WAITING_DATA and
  // the DE file ships empty rather than incomplete. Proven during bring-up.
  ["bet_settlement", "DE", "2026-07-09 00:00:00+00"],
];

// Persisted retry state from prior runs (the pipeline's memory across runs).
// The runner uses a fixed 'now' of 2026-07-08 12:00:00+00, so:
//   A7002 (attempt 2, retry due 11:00) -> advances to attempt 3, still RETRYING
//   A7005 (attempt 5, retry due 11:30) -> advances to 6 > MAX(5) -> QUARANTINED
//   A1001 (was retrying) now resolves (region present) -> RESOLVED, re-admitted
const exceptionState = [
  // entity_type, entity_id, reason_code, error_class, attempt_count, first_seen, next_retry_at, status
  ["ADDRESS", "A7002", "region_not_found", "TRANSIENT", 2, "2026-07-08 10:00:00+00", "2026-07-08 11:00:00+00", "RETRYING"],
  ["ADDRESS", "A7005", "region_not_found", "TRANSIENT", 5, "2026-07-08 05:00:00+00", "2026-07-08 11:30:00+00", "RETRYING"],
  ["ADDRESS", "A1001", "region_not_found", "TRANSIENT", 1, "2026-07-08 09:00:00+00", "2026-07-08 09:30:00+00", "RETRYING"],
];

// ---- PLAYER PROTECTION & PAYMENTS seed ----

const playerLimits = [
  // limit_id, account_id, limit_type, amount, set_at, revoked_at, _op, _commit_ts
  // A2001 tightened from 200 to a personal 100/day (below the ES default 600)
  ["L1", "A2001", "DEPOSIT_DAILY", 200.0, "2026-05-01 09:00:00+00", "2026-06-01 09:00:00+00", "I", "2026-05-01 09:00:01+00"],
  ["L2", "A2001", "DEPOSIT_DAILY", 100.0, "2026-06-01 09:00:00+00", null, "I", "2026-06-01 09:00:01+00"],
  // MT has no statutory defaults; A1001 set a personal 500/day
  ["L3", "A1001", "DEPOSIT_DAILY", 500.0, "2026-01-15 09:00:00+00", null, "I", "2026-01-15 09:00:01+00"],
  // A1001 also set a personal daily LOSS limit of 50 — their real day-8 net
  // position is a net win, so no breach; the negative test shows a large
  // operator-jackpot contribution pushing net loss over this limit.
  ["L4", "A1001", "LOSS_DAILY", 50.0, "2026-06-01 09:00:00+00", null, "I", "2026-06-01 09:00:01+00"],
  // A1001's personal per-stake casino cap. REQ: requirements/max-stake-limits
  // (REQ-MSL-2) — a NEW LIMIT TYPE is a row, not a schema change: it flows
  // through the existing cdc_player_limits machinery untouched. 30 sits above
  // A1001's real stakes (max 25.00), so clean data stays clean; a negative
  // test injects a 50.00 poker stake to prove the personal cap fires.
  ["L5", "A1001", "STAKE_CASINO", 30.0, "2026-06-01 09:00:00+00", null, "I", "2026-06-01 09:00:01+00"],
];

const selfExclusions = [
  // exclusion_id, account_id, source, start_ts, end_ts, _op, _commit_ts
  // A2003: on the Spanish NATIONAL register (RGIAJ), indefinite
  ["X1", "A2003", "RGIAJ", "2026-06-01 00:00:00+00", null, "I", "2026-06-01 00:00:01+00"],
  // A1002: operator-level exclusion that ENDED before any 2026 activity
  ["X2", "A1002", "OPERATOR", "2025-01-01 00:00:00+00", "2025-07-01 00:00:00+00", "I", "2025-01-01 00:00:01+00"],
  // A7003: ACTIVE operator exclusion — its 2026-07-08 bet is placed during it,
  // so activity-while-excluded fires and A7003 is HELD (per-entity, not a run abort).
  ["X3", "A7003", "OPERATOR", "2026-07-08 00:00:00+00", null, "I", "2026-07-08 00:00:01+00"],
];

const verifications = [
  // verification_id, account_id, check_type, status, event_ts, _op, _commit_ts
  ["V1", "A1001", "IDENTITY", "VERIFIED", "2025-01-11 10:00:00+00", "I", "2025-01-11 10:00:01+00"],
  ["V2", "A1002", "IDENTITY", "VERIFIED", "2025-03-03 10:00:00+00", "I", "2025-03-03 10:00:01+00"],
  ["V3", "A2001", "IDENTITY", "VERIFIED", "2025-02-21 10:00:00+00", "I", "2025-02-21 10:00:01+00"],
  // A2002: PENDING then VERIFIED the day before withdrawing
  ["V4", "A2002", "IDENTITY", "PENDING",  "2026-07-06 09:00:00+00", "I", "2026-07-06 09:00:01+00"],
  ["V5", "A2002", "IDENTITY", "VERIFIED", "2026-07-07 09:00:00+00", "I", "2026-07-07 09:00:01+00"],
  // A2003: still pending — withdrawal must never complete
  ["V6", "A2003", "IDENTITY", "PENDING",  "2026-06-02 09:00:00+00", "I", "2026-06-02 09:00:01+00"],
];

const payments = [
  // payment_id, account_id, direction, amount, method, status, requested_ts, completed_ts, _op, _commit_ts
  ["D1", "A1001", "DEPOSIT", 200.0, "CARD",  "COMPLETED", "2026-07-07 08:00:00+00", "2026-07-07 08:00:05+00", "I", "2026-07-07 08:00:06+00"],
  ["D2", "A1002", "DEPOSIT",  50.0, "PAYPAL","COMPLETED", "2026-07-08 08:30:00+00", "2026-07-08 08:30:05+00", "I", "2026-07-08 08:30:06+00"],
  // A2001: 90 under their personal 100/day limit (Bizum — ubiquitous in ES)
  ["D3", "A2001", "DEPOSIT",  90.0, "BIZUM", "COMPLETED", "2026-07-08 08:45:00+00", "2026-07-08 08:45:05+00", "I", "2026-07-08 08:45:06+00"],
  // A2002: 550 under the ES statutory default 600/day (no personal limit)
  ["D4", "A2002", "DEPOSIT", 550.0, "SEPA",  "COMPLETED", "2026-07-08 09:00:00+00", "2026-07-08 09:00:05+00", "I", "2026-07-08 09:00:06+00"],
  // A2003 (RGIAJ-excluded): deposit attempt correctly BLOCKED -> FAILED
  ["D5", "A2003", "DEPOSIT", 100.0, "CARD",  "FAILED",    "2026-07-08 09:15:00+00", null, "I", "2026-07-08 09:15:06+00"],
  ["W1", "A1001", "WITHDRAWAL", 150.0, "SEPA", "COMPLETED", "2026-07-08 14:00:00+00", "2026-07-08 16:00:00+00", "I", "2026-07-08 16:00:01+00"],
  ["W2", "A2002", "WITHDRAWAL",  20.0, "SEPA", "COMPLETED", "2026-07-08 10:00:00+00", "2026-07-08 12:00:00+00", "I", "2026-07-08 12:00:01+00"],
  // A2003 (unverified): withdrawal correctly held at REQUESTED
  ["W3", "A2003", "WITHDRAWAL", 40.0, "SEPA", "REQUESTED", "2026-07-08 11:00:00+00", null, "I", "2026-07-08 11:00:01+00"],
  // Opening deposits that FUND the new-market wallets before they bet, so
  // the sufficient-balance spend gate (rg_breach_wallet_overspend) is clean.
  ["D6", "A3001", "DEPOSIT", 200.0, "CARD", "COMPLETED", "2026-07-08 09:00:00+00", "2026-07-08 09:00:05+00", "I", "2026-07-08 09:00:06+00"],
  ["D7", "A4001", "DEPOSIT", 100.0, "CARD", "COMPLETED", "2026-07-08 09:00:00+00", "2026-07-08 09:00:05+00", "I", "2026-07-08 09:00:06+00"],
  ["D8", "A5001", "DEPOSIT", 1000.0, "CARD", "COMPLETED", "2026-07-08 09:00:00+00", "2026-07-08 09:00:05+00", "I", "2026-07-08 09:00:06+00"],
  ["D9", "A6001", "DEPOSIT", 150.0, "CARD", "COMPLETED", "2026-07-08 09:00:00+00", "2026-07-08 09:00:05+00", "I", "2026-07-08 09:00:06+00"],
  // Funds A4002's 2025 bet (before it) so the spend gate stays clean.
  ["D10", "A4002", "DEPOSIT", 500.0, "CARD", "COMPLETED", "2025-12-01 09:00:00+00", "2025-12-01 09:00:05+00", "I", "2025-12-01 09:00:06+00"],
  // Fund the fault-isolation demo accounts (deposit >= stake) so none trips the
  // spend gate. A7003 deposits BEFORE its exclusion starts (not itself a breach).
  ["D11", "A7001", "DEPOSIT", 20.0, "CARD", "COMPLETED", "2026-07-08 07:00:00+00", "2026-07-08 07:00:05+00", "I", "2026-07-08 07:00:06+00"],
  ["D12", "A7002", "DEPOSIT", 20.0, "CARD", "COMPLETED", "2026-07-08 07:00:00+00", "2026-07-08 07:00:05+00", "I", "2026-07-08 07:00:06+00"],
  ["D13", "A7003", "DEPOSIT", 20.0, "CARD", "COMPLETED", "2026-07-06 07:00:00+00", "2026-07-06 07:00:05+00", "I", "2026-07-06 07:00:06+00"],
  ["D14", "A7004", "DEPOSIT", 20.0, "CARD", "COMPLETED", "2026-07-10 07:00:00+00", "2026-07-10 07:00:05+00", "I", "2026-07-10 07:00:06+00"],
  ["D15", "A7005", "DEPOSIT", 20.0, "CARD", "COMPLETED", "2026-07-08 07:00:00+00", "2026-07-08 07:00:05+00", "I", "2026-07-08 07:00:06+00"],
  // DE: funds A9001's wallet — 300 sits comfortably under the LUGAS
  // cross-operator statutory 1000/month (monthly-only default).
  ["D16", "A9001", "DEPOSIT", 300.0, "CARD", "COMPLETED", "2026-07-08 08:30:00+00", "2026-07-08 08:30:05+00", "I", "2026-07-08 08:30:06+00"],
];

// Generic jurisdiction-attribute carrier (Option B). Market-specific data
// that has no place in the shared core model lands here as key/value rows,
// keyed by (entity_type, entity_id, attr_name). Adding a market's bespoke
// attribute = rows here + one includes/extensions.js entry; no shared-table
// DDL and no per-market table.
const regAttributes = [
  // entity_type, entity_id, attr_name, attr_value, _op, _commit_ts
  // Denmark: TamperToken signature on the SAFE Standard Record for slip S7.
  ["SLIP", "S7", "safe_tampertoken", "TT-0000A7F3", "I", "2026-07-08 18:00:05+00"],
  // Bulgaria: NRA real-time registration reference for bet S8...
  ["SLIP", "S8", "nra_registration_id", "BG-2026-000000042", "I", "2026-07-08 10:00:05+00"],
  // ...replayed by CDC (later commit, same value) — staging must dedupe to 1.
  ["SLIP", "S8", "nra_registration_id", "BG-2026-000000042", "I", "2026-07-08 10:05:00+00"],
  // BG 2025 resubmission slip — its NRA reference carries the 2025 year.
  ["SLIP", "S12", "nra_registration_id", "BG-2025-000000043", "I", "2025-12-15 10:00:05+00"],
  // Netherlands: the mandatory CRUKS self-exclusion check + the CDB control
  // record reference for slip S11.
  ["SLIP", "S11", "cruks_check_ref", "CRUKS-00B4D2F1", "I", "2026-07-08 10:00:05+00"],
  ["SLIP", "S11", "cdb_record_id", "NL-CDB-0000000042", "I", "2026-07-08 10:00:05+00"],
  // Germany: the LUGAS activity-file reference for bet S13.
  ["SLIP", "S13", "lugas_activity_id", "LUGAS-3F2A9B4C1D6E", "I", "2026-07-08 10:00:05+00"],
];

const fixtures = [
  // fixture_id, sport_name_raw, competition_raw, home_raw, away_raw, start_ts, _op, _commit_ts
  ["F1", "Soccer", "Premier League", "Man Utd", "Chelsea FC", "2026-07-08 16:00:00+00", "I", "2026-07-07 09:00:00+00"],
  ["F2", "  FÚTBOL ", "La Liga", "R Madrid", "Barça", "2026-07-08 19:00:00+00", "I", "2026-07-07 09:00:00+00"],
  ["F3", "Lawn Tennis", "Wimbledon", "R. Nadal", "N. Djokovic", "2026-07-08 17:00:00+00", "I", "2026-07-07 09:00:00+00"],
  ["F4", "Kabaddi", "Pro Kabaddi League", "Patna Pirates", "Bengal Warriors", "2026-07-08 14:30:00+00", "I", "2026-07-07 09:00:00+00"],
];

const betSlips = [
  // slip_id, account_id, fixture_id, product, _op, _commit_ts
  ["S1", "A1001", "F1", "sports", "I", "2026-07-08 10:00:00+00"],
  ["S2", "A1001", "F1", "sports", "I", "2026-07-08 11:00:00+00"],
  ["S3", "A1002", "F3", "sports", "I", "2026-07-08 12:00:00+00"],
  ["S4", "A2001", "F2", "sports", "I", "2026-07-08 13:00:00+00"],
  ["S5", "A2002", "F2", "sports", "I", "2026-07-08 14:00:00+00"],
  ["S6", "A2002", "F4", "sports", "I", "2026-07-08 15:00:00+00"],
  // New-market slips (all on F1 -> FOOT, which every market maps).
  ["S7", "A3001", "F1", "sports", "I", "2026-07-08 10:00:00+00"], // DK
  ["S8", "A4001", "F1", "sports", "I", "2026-07-08 10:00:00+00"], // BG
  ["S9", "A5001", "F1", "sports", "I", "2026-07-08 10:00:00+00"], // GR — winning slip (withholding)
  ["S10", "A5001", "F1", "sports", "I", "2026-07-08 10:00:00+00"], // GR — losing slip
  ["S11", "A6001", "F1", "sports", "I", "2026-07-08 10:00:00+00"], // NL
  ["S12", "A4002", "F1", "sports", "I", "2025-12-15 10:00:00+00"], // BG — 2025 resubmission
  // Fault-isolation demo slips (MT, all on F1 -> FOOT). Each would normally
  // appear in the MT file; each is excluded by its own exception route.
  ["S7001", "A7001", "F1", "sports", "I", "2026-07-08 10:00:00+00"],
  ["S7002", "A7002", "F1", "sports", "I", "2026-07-08 10:00:00+00"],
  ["S7003", "A7003", "F1", "sports", "I", "2026-07-08 10:00:00+00"],
  ["S7004", "A7004", "F1", "sports", "I", "2026-07-10 10:00:00+00"], // settles in a period not yet closed
  ["S7005", "A7005", "F1", "sports", "I", "2026-07-08 10:00:00+00"],
  ["S13", "A9001", "F1", "sports", "I", "2026-07-08 10:00:00+00"], // DE — turnover-tax demo
];

const betSlipEvents = [
  // slip_id, event_type, event_ts, stake, payout, _op, _commit_ts
  // S1: placed then settled as a win
  ["S1", "PLACED",  "2026-07-08 10:00:00+00", 10.0, null, "I", "2026-07-08 10:00:01+00"],
  ["S1", "SETTLED", "2026-07-08 18:00:00+00", null, 8.0,  "I", "2026-07-08 18:00:01+00"],
  // S2: placed then voided
  ["S2", "PLACED",  "2026-07-08 11:00:00+00", 20.0, null, "I", "2026-07-08 11:00:01+00"],
  ["S2", "VOIDED",  "2026-07-08 12:30:00+00", null, null, "I", "2026-07-08 12:30:01+00"],
  // S3: placed then settled as a loss
  ["S3", "PLACED",  "2026-07-08 12:00:00+00", 5.0,  null, "I", "2026-07-08 12:00:01+00"],
  ["S3", "SETTLED", "2026-07-08 19:00:00+00", null, 0.0,  "I", "2026-07-08 19:00:01+00"],
  // S4: placed then settled
  ["S4", "PLACED",  "2026-07-08 13:00:00+00", 50.0, null, "I", "2026-07-08 13:00:01+00"],
  ["S4", "SETTLED", "2026-07-08 20:00:00+00", null, 40.0, "I", "2026-07-08 20:00:01+00"],
  // S5: settled as a win then VOIDED — void must win, payout -> 0
  ["S5", "PLACED",  "2026-07-08 14:00:00+00", 15.0, null, "I", "2026-07-08 14:00:01+00"],
  ["S5", "SETTLED", "2026-07-08 21:00:00+00", null, 60.0, "I", "2026-07-08 21:00:01+00"],
  ["S5", "VOIDED",  "2026-07-09 08:00:00+00", null, null, "I", "2026-07-09 08:00:01+00"],
  // S6: placed, still open — appears in NO submission
  ["S6", "PLACED",  "2026-07-08 15:00:00+00", 30.0, null, "I", "2026-07-08 15:00:01+00"],
  // exact CDC replay of S1 PLACED — staging must dedupe
  ["S1", "PLACED",  "2026-07-08 10:00:00+00", 10.0, null, "I", "2026-07-08 10:05:00+00"],
  // ---- new-market slips (settled on 2026-07-08) ----
  // S7 DK: GGR 40 -> 28% tax 11.20
  ["S7", "PLACED",  "2026-07-08 10:00:00+00", 100.0, null, "I", "2026-07-08 10:00:01+00"],
  ["S7", "SETTLED", "2026-07-08 18:00:00+00", null, 60.0,  "I", "2026-07-08 18:00:01+00"],
  // S8 BG: GGR 30 -> 25% tax 7.50
  ["S8", "PLACED",  "2026-07-08 10:00:00+00", 50.0, null, "I", "2026-07-08 10:00:01+00"],
  ["S8", "SETTLED", "2026-07-08 18:00:00+00", null, 20.0, "I", "2026-07-08 18:00:01+00"],
  // S9 GR: winnings 600 -> tiered withholding 25.00 (2.5+15+7.5)
  ["S9", "PLACED",  "2026-07-08 10:00:00+00", 300.0, null, "I", "2026-07-08 10:00:01+00"],
  ["S9", "SETTLED", "2026-07-08 18:00:00+00", null, 600.0, "I", "2026-07-08 18:00:01+00"],
  // S10 GR: losing slip -> withholding 0; with S9 gives operator GGR 200 -> 35% tax 70.00
  ["S10", "PLACED",  "2026-07-08 10:00:00+00", 500.0, null, "I", "2026-07-08 10:00:01+00"],
  ["S10", "SETTLED", "2026-07-08 18:00:00+00", null, 0.0,  "I", "2026-07-08 18:00:01+00"],
  // S11 NL: GGR 50 -> 37.8% (2026 kansspelbelasting) tax 18.90
  ["S11", "PLACED",  "2026-07-08 10:00:00+00", 80.0, null, "I", "2026-07-08 10:00:01+00"],
  ["S11", "SETTLED", "2026-07-08 18:00:00+00", null, 30.0, "I", "2026-07-08 18:00:01+00"],
  // S12 BG (2025): GGR 60 -> effective-dated 20% (2025 rate) tax 12.00
  ["S12", "PLACED",  "2025-12-15 10:00:00+00", 100.0, null, "I", "2025-12-15 10:00:01+00"],
  ["S12", "SETTLED", "2025-12-15 18:00:00+00", null, 40.0, "I", "2025-12-15 18:00:01+00"],
  // ---- fault-isolation demo slips (stake 10, payout 5) — all settled ----
  ["S7001", "PLACED",  "2026-07-08 10:00:00+00", 10.0, null, "I", "2026-07-08 10:00:01+00"],
  ["S7001", "SETTLED", "2026-07-08 18:00:00+00", null, 5.0,  "I", "2026-07-08 18:00:01+00"],
  ["S7002", "PLACED",  "2026-07-08 10:00:00+00", 10.0, null, "I", "2026-07-08 10:00:01+00"],
  ["S7002", "SETTLED", "2026-07-08 18:00:00+00", null, 5.0,  "I", "2026-07-08 18:00:01+00"],
  ["S7003", "PLACED",  "2026-07-08 10:00:00+00", 10.0, null, "I", "2026-07-08 10:00:01+00"], // placed during exclusion
  ["S7003", "SETTLED", "2026-07-08 18:00:00+00", null, 5.0,  "I", "2026-07-08 18:00:01+00"],
  ["S7005", "PLACED",  "2026-07-08 10:00:00+00", 10.0, null, "I", "2026-07-08 10:00:01+00"],
  ["S7005", "SETTLED", "2026-07-08 18:00:00+00", null, 5.0,  "I", "2026-07-08 18:00:01+00"],
  // S7004 settles on 2026-07-10 — a period the settlement feed has not closed.
  ["S7004", "PLACED",  "2026-07-10 10:00:00+00", 10.0, null, "I", "2026-07-10 10:00:01+00"],
  ["S7004", "SETTLED", "2026-07-10 18:00:00+00", null, 5.0,  "I", "2026-07-10 18:00:01+00"],
  // S13 DE: stake 40, payout 20 — TURNOVER tax 40 x 5.3% = 2.12 (a GGR-based
  // 5.3% would give 1.06: the expectation proves the tax BASE is stakes).
  ["S13", "PLACED",  "2026-07-08 10:00:00+00", 40.0, null, "I", "2026-07-08 10:00:01+00"],
  ["S13", "SETTLED", "2026-07-08 18:00:00+00", null, 20.0, "I", "2026-07-08 18:00:01+00"],
];

// ---- GAMING domain seed ----
// Real provider names and realistically messy game-type labels:
// NetEnt labels slots "Video Slots", Evolution live tables differ from
// RNG tables, Spribe's crash game "Aviator" is a newer category with no
// alias yet -> lands in the unmapped queue. Mega Fortune is a NetEnt
// progressive jackpot slot (wide-area pools of this kind seed at large
// operator/provider-funded amounts and take ~1% of each wager).
// provider_game_ref = the id the PROVIDER uses in its feed (they collide
// across providers, hence internal game_id + composite catalogue key).
const games = [
  // game_id, game_name, provider, provider_game_ref, game_type_raw, _op, _commit_ts
  ["G1", "Starburst", "NetEnt", "1101", "Video Slots", "I", "2026-07-01 09:00:00+00"],
  ["G2", "Lightning Roulette", "Evolution", "lr_01", "Live Roulette", "I", "2026-07-01 09:00:00+00"],
  ["G3", "Blackjack Classic", "NetEnt", "1102", "Table Games - Blackjack", "I", "2026-07-01 09:00:00+00"],
  ["G4", "Mega Fortune", "NetEnt", "1103", "Slots", "I", "2026-07-01 09:00:00+00"],
  ["G5", "Punto Banco Pro", "Evolution", "pb_02", "Punto Banco", "I", "2026-07-01 09:00:00+00"],
  ["G6", "Texas Hold'em 6-Max", "in_house", null, "Poker - Cash", "I", "2026-07-01 09:00:00+00"],
  ["G7", "Sunday Deepstack", "in_house", null, "Poker Tournament", "I", "2026-07-01 09:00:00+00"],
  ["G8", "Aviator", "Spribe", "aviator", "Crash", "I", "2026-07-01 09:00:00+00"], // via aggregator; type unmapped
  ["G9", "Age of the Gods", "Playtech", "aog", "Slot", "I", "2026-07-01 09:00:00+00"],
  // PHANTOM GAME: not a provider game — the operator's own opt-in jackpot,
  // catalogued so its wins can be correlated to a regulator vertical.
  ["OJ1", "Operator Mega Jackpot", "operator", null, "Operator Jackpot", "I", "2026-07-01 09:00:00+00"],
];

// ---- OPERATOR-DRIVEN OPT-IN JACKPOT seed ----
// An operator-run game of chance layered on top of provider games AND sports
// bets: opted-in players make an automatic contribution from their unified
// balance whenever a trigger fires, and can win the pool. Contributions are
// wagers on the phantom game OJ1; wins are payouts. See ARCHITECTURE.md.
const operatorJackpotPools = [
  // jackpot_id, jackpot_name, seed_amount
  ["OJP1", "Operator Mega Jackpot", 500.0],
];

const jackpotOptins = [
  // optin_id, account_id, jackpot_id, opted_in_at, opted_out_at, _op, _commit_ts
  ["OPT1", "A1001", "OJP1", "2026-07-01 00:00:00+00", null, "I", "2026-07-01 00:00:01+00"],
];

const operatorJackpotContributions = [
  // contribution_id, account_id, jackpot_id, game_id, trigger_type, trigger_ref, amount, contributed_at, _op, _commit_ts
  // CROSS-DOMAIN: one contribution triggered by a provider game round...
  ["OJC1", "A1001", "OJP1", "OJ1", "GAMING_ROUND", "NE:R1", 5.0, "2026-07-08 09:00:05+00", "I", "2026-07-08 09:00:06+00"],
  // ...and one triggered by a SPORTS bet, debited from the same unified balance.
  ["OJC2", "A1001", "OJP1", "OJ1", "SPORTS_BET", "S1", 4.0, "2026-07-08 10:00:05+00", "I", "2026-07-08 10:00:06+00"],
  // VOID/REFUND CASCADE: these two ride on triggers that were later voided —
  // OJC3 on bet slip S2 (voided in the lifecycle), OJC4 on round NE:R99 (a
  // rolled-back round). Both must be REFUNDED and excluded from pool/GGR/loss.
  ["OJC3", "A1001", "OJP1", "OJ1", "SPORTS_BET", "S2", 6.0, "2026-07-08 11:00:05+00", "I", "2026-07-08 11:00:06+00"],
  ["OJC4", "A1001", "OJP1", "OJ1", "GAMING_ROUND", "NE:R99", 7.0, "2026-07-08 09:05:05+00", "I", "2026-07-08 09:05:06+00"],
];

// Provider round rollbacks/voids (a round that never completed). Drives the
// operator-jackpot refund cascade for GAMING_ROUND triggers. (Reversing the
// underlying provider round in gaming reporting is a separate provider-feed
// concern; NE:R99 never completed, so it is not among the reported rounds.)
const gameRoundVoids = [
  // round_id, voided_at
  ["NE:R99", "2026-07-08 09:05:30+00"],
];

const operatorJackpotWins = [
  // win_id, jackpot_id, account_id, game_id, amount, win_ts, _op, _commit_ts
  ["OJW1", "OJP1", "A1001", "OJ1", 3.0, "2026-07-08 11:00:00+00", "I", "2026-07-08 11:00:01+00"],
];

// NetEnt: round grain, EUR, provider's own field names, jackpot embedded.
const netentRounds = [
  // round_ref, player_ref, game_ref, bet_amount, win_amount, jp_contribution, jp_id, round_ts, _op, _commit_ts
  ["R1", "A1001", "1101", 2.0, 0.5, 0.0, null, "2026-07-08 09:00:00+00", "I", "2026-07-08 09:00:01+00"],
  ["R3", "A1001", "1102", 25.0, 25.0, 0.0, null, "2026-07-08 09:20:00+00", "I", "2026-07-08 09:20:01+00"],
  // Mega Fortune: 1% of the wager diverted to pool JP1
  ["R4", "A1001", "1103", 4.0, 0.0, 0.04, "JP1", "2026-07-08 09:30:00+00", "I", "2026-07-08 09:30:01+00"],
  ["R7", "A2001", "1101", 8.0, 12.0, 0.0, null, "2026-07-08 10:00:00+00", "I", "2026-07-08 10:00:01+00"],
  ["R8", "A2002", "1103", 10.0, 0.0, 0.10, "JP1", "2026-07-08 10:10:00+00", "I", "2026-07-08 10:10:01+00"],
];

// Evolution live casino: TRANSACTION grain, amounts in CENTS.
// R2: Lightning Roulette loss (BET only). R5: Punto Banco 5.00 -> 10.00
// win (baccarat: fine for MT Type 1; ES holds no Punto y Banca licence).
const evolutionTransactions = [
  // tx_id, round_ref, player_ref, table_ref, tx_type, amount_cents, tx_ts, _op, _commit_ts
  ["T1", "R2", "A1002", "lr_01", "BET", 1000, "2026-07-08 09:10:00+00", "I", "2026-07-08 09:10:01+00"],
  ["T2", "R5", "A1001", "pb_02", "BET", 500, "2026-07-08 09:40:00+00", "I", "2026-07-08 09:40:01+00"],
  ["T3", "R5", "A1001", "pb_02", "WIN", 1000, "2026-07-08 09:40:20+00", "I", "2026-07-08 09:40:21+00"],
  // CDC replay of T2 — adapter must dedupe on tx_id
  ["T2", "R5", "A1001", "pb_02", "BET", 500, "2026-07-08 09:40:00+00", "I", "2026-07-08 09:45:00+00"],
];

// Playtech: round grain, EUR, games identified by Playtech codes.
const playtechRounds = [
  // round_ref, player_ref, game_code, stake, payout, round_ts, _op, _commit_ts
  ["R9", "A1002", "aog", 6.0, 1.0, "2026-07-08 09:55:00+00", "I", "2026-07-08 09:55:01+00"],
];

// Aggregator feed for long-tail studios; the real studio travels in
// sub_provider. Aviator's 'Crash' type has no alias -> unmapped queue,
// MT default bucket.
const aggregatorRounds = [
  // round_ref, sub_provider, player_ref, game_ref, bet, win, round_ts, _op, _commit_ts
  ["R6", "Spribe", "A1001", "aviator", 3.0, 0.0, "2026-07-08 09:50:00+00", "I", "2026-07-08 09:50:01+00"],
];

// Daily provider GGR statements (what each provider will invoice
// revenue share on) — reconciled against internal records.
const providerStatements = [
  // provider, statement_date_ts (00:00 UTC of the day), reported_ggr
  ["NetEnt", "2026-07-08", 11.5],   // 1.5 + 0 + 4.0 - 4.0 + 10.0
  ["Evolution", "2026-07-08", 5.0], // 10.0 + (5.0 - 10.0)
  ["Playtech", "2026-07-08", 5.0],  // 6.0 - 1.0
  ["Spribe", "2026-07-08", 3.0],
];

const pokerActivity = [
  // activity_id, account_id, game_id, kind, amount_in, amount_out, rake_or_fee, activity_ts, _op, _commit_ts
  ["P1", "A1002", "G6", "CASH_HAND", 5.0, 9.7, 0.3, "2026-07-08 11:00:00+00", "I", "2026-07-08 11:00:01+00"],
  ["P2", "A1001", "G7", "TOURNAMENT_ENTRY", 11.0, 40.0, 1.0, "2026-07-08 12:00:00+00", "I", "2026-07-08 12:00:01+00"],
  ["P3", "A2001", "G6", "CASH_HAND", 20.0, 0.0, 1.0, "2026-07-08 11:30:00+00", "I", "2026-07-08 11:30:01+00"],
  ["P4", "A2002", "G7", "TOURNAMENT_ENTRY", 55.0, 0.0, 5.0, "2026-07-08 12:30:00+00", "I", "2026-07-08 12:30:01+00"],
];

const jackpotPools = [
  // jackpot_id, jackpot_name, provider, seed_amount, contribution_rate
  ["JP1", "Mega Fortune Mega", "NetEnt", 100000.0, 0.01],
];

const jackpotWins = [
  // win_id, jackpot_id, account_id, amount, win_ts
  // Pool pays out (seed + almost all contributions); balance stays >= 0
  ["W1", "JP1", "A2002", 100000.10, "2026-07-08 10:10:05+00"],
];

// column name + logical type per table ('ts' = tz-aware timestamp,
// 'num' = decimal, 'str' = text). Generators map to engine types.
const tables = {
  cdc_accounts: {
    rows: accounts,
    columns: [
      ["account_id", "str"], ["jurisdiction", "str"], ["national_id", "str"],
      ["date_of_birth", "date"], ["kyc_status", "str"], ["opened_at", "ts"],
      ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_fixtures: {
    rows: fixtures,
    columns: [
      ["fixture_id", "str"], ["sport_name_raw", "str"], ["competition_raw", "str"],
      ["home_raw", "str"], ["away_raw", "str"], ["start_ts", "ts"],
      ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_bet_slips: {
    rows: betSlips,
    columns: [
      ["slip_id", "str"], ["account_id", "str"], ["fixture_id", "str"],
      ["product", "str"], ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_reg_attributes: {
    rows: regAttributes,
    columns: [
      ["entity_type", "str"], ["entity_id", "str"], ["attr_name", "str"],
      ["attr_value", "str"], ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_bet_slip_events: {
    rows: betSlipEvents,
    columns: [
      ["slip_id", "str"], ["event_type", "str"], ["event_ts", "ts"],
      ["stake", "num"], ["payout", "num"], ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_games: {
    rows: games,
    columns: [
      ["game_id", "str"], ["game_name", "str"], ["provider", "str"],
      ["provider_game_ref", "str"], ["game_type_raw", "str"],
      ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_netent_rounds: {
    rows: netentRounds,
    columns: [
      ["round_ref", "str"], ["player_ref", "str"], ["game_ref", "str"],
      ["bet_amount", "num"], ["win_amount", "num"], ["jp_contribution", "num"],
      ["jp_id", "str"], ["round_ts", "ts"], ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_evolution_transactions: {
    rows: evolutionTransactions,
    columns: [
      ["tx_id", "str"], ["round_ref", "str"], ["player_ref", "str"],
      ["table_ref", "str"], ["tx_type", "str"], ["amount_cents", "num"],
      ["tx_ts", "ts"], ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_playtech_rounds: {
    rows: playtechRounds,
    columns: [
      ["round_ref", "str"], ["player_ref", "str"], ["game_code", "str"],
      ["stake", "num"], ["payout", "num"], ["round_ts", "ts"],
      ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_aggregator_rounds: {
    rows: aggregatorRounds,
    columns: [
      ["round_ref", "str"], ["sub_provider", "str"], ["player_ref", "str"],
      ["game_ref", "str"], ["bet", "num"], ["win", "num"], ["round_ts", "ts"],
      ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_player_limits: {
    rows: playerLimits,
    columns: [
      ["limit_id", "str"], ["account_id", "str"], ["limit_type", "str"],
      ["amount", "num"], ["set_at", "ts"], ["revoked_at", "ts"],
      ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_self_exclusions: {
    rows: selfExclusions,
    columns: [
      ["exclusion_id", "str"], ["account_id", "str"], ["source", "str"],
      ["start_ts", "ts"], ["end_ts", "ts"], ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_verifications: {
    rows: verifications,
    columns: [
      ["verification_id", "str"], ["account_id", "str"], ["check_type", "str"],
      ["status", "str"], ["event_ts", "ts"], ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_payments: {
    rows: payments,
    columns: [
      ["payment_id", "str"], ["account_id", "str"], ["direction", "str"],
      ["amount", "num"], ["method", "str"], ["status", "str"],
      ["requested_ts", "ts"], ["completed_ts", "ts"],
      ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_provider_statements: {
    rows: providerStatements,
    columns: [
      ["provider", "str"], ["statement_date", "date"], ["reported_ggr", "num"],
    ],
  },
  cdc_poker_activity: {
    rows: pokerActivity,
    columns: [
      ["activity_id", "str"], ["account_id", "str"], ["game_id", "str"],
      ["kind", "str"], ["amount_in", "num"], ["amount_out", "num"],
      ["rake_or_fee", "num"], ["activity_ts", "ts"], ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_jackpot_pools: {
    rows: jackpotPools,
    columns: [
      ["jackpot_id", "str"], ["jackpot_name", "str"], ["provider", "str"],
      ["seed_amount", "num"], ["contribution_rate", "num"],
    ],
  },
  cdc_jackpot_wins: {
    rows: jackpotWins,
    columns: [
      ["win_id", "str"], ["jackpot_id", "str"], ["account_id", "str"],
      ["amount", "num"], ["win_ts", "ts"],
    ],
  },
  cdc_operator_jackpot_pools: {
    rows: operatorJackpotPools,
    columns: [
      ["jackpot_id", "str"], ["jackpot_name", "str"], ["seed_amount", "num"],
    ],
  },
  cdc_jackpot_optins: {
    rows: jackpotOptins,
    columns: [
      ["optin_id", "str"], ["account_id", "str"], ["jackpot_id", "str"],
      ["opted_in_at", "ts"], ["opted_out_at", "ts"], ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_operator_jackpot_contributions: {
    rows: operatorJackpotContributions,
    columns: [
      ["contribution_id", "str"], ["account_id", "str"], ["jackpot_id", "str"],
      ["game_id", "str"], ["trigger_type", "str"], ["trigger_ref", "str"],
      ["amount", "num"], ["contributed_at", "ts"], ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_operator_jackpot_wins: {
    rows: operatorJackpotWins,
    columns: [
      ["win_id", "str"], ["jackpot_id", "str"], ["account_id", "str"],
      ["game_id", "str"], ["amount", "num"], ["win_ts", "ts"], ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_game_round_voids: {
    rows: gameRoundVoids,
    columns: [
      ["round_id", "str"], ["voided_at", "ts"],
    ],
  },
  cdc_account_addresses: {
    rows: accountAddresses,
    columns: [
      ["account_id", "str"], ["postcode", "str"], ["city", "str"],
      ["_op", "str"], ["_commit_ts", "ts"],
    ],
  },
  cdc_postcode_regions: {
    rows: postcodeRegions,
    columns: [
      ["postcode_prefix", "str"], ["region_name", "str"],
    ],
  },
  cdc_source_watermarks: {
    rows: sourceWatermarks,
    columns: [
      ["source", "str"], ["jurisdiction", "str"], ["complete_through", "ts"],
    ],
  },
  cdc_exception_state: {
    rows: exceptionState,
    columns: [
      ["entity_type", "str"], ["entity_id", "str"], ["reason_code", "str"],
      ["error_class", "str"], ["attempt_count", "num"], ["first_seen", "ts"],
      ["next_retry_at", "ts"], ["status", "str"],
    ],
  },
};

module.exports = { tables };
