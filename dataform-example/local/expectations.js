// ============================================================================
// INTEGRATION EXPECTATIONS — the README's "expected results" as executable
// checks, run by local/run.js against the DuckDB pipeline output.
// Adding a domain/market? Add its expectations here; the offline run is
// your definition of done before touching BigQuery.
// ============================================================================

const expectations = [
  {
    desc: "lifecycle: 18 slips with correct statuses (incl. DK/BG/GR/NL/DE, BG 2025 resubmission + 5 fault-isolation demo slips)",
    sql: `SELECT slip_status, COUNT(*)::INT AS n FROM fct_bet_slip_lifecycle
          GROUP BY slip_status ORDER BY slip_status`,
    expect: [
      { slip_status: "OPEN", n: 1 },
      { slip_status: "SETTLED", n: 15 }, // 9 + 5 fault-isolation demo + S13 (DE)
      { slip_status: "VOIDED", n: 2 },
    ],
  },
  {
    desc: "lifecycle: void wins over settlement — S5 payout forced to 0",
    sql: `SELECT slip_status, CAST(payout AS DOUBLE) AS payout
          FROM fct_bet_slip_lifecycle WHERE slip_id = 'S5'`,
    expect: [{ slip_status: "VOIDED", payout: 0 }],
  },
  {
    desc: "MT file: 3 rows (2 settled + 1 void), correct MGA sport codes",
    sql: `SELECT slip_id, slip_status, sport_code FROM submission_ready_mt ORDER BY slip_id`,
    expect: [
      { slip_id: "S1", slip_status: "SETTLED", sport_code: "01" },
      { slip_id: "S2", slip_status: "VOIDED", sport_code: "01" },
      { slip_id: "S3", slip_status: "SETTLED", sport_code: "02" },
    ],
  },
  {
    desc: "ES file: exactly S4 — voids and open slips excluded",
    sql: `SELECT slip_id, sport_code FROM submission_ready_es`,
    expect: [{ slip_id: "S4", sport_code: "FUT" }],
  },
  {
    desc: "nomenclature: messy ' FÚTBOL ' + aliases canonicalised into ES event name",
    sql: `SELECT event_name FROM submission_ready_es`,
    expect: [{ event_name: "Real Madrid - Barcelona" }],
  },
  {
    desc: "nomenclature: MT event name uses MT template and canonical participants",
    sql: `SELECT event_name FROM submission_ready_mt WHERE slip_id = 'S1'`,
    expect: [{ event_name: "Manchester United v Chelsea" }],
  },
  {
    desc: "unmapped queue: Kabaddi surfaced with 1 slip affected (S6, open)",
    sql: `SELECT sport_name_raw, slips_affected::INT AS slips_affected FROM unmapped_sports`,
    expect: [{ sport_name_raw: "Kabaddi", slips_affected: 1 }],
  },
  {
    desc: "MT tax (2026-07-08): stake 15.00, payout 8.00, tax_due 0.35",
    sql: `SELECT CAST(total_stake AS DOUBLE) AS s, CAST(total_payout AS DOUBLE) AS p,
                 CAST(tax_due AS DOUBLE) AS t
          FROM tax_summary_mt WHERE report_date = DATE '2026-07-08'`,
    expect: [{ s: 15, p: 8, t: 0.35 }],
  },
  {
    desc: "ES tax (2026-07-08): stake 50.00, payout 40.00, tax_due 2.00",
    sql: `SELECT CAST(total_stake AS DOUBLE) AS s, CAST(total_payout AS DOUBLE) AS p,
                 CAST(tax_due AS DOUBLE) AS t
          FROM tax_summary_es WHERE report_date = DATE '2026-07-08'`,
    expect: [{ s: 50, p: 40, t: 2 }],
  },
  {
    desc: "CDC dedupe: replayed S1 PLACED event collapsed to one row",
    sql: `SELECT COUNT(*)::INT AS n FROM stg_bet_slip_events
          WHERE slip_id = 'S1' AND event_type = 'PLACED'`,
    expect: [{ n: 1 }],
  },

  // ---- GAMING domain ----
  {
    desc: "gaming MT file: 9 PROVIDER activities from 4 feeds, ids provider-namespaced — MGA Type 1 for house games, Type 3 for poker",
    sql: `SELECT activity_id, game_code, vertical FROM gaming_submission_ready_mt
          WHERE vertical IN ('CASINO_ROUND', 'POKER_CASH', 'POKER_TOURNAMENT')
          ORDER BY activity_id`,
    expect: [
      { activity_id: "AG:R6", game_code: "1", vertical: "CASINO_ROUND" }, // Spribe via aggregator
      { activity_id: "EV:R2", game_code: "1", vertical: "CASINO_ROUND" },
      { activity_id: "EV:R5", game_code: "1", vertical: "CASINO_ROUND" },
      { activity_id: "NE:R1", game_code: "1", vertical: "CASINO_ROUND" },
      { activity_id: "NE:R3", game_code: "1", vertical: "CASINO_ROUND" },
      { activity_id: "NE:R4", game_code: "1", vertical: "CASINO_ROUND" },
      { activity_id: "P1", game_code: "3", vertical: "POKER_CASH" },
      { activity_id: "P2", game_code: "3", vertical: "POKER_TOURNAMENT" },
      { activity_id: "PT:R9", game_code: "1", vertical: "CASINO_ROUND" },
    ],
  },
  {
    desc: "provider adapters: Evolution BET/WIN cent-transactions aggregated to one euro-round (500+1000 cents -> 5.00/10.00)",
    sql: `SELECT provider, CAST(wager AS DOUBLE) AS wager, CAST(payout AS DOUBLE) AS payout
          FROM stg_game_rounds WHERE round_id = 'EV:R5'`,
    expect: [{ provider: "Evolution", wager: 5, payout: 10 }],
  },
  {
    desc: "provider adapters: CDC transaction replay (duplicate tx_id) deduped — Evolution R5 wager stays 5.00 not 10.00",
    sql: `SELECT COUNT(*)::INT AS n FROM stg_game_rounds WHERE round_id = 'EV:R5' AND wager = 5.00`,
    expect: [{ n: 1 }],
  },
  {
    desc: "provider spread: rounds normalised from NetEnt(5), Evolution(2), Playtech(1), Spribe-via-aggregator(1)",
    sql: `SELECT provider, COUNT(*)::INT AS rounds FROM stg_game_rounds GROUP BY provider ORDER BY provider`,
    expect: [
      { provider: "Evolution", rounds: 2 },
      { provider: "NetEnt", rounds: 5 },
      { provider: "Playtech", rounds: 1 },
      { provider: "Spribe", rounds: 1 },
    ],
  },
  {
    desc: "provider revenue-share recon: internal GGR matches every provider statement (zero breaks/disputes)",
    sql: `SELECT COUNT(*)::INT AS breaks FROM recon_provider_ggr`,
    expect: [{ breaks: 0 }],
  },
  {
    desc: "gaming ES file: 4 activities with DGOJ singular-licence codes (MAZ/POC/POT), no baccarat, no crash",
    sql: `SELECT activity_id, game_code FROM gaming_submission_ready_es ORDER BY activity_id`,
    expect: [
      { activity_id: "NE:R7", game_code: "MAZ" },
      { activity_id: "NE:R8", game_code: "MAZ" },
      { activity_id: "P3", game_code: "POC" },
      { activity_id: "P4", game_code: "POT" },
    ],
  },
  {
    desc: "gaming GGR mechanics: poker rows earn rake/fee only; jackpot slot row deducts the 1% pool contribution (MT policy)",
    sql: `SELECT activity_id, CAST(gaming_ggr AS DOUBLE) AS ggr FROM gaming_submission_ready_mt
          WHERE activity_id IN ('P1','P2','NE:R4') ORDER BY activity_id`,
    expect: [
      { activity_id: "NE:R4", ggr: 3.96 }, // 4.00 wager - 0 payout - 0.04 contribution
      { activity_id: "P1", ggr: 0.3 },  // cash-game rake
      { activity_id: "P2", ggr: 1 },    // tournament fee (not the 40.00 winnings)
    ],
  },
  {
    desc: "gaming MT tax (MGA 5% of GGR): provider GGR 19.76 + operator-jackpot GGR 6.00 (contributions 9 - wins 3) = 25.76 -> tax 1.29",
    sql: `SELECT CAST(total_ggr AS DOUBLE) AS g, CAST(gaming_tax_due AS DOUBLE) AS t
          FROM gaming_tax_summary_mt WHERE report_date = DATE '2026-07-08'`,
    expect: [{ g: 25.76, t: 1.29 }],
  },
  {
    desc: "gaming ES tax (DGOJ 20% of GGR, contributions gross): total GGR 12.00 -> tax 2.40",
    sql: `SELECT CAST(total_ggr AS DOUBLE) AS g, CAST(gaming_tax_due AS DOUBLE) AS t
          FROM gaming_tax_summary_es WHERE report_date = DATE '2026-07-08'`,
    expect: [{ g: 12, t: 2.4 }],
  },
  {
    desc: "jackpot liability: seed 100000 + 0.14 contributions - 100000.10 win = 0.04 pool balance (never negative)",
    sql: `SELECT CAST(pool_balance AS DOUBLE) AS balance FROM fct_jackpot_liability WHERE jackpot_id = 'JP1'`,
    expect: [{ balance: 0.04 }],
  },
  {
    desc: "jackpot contribution rate honoured: every contribution = wager * 1% pool rate",
    sql: `SELECT COUNT(*)::INT AS bad FROM stg_game_rounds r
          JOIN cdc_jackpot_pools p ON r.jackpot_id = p.jackpot_id
          WHERE ABS(r.jackpot_contribution - r.wager * p.contribution_rate) > 0.005`,
    expect: [{ bad: 0 }],
  },
  {
    desc: "gaming unmapped queue: Spribe's 'Crash' category surfaced with 1 activity affected",
    sql: `SELECT game_type_raw, provider, activities_affected::INT AS activities_affected FROM unmapped_game_types`,
    expect: [{ game_type_raw: "Crash", provider: "Spribe", activities_affected: 1 }],
  },

  // ---- OPERATOR-DRIVEN OPT-IN JACKPOT (piggyback product) ----
  {
    desc: "operator jackpot: contributions (wagers) + win booked into the MT gaming file, correlated to the phantom game as MGA Type 1",
    sql: `SELECT activity_id, vertical, game_code,
                 CAST(stake AS DOUBLE) AS stake, CAST(payout AS DOUBLE) AS payout
          FROM gaming_submission_ready_mt WHERE vertical = 'OPERATOR_JACKPOT' ORDER BY activity_id`,
    expect: [
      { activity_id: "OJC1", vertical: "OPERATOR_JACKPOT", game_code: "1", stake: 5, payout: 0 }, // gaming-triggered contribution
      { activity_id: "OJC2", vertical: "OPERATOR_JACKPOT", game_code: "1", stake: 4, payout: 0 }, // sports-triggered contribution
      { activity_id: "OJW1", vertical: "OPERATOR_JACKPOT", game_code: "1", stake: 0, payout: 3 }, // the win (payout)
    ],
  },
  {
    desc: "operator jackpot: ACTIVE contribution triggers span BOTH a provider game round AND a sports bet (one unified balance)",
    sql: `SELECT trigger_type, COUNT(*)::INT AS n FROM fct_operator_jackpot_contributions
          WHERE status = 'ACTIVE' GROUP BY trigger_type ORDER BY trigger_type`,
    expect: [
      { trigger_type: "GAMING_ROUND", n: 1 },
      { trigger_type: "SPORTS_BET", n: 1 },
    ],
  },
  {
    desc: "void/refund cascade: contributions on voided triggers (bet S2, rolled-back round NE:R99) are REFUNDED; 2 ACTIVE remain",
    sql: `SELECT status, COUNT(*)::INT AS n FROM fct_operator_jackpot_contributions
          GROUP BY status ORDER BY status`,
    expect: [
      { status: "ACTIVE", n: 2 },
      { status: "REFUNDED", n: 2 },
    ],
  },
  {
    desc: "void/refund cascade: refunded contributions (6+7=13) reversed out — pool counts only the 9 active, balance 506",
    sql: `SELECT CAST(total_contributions AS DOUBLE) AS contribs, CAST(pool_balance AS DOUBLE) AS balance
          FROM fct_operator_jackpot_liability WHERE jackpot_id = 'OJP1'`,
    expect: [{ contribs: 9, balance: 506 }],
  },
  {
    desc: "void/refund cascade: refunded contributions never reach the gaming file (GGR/tax/loss unaffected)",
    sql: `SELECT COUNT(*)::INT AS n FROM gaming_submission_ready_mt WHERE activity_id IN ('OJC3', 'OJC4')`,
    expect: [{ n: 0 }],
  },
  {
    desc: "unified wallet: opt-in jackpot money movements for A1001 — 2 contribution DEBITS (-9) and 1 win CREDIT (+3); refunded ones never debited",
    sql: `SELECT entry_type, COUNT(*)::INT AS n, CAST(SUM(signed_amount) AS DOUBLE) AS total
          FROM fct_wallet_ledger
          WHERE account_id = 'A1001' AND entry_type IN ('JACKPOT_CONTRIBUTION', 'JACKPOT_WIN')
          GROUP BY entry_type ORDER BY entry_type`,
    expect: [
      { entry_type: "JACKPOT_CONTRIBUTION", n: 2, total: -9 },
      { entry_type: "JACKPOT_WIN", n: 1, total: 3 },
    ],
  },
  {
    desc: "wallet ↔ pool reconciliation: opt-in jackpot wallet debits (9) match the pool's active contributions (9)",
    sql: `SELECT
            CAST((SELECT -SUM(signed_amount) FROM fct_wallet_ledger WHERE entry_type = 'JACKPOT_CONTRIBUTION') AS DOUBLE) AS wallet_debits,
            CAST((SELECT total_contributions FROM fct_operator_jackpot_liability WHERE jackpot_id = 'OJP1') AS DOUBLE) AS pool_contributions`,
    expect: [{ wallet_debits: 9, pool_contributions: 9 }],
  },
  {
    desc: "unified balance: A1001's wallet across deposits, settled bets and all gaming (incl. active jackpot) = 67.50",
    sql: `SELECT CAST(balance AS DOUBLE) AS balance FROM dim_wallet_balance WHERE account_id = 'A1001'`,
    expect: [{ balance: 67.5 }],
  },

  // ---- PLAYER PROTECTION & PAYMENTS ----
  {
    desc: "payments: completed deposits/withdrawals per market (blocked/held A2003 payments excluded)",
    sql: `SELECT jurisdiction, direction, CAST(SUM(amount) AS DOUBLE) AS total
          FROM fct_payments WHERE status = 'COMPLETED'
          GROUP BY 1, 2 ORDER BY 1, 2`,
    expect: [
      { jurisdiction: "BG", direction: "DEPOSIT", total: 600 },   // A4001 100 + A4002 500 (2025)
      { jurisdiction: "DE", direction: "DEPOSIT", total: 300 },   // funds A9001, under LUGAS 1000/month
      { jurisdiction: "DK", direction: "DEPOSIT", total: 200 },   // funds A3001's wallet
      { jurisdiction: "ES", direction: "DEPOSIT", total: 640 },   // 90 + 550
      { jurisdiction: "ES", direction: "WITHDRAWAL", total: 20 },
      { jurisdiction: "GR", direction: "DEPOSIT", total: 1000 },  // funds A5001's wallet
      { jurisdiction: "MT", direction: "DEPOSIT", total: 350 },   // 200 + 50 + 5x20 demo fundings
      { jurisdiction: "MT", direction: "WITHDRAWAL", total: 150 },
      { jurisdiction: "NL", direction: "DEPOSIT", total: 150 },   // funds A6001's wallet
    ],
  },
  {
    desc: "effective daily limits: personal-vs-default resolution per player (NULL = no cap, MT has no statutory default)",
    sql: `SELECT account_id, CAST(personal_limit AS DOUBLE) AS personal, CAST(default_limit AS DOUBLE) AS deflt,
                 CAST(effective_limit AS DOUBLE) AS effective
          FROM rg_effective_deposit_limits
          WHERE period = 'DAILY' AND account_id IN ('A1001','A1002','A2001','A2002','A2003')
          ORDER BY account_id`,
    expect: [
      { account_id: "A1001", personal: 500, deflt: null, effective: 500 }, // MT: personal only
      { account_id: "A1002", personal: null, deflt: null, effective: null }, // MT: no cap
      { account_id: "A2001", personal: 100, deflt: 600, effective: 100 },  // tighter personal wins
      { account_id: "A2002", personal: null, deflt: 600, effective: 600 }, // ES statutory default
      { account_id: "A2003", personal: null, deflt: 600, effective: 600 },
    ],
  },
  {
    desc: "limit lifecycle: A2001's revoked 200/day limit superseded by the active 100/day",
    sql: `SELECT CAST(personal_daily_limit AS DOUBLE) AS lim FROM dim_player_compliance WHERE account_id = 'A2001'`,
    expect: [{ lim: 100 }],
  },
  {
    desc: "player compliance: A2003 unverified with an open RGIAJ exclusion; A1002's ended OPERATOR exclusion not open",
    sql: `SELECT account_id, verification_status, open_exclusion_source
          FROM dim_player_compliance WHERE account_id IN ('A2003', 'A1002', 'A2002') ORDER BY account_id`,
    expect: [
      { account_id: "A1002", verification_status: "VERIFIED", open_exclusion_source: null },
      { account_id: "A2002", verification_status: "VERIFIED", open_exclusion_source: null },
      { account_id: "A2003", verification_status: "PENDING", open_exclusion_source: "RGIAJ" },
    ],
  },
  {
    desc: "quarantine-first: the only breach (A7003 bet-while-excluded) does NOT abort the run — it becomes a per-entity HOLD; the other five detectors are empty",
    sql: `SELECT
            (SELECT COUNT(*) FROM rg_breach_deposit_limits)::INT AS limit_breaches,
            (SELECT COUNT(*) FROM rg_breach_loss_limits)::INT AS loss_breaches,
            (SELECT COUNT(*) FROM rg_breach_wallet_overspend)::INT AS overspend_breaches,
            (SELECT COUNT(*) FROM rg_breach_activity_while_excluded)::INT AS exclusion_breaches,
            (SELECT COUNT(*) FROM rg_breach_unverified_withdrawals)::INT AS kyc_breaches,
            (SELECT COUNT(*) FROM rg_breach_stake_limits)::INT AS stake_breaches`,
    expect: [{ limit_breaches: 0, loss_breaches: 0, overspend_breaches: 0, exclusion_breaches: 1, kyc_breaches: 0, stake_breaches: 0 }],
  },

  // ---- MAX STAKE LIMITS (REQ: requirements/max-stake-limits) ----
  {
    desc: "stake limits REFERENCE (REQ-MSL-6): every statutory slots band from config — MT staggered like UKGC; DE's REAL GGL progression (EUR 1 flat 2021-2026 -> EUR 1 under-21 / EUR 3 for 21+ from 1 Jul 2026); BG/GR none",
    sql: `SELECT jurisdiction, CAST(max_stake AS DOUBLE) AS cap, min_age::INT AS min_age,
                 max_age::INT AS max_age, CAST(valid_from AS VARCHAR) AS from_date
          FROM ref_stake_limits ORDER BY jurisdiction, min_age, valid_from`,
    expect: [
      { jurisdiction: "DE", cap: 1, min_age: 18, max_age: null, from_date: "2021-07-01" },
      { jurisdiction: "DE", cap: 1, min_age: 18, max_age: 20, from_date: "2026-07-01" },
      { jurisdiction: "DE", cap: 3, min_age: 21, max_age: null, from_date: "2026-07-01" },
      { jurisdiction: "DK", cap: 7.5, min_age: 18, max_age: null, from_date: "2026-08-01" },
      { jurisdiction: "ES", cap: 10, min_age: 18, max_age: null, from_date: "2026-08-01" },
      { jurisdiction: "MT", cap: 5, min_age: 18, max_age: null, from_date: "2026-08-01" },
      { jurisdiction: "MT", cap: 2, min_age: 18, max_age: 24, from_date: "2026-09-15" },
      { jurisdiction: "NL", cap: 5, min_age: 18, max_age: null, from_date: "2026-08-01" },
    ],
  },
  {
    desc: "stake limits (REQ-MSL-2): A1001's personal STAKE_CASINO 30 is live via the untouched player-limits machinery; the young account A8001 (dob 2005) exists for the 18-24 band",
    sql: `SELECT
            (SELECT CAST(MIN(amount) AS DOUBLE) FROM stg_player_limits
             WHERE account_id = 'A1001' AND limit_type = 'STAKE_CASINO' AND revoked_at IS NULL) AS personal_cap,
            (SELECT CAST(date_of_birth AS VARCHAR) FROM dim_customer_account
             WHERE account_id = 'A8001') AS young_dob`,
    expect: [{ personal_cap: 30, young_dob: "2005-03-15" }],
  },

  // ---- FAULT ISOLATION, DATA READINESS & THE EXCEPTION FLOW ----
  // One bad/late/held row affects only itself; everyone else's file still ships.
  {
    desc: "fault isolation HEADLINE: 5 demo accounts are quarantined/held/incomplete, yet the MT file still ships its 3 real rows — the run is NOT aborted",
    sql: `SELECT
            (SELECT COUNT(*) FROM submission_ready_mt)::INT AS mt_file_rows,
            (SELECT COUNT(DISTINCT entity_id) FROM fct_exceptions)::INT AS entities_isolated`,
    expect: [{ mt_file_rows: 3, entities_isolated: 5 }],
  },
  {
    desc: "exception routing: each failure is routed by WHY it failed (DATA quarantine / TRANSIENT retry / COMPLIANCE hold / COMPLETENESS wait / escalated)",
    sql: `SELECT entity_id, error_class, status, reason_code
          FROM fct_exceptions ORDER BY entity_id, reason_code`,
    expect: [
      { entity_id: "A7001", error_class: "DATA", status: "QUARANTINED", reason_code: "postcode_format" },
      { entity_id: "A7002", error_class: "TRANSIENT", status: "RETRYING", reason_code: "region_not_found" },
      { entity_id: "A7003", error_class: "COMPLIANCE", status: "HELD", reason_code: "activity_while_excluded" },
      { entity_id: "A7004", error_class: "COMPLETENESS", status: "WAITING_DATA", reason_code: "period_not_complete" },
      { entity_id: "A7005", error_class: "TRANSIENT", status: "QUARANTINED", reason_code: "region_not_found" },
    ],
  },
  {
    desc: "retry with backoff: A7002 advances a retry (attempt 3, still RETRYING); A7005 exhausts MAX(5) and ESCALATES to QUARANTINED (attempt 6); A1001's late data arrived -> RESOLVED",
    sql: `SELECT entity_id, status, attempt_count::INT AS attempt
          FROM ops_exception_state_next ORDER BY entity_id`,
    expect: [
      { entity_id: "A1001", status: "RESOLVED", attempt: 1 },
      { entity_id: "A7002", status: "RETRYING", attempt: 3 },
      { entity_id: "A7005", status: "QUARANTINED", attempt: 6 },
    ],
  },
  {
    desc: "data readiness (differential speed): MT period 2026-07-08 is closed (ready); 2026-07-10 is not complete yet, so A7004 waits instead of shipping a partial file",
    sql: `SELECT CAST(report_date AS VARCHAR) AS report_date, is_ready
          FROM rg_period_readiness WHERE jurisdiction = 'MT' ORDER BY report_date`,
    expect: [
      { report_date: "2026-07-08", is_ready: true },
      { report_date: "2026-07-10", is_ready: false },
    ],
  },
  {
    desc: "late vs nonexistent: S6 is OPEN, so its settlement legitimately DOES NOT EXIST — it is correctly absent from the file and is NOT an exception (absence proven by state, not inferred from a missing row)",
    sql: `SELECT
            (SELECT slip_status FROM fct_bet_slip_lifecycle WHERE slip_id = 'S6') AS s6_status,
            (SELECT COUNT(*) FROM submission_ready_mt WHERE slip_id = 'S6')::INT AS s6_in_file,
            (SELECT COUNT(*) FROM fct_exceptions WHERE entity_id = 'A2002')::INT AS s6_account_exceptions`,
    expect: [{ s6_status: "OPEN", s6_in_file: 0, s6_account_exceptions: 0 }],
  },
  {
    desc: "loss base: operator-jackpot contributions/win are part of A1001's gambling-activity fact (net 5+4-3 = 6) — so they count toward loss limits",
    sql: `SELECT COUNT(*)::INT AS rows, CAST(SUM(stake - payout) AS DOUBLE) AS net
          FROM fct_player_gambling_activity
          WHERE account_id = 'A1001' AND source = 'OPERATOR_JACKPOT'`,
    expect: [{ rows: 3, net: 6 }],
  },

  // ---- NEW MARKETS via the extension layer (Option B) ----
  // Each new market's bespoke data reaches its file WITHOUT any change to the
  // shared core model — proving the architecture's extensibility claim.
  {
    desc: "DK file: S7 with Spillemyndigheden sport code + SAFE TamperToken carried via the generic attribute carrier",
    sql: `SELECT slip_id, slip_status, sport_code, safe_tampertoken FROM submission_ready_dk ORDER BY slip_id`,
    expect: [{ slip_id: "S7", slip_status: "SETTLED", sport_code: "1", safe_tampertoken: "TT-0000A7F3" }],
  },
  {
    desc: "DK tax (Spillemyndigheden 28% of GGR, monthly): stake 100, payout 60, tax_due 11.20",
    sql: `SELECT CAST(total_stake AS DOUBLE) AS s, CAST(total_payout AS DOUBLE) AS p,
                 CAST(tax_due AS DOUBLE) AS t
          FROM tax_summary_dk WHERE report_date = DATE '2026-07-08'`,
    expect: [{ s: 100, p: 60, t: 11.2 }],
  },
  {
    desc: "BG file: effective-dated football code — S12 (2025) resolves to FUT, S8 (2026) to the revised FTB",
    sql: `SELECT slip_id, sport_code, nra_registration_id FROM submission_ready_bg ORDER BY slip_id`,
    expect: [
      { slip_id: "S12", sport_code: "FUT", nra_registration_id: "BG-2025-000000043" }, // 2025 code
      { slip_id: "S8", sport_code: "FTB", nra_registration_id: "BG-2026-000000042" },  // revised 2026 code
    ],
  },
  {
    desc: "BG carrier: CDC-replayed NRA registration for S8 deduped to one row",
    sql: `SELECT COUNT(*)::INT AS n FROM stg_reg_attributes
          WHERE entity_id = 'S8' AND attr_name = 'nra_registration_id'`,
    expect: [{ n: 1 }],
  },
  {
    desc: "BG tax (2026): GGR 30 at the effective 25% rate -> tax_due 7.50",
    sql: `SELECT CAST(total_stake AS DOUBLE) AS s, CAST(total_payout AS DOUBLE) AS p,
                 CAST(tax_due AS DOUBLE) AS t
          FROM tax_summary_bg WHERE report_date = DATE '2026-07-08'`,
    expect: [{ s: 50, p: 20, t: 7.5 }],
  },
  {
    desc: "BG tax EFFECTIVE-DATING: a 2025 resubmission (GGR 60) uses the historical 20% rate -> tax_due 12.00, not 15.00",
    sql: `SELECT CAST(total_stake AS DOUBLE) AS s, CAST(total_payout AS DOUBLE) AS p,
                 CAST(tax_due AS DOUBLE) AS t
          FROM tax_summary_bg WHERE report_date = DATE '2025-12-15'`,
    expect: [{ s: 100, p: 40, t: 12 }],
  },
  {
    desc: "GR file: per-slip player-winnings withholding computed from the HGC tiered scale (600 -> 25.00; loss -> 0)",
    sql: `SELECT slip_id, CAST(winnings_withholding_tax AS DOUBLE) AS w
          FROM submission_ready_gr ORDER BY slip_id`,
    expect: [
      { slip_id: "S10", w: 0 },  // losing slip, no winnings
      { slip_id: "S9", w: 25 },  // 2.5% of 100 + 5% of 300 + 7.5% of 100
    ],
  },
  {
    desc: "GR operator tax (HGC 35% of GGR): stake 800, payout 600, tax_due 70.00",
    sql: `SELECT CAST(total_stake AS DOUBLE) AS s, CAST(total_payout AS DOUBLE) AS p,
                 CAST(tax_due AS DOUBLE) AS t
          FROM tax_summary_gr WHERE report_date = DATE '2026-07-08'`,
    expect: [{ s: 800, p: 600, t: 70 }],
  },
  {
    desc: "NL file: S11 with KSA sport code + BOTH NL controls (CRUKS check + CDB record) via the carrier",
    sql: `SELECT slip_id, sport_code, cruks_check_ref, cdb_record_id FROM submission_ready_nl`,
    expect: [{ slip_id: "S11", sport_code: "VB", cruks_check_ref: "CRUKS-00B4D2F1", cdb_record_id: "NL-CDB-0000000042" }],
  },
  {
    desc: "NL tax (kansspelbelasting 37.8% of GGR from 2026, monthly): stake 80, payout 30, tax_due 18.90",
    sql: `SELECT CAST(total_stake AS DOUBLE) AS s, CAST(total_payout AS DOUBLE) AS p,
                 CAST(tax_due AS DOUBLE) AS t
          FROM tax_summary_nl WHERE report_date = DATE '2026-07-08'`,
    expect: [{ s: 80, p: 30, t: 18.9 }],
  },

  // ---- GERMANY (GGL) — the 7th market, REQ: de-regulator-addition ----
  {
    desc: "DE file: S13 with GGL sport code, pseudonymised LUGAS player id and the per-bet LUGAS activity reference (both via the extension layer)",
    sql: `SELECT slip_id, sport_code, LENGTH(player_lugas_pseudonym)::INT AS pseudonym_len,
                 lugas_activity_id
          FROM submission_ready_de`,
    expect: [{ slip_id: "S13", sport_code: "FUSS", pseudonym_len: 64,
               lugas_activity_id: "LUGAS-3F2A9B4C1D6E" }],
  },
  {
    desc: "DE tax is TURNOVER-based (RennwLottG 5.3% of STAKES): stake 40 -> tax_due 2.12, NOT the 1.06 a GGR basis would give — the tax BASE is config",
    sql: `SELECT CAST(total_stake AS DOUBLE) AS s, CAST(total_payout AS DOUBLE) AS p,
                 CAST(tax_due AS DOUBLE) AS t
          FROM tax_summary_de WHERE report_date = DATE '2026-07-08'`,
    expect: [{ s: 40, p: 20, t: 2.12 }],
  },
  {
    desc: "DE statutory deposit default is MONTHLY-ONLY (LUGAS 1000/month): daily/weekly have no statutory arm, monthly resolves to 1000",
    sql: `SELECT period, CAST(default_limit AS DOUBLE) AS deflt
          FROM rg_effective_deposit_limits
          WHERE account_id = 'A9001' ORDER BY period`,
    expect: [
      { period: "DAILY", deflt: null },
      { period: "MONTHLY", deflt: 1000 },
      { period: "WEEKLY", deflt: null },
    ],
  },
];

module.exports = { expectations };
