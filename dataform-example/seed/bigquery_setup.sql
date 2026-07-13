-- GENERATED FILE — edit seed/data.js and run `node seed/generate.js`.

-- Seed data simulating the CDC landing layer. See README.md for the

-- lifecycle/nomenclature coverage and expected outputs.

CREATE SCHEMA IF NOT EXISTS cdc_landing;

CREATE OR REPLACE TABLE cdc_landing.cdc_accounts (account_id STRING, jurisdiction STRING, national_id STRING, kyc_status STRING, opened_at TIMESTAMP, _op STRING, _commit_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_accounts VALUES
  ('A1001', 'MT', '111', 'VERIFIED', TIMESTAMP '2025-01-10 09:00:00+00', 'I', TIMESTAMP '2025-01-10 09:00:01+00'),
  ('A1002', 'MT', '222', 'VERIFIED', TIMESTAMP '2025-03-02 14:30:00+00', 'I', TIMESTAMP '2025-03-02 14:30:01+00'),
  ('A2001', 'ES', '333', 'VERIFIED', TIMESTAMP '2025-02-20 11:00:00+00', 'I', TIMESTAMP '2025-02-20 11:00:01+00'),
  ('A2002', 'ES', '444', 'VERIFIED', TIMESTAMP '2025-05-15 16:45:00+00', 'I', TIMESTAMP '2025-05-15 16:45:01+00'),
  ('A2003', 'ES', '555', 'PENDING', TIMESTAMP '2026-05-01 10:00:00+00', 'I', TIMESTAMP '2026-05-01 10:00:01+00'),
  ('A1001', 'MT', '111', 'VERIFIED', TIMESTAMP '2025-01-10 09:00:00+00', 'U', TIMESTAMP '2026-07-01 08:00:00+00'),
  ('A3001', 'DK', 'DK-CPR-1001', 'VERIFIED', TIMESTAMP '2026-01-05 09:00:00+00', 'I', TIMESTAMP '2026-01-05 09:00:01+00'),
  ('A4001', 'BG', 'BG-EGN-2002', 'VERIFIED', TIMESTAMP '2026-02-05 09:00:00+00', 'I', TIMESTAMP '2026-02-05 09:00:01+00'),
  ('A5001', 'GR', 'GR-AFM-3003', 'VERIFIED', TIMESTAMP '2026-03-05 09:00:00+00', 'I', TIMESTAMP '2026-03-05 09:00:01+00'),
  ('A6001', 'NL', 'NL-BSN-4004', 'VERIFIED', TIMESTAMP '2026-04-05 09:00:00+00', 'I', TIMESTAMP '2026-04-05 09:00:01+00'),
  ('A4002', 'BG', 'BG-EGN-2005', 'VERIFIED', TIMESTAMP '2025-11-01 09:00:00+00', 'I', TIMESTAMP '2025-11-01 09:00:01+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_fixtures (fixture_id STRING, sport_name_raw STRING, competition_raw STRING, home_raw STRING, away_raw STRING, start_ts TIMESTAMP, _op STRING, _commit_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_fixtures VALUES
  ('F1', 'Soccer', 'Premier League', 'Man Utd', 'Chelsea FC', TIMESTAMP '2026-07-08 16:00:00+00', 'I', TIMESTAMP '2026-07-07 09:00:00+00'),
  ('F2', '  FÚTBOL ', 'La Liga', 'R Madrid', 'Barça', TIMESTAMP '2026-07-08 19:00:00+00', 'I', TIMESTAMP '2026-07-07 09:00:00+00'),
  ('F3', 'Lawn Tennis', 'Wimbledon', 'R. Nadal', 'N. Djokovic', TIMESTAMP '2026-07-08 17:00:00+00', 'I', TIMESTAMP '2026-07-07 09:00:00+00'),
  ('F4', 'Kabaddi', 'Pro Kabaddi League', 'Patna Pirates', 'Bengal Warriors', TIMESTAMP '2026-07-08 14:30:00+00', 'I', TIMESTAMP '2026-07-07 09:00:00+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_bet_slips (slip_id STRING, account_id STRING, fixture_id STRING, product STRING, _op STRING, _commit_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_bet_slips VALUES
  ('S1', 'A1001', 'F1', 'sports', 'I', TIMESTAMP '2026-07-08 10:00:00+00'),
  ('S2', 'A1001', 'F1', 'sports', 'I', TIMESTAMP '2026-07-08 11:00:00+00'),
  ('S3', 'A1002', 'F3', 'sports', 'I', TIMESTAMP '2026-07-08 12:00:00+00'),
  ('S4', 'A2001', 'F2', 'sports', 'I', TIMESTAMP '2026-07-08 13:00:00+00'),
  ('S5', 'A2002', 'F2', 'sports', 'I', TIMESTAMP '2026-07-08 14:00:00+00'),
  ('S6', 'A2002', 'F4', 'sports', 'I', TIMESTAMP '2026-07-08 15:00:00+00'),
  ('S7', 'A3001', 'F1', 'sports', 'I', TIMESTAMP '2026-07-08 10:00:00+00'),
  ('S8', 'A4001', 'F1', 'sports', 'I', TIMESTAMP '2026-07-08 10:00:00+00'),
  ('S9', 'A5001', 'F1', 'sports', 'I', TIMESTAMP '2026-07-08 10:00:00+00'),
  ('S10', 'A5001', 'F1', 'sports', 'I', TIMESTAMP '2026-07-08 10:00:00+00'),
  ('S11', 'A6001', 'F1', 'sports', 'I', TIMESTAMP '2026-07-08 10:00:00+00'),
  ('S12', 'A4002', 'F1', 'sports', 'I', TIMESTAMP '2025-12-15 10:00:00+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_reg_attributes (entity_type STRING, entity_id STRING, attr_name STRING, attr_value STRING, _op STRING, _commit_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_reg_attributes VALUES
  ('SLIP', 'S7', 'safe_tampertoken', 'TT-0000A7F3', 'I', TIMESTAMP '2026-07-08 18:00:05+00'),
  ('SLIP', 'S8', 'nra_registration_id', 'BG-2026-000000042', 'I', TIMESTAMP '2026-07-08 10:00:05+00'),
  ('SLIP', 'S8', 'nra_registration_id', 'BG-2026-000000042', 'I', TIMESTAMP '2026-07-08 10:05:00+00'),
  ('SLIP', 'S12', 'nra_registration_id', 'BG-2025-000000043', 'I', TIMESTAMP '2025-12-15 10:00:05+00'),
  ('SLIP', 'S11', 'cruks_check_ref', 'CRUKS-00B4D2F1', 'I', TIMESTAMP '2026-07-08 10:00:05+00'),
  ('SLIP', 'S11', 'cdb_record_id', 'NL-CDB-0000000042', 'I', TIMESTAMP '2026-07-08 10:00:05+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_bet_slip_events (slip_id STRING, event_type STRING, event_ts TIMESTAMP, stake NUMERIC, payout NUMERIC, _op STRING, _commit_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_bet_slip_events VALUES
  ('S1', 'PLACED', TIMESTAMP '2026-07-08 10:00:00+00', 10, NULL, 'I', TIMESTAMP '2026-07-08 10:00:01+00'),
  ('S1', 'SETTLED', TIMESTAMP '2026-07-08 18:00:00+00', NULL, 8, 'I', TIMESTAMP '2026-07-08 18:00:01+00'),
  ('S2', 'PLACED', TIMESTAMP '2026-07-08 11:00:00+00', 20, NULL, 'I', TIMESTAMP '2026-07-08 11:00:01+00'),
  ('S2', 'VOIDED', TIMESTAMP '2026-07-08 12:30:00+00', NULL, NULL, 'I', TIMESTAMP '2026-07-08 12:30:01+00'),
  ('S3', 'PLACED', TIMESTAMP '2026-07-08 12:00:00+00', 5, NULL, 'I', TIMESTAMP '2026-07-08 12:00:01+00'),
  ('S3', 'SETTLED', TIMESTAMP '2026-07-08 19:00:00+00', NULL, 0, 'I', TIMESTAMP '2026-07-08 19:00:01+00'),
  ('S4', 'PLACED', TIMESTAMP '2026-07-08 13:00:00+00', 50, NULL, 'I', TIMESTAMP '2026-07-08 13:00:01+00'),
  ('S4', 'SETTLED', TIMESTAMP '2026-07-08 20:00:00+00', NULL, 40, 'I', TIMESTAMP '2026-07-08 20:00:01+00'),
  ('S5', 'PLACED', TIMESTAMP '2026-07-08 14:00:00+00', 15, NULL, 'I', TIMESTAMP '2026-07-08 14:00:01+00'),
  ('S5', 'SETTLED', TIMESTAMP '2026-07-08 21:00:00+00', NULL, 60, 'I', TIMESTAMP '2026-07-08 21:00:01+00'),
  ('S5', 'VOIDED', TIMESTAMP '2026-07-09 08:00:00+00', NULL, NULL, 'I', TIMESTAMP '2026-07-09 08:00:01+00'),
  ('S6', 'PLACED', TIMESTAMP '2026-07-08 15:00:00+00', 30, NULL, 'I', TIMESTAMP '2026-07-08 15:00:01+00'),
  ('S1', 'PLACED', TIMESTAMP '2026-07-08 10:00:00+00', 10, NULL, 'I', TIMESTAMP '2026-07-08 10:05:00+00'),
  ('S7', 'PLACED', TIMESTAMP '2026-07-08 10:00:00+00', 100, NULL, 'I', TIMESTAMP '2026-07-08 10:00:01+00'),
  ('S7', 'SETTLED', TIMESTAMP '2026-07-08 18:00:00+00', NULL, 60, 'I', TIMESTAMP '2026-07-08 18:00:01+00'),
  ('S8', 'PLACED', TIMESTAMP '2026-07-08 10:00:00+00', 50, NULL, 'I', TIMESTAMP '2026-07-08 10:00:01+00'),
  ('S8', 'SETTLED', TIMESTAMP '2026-07-08 18:00:00+00', NULL, 20, 'I', TIMESTAMP '2026-07-08 18:00:01+00'),
  ('S9', 'PLACED', TIMESTAMP '2026-07-08 10:00:00+00', 300, NULL, 'I', TIMESTAMP '2026-07-08 10:00:01+00'),
  ('S9', 'SETTLED', TIMESTAMP '2026-07-08 18:00:00+00', NULL, 600, 'I', TIMESTAMP '2026-07-08 18:00:01+00'),
  ('S10', 'PLACED', TIMESTAMP '2026-07-08 10:00:00+00', 500, NULL, 'I', TIMESTAMP '2026-07-08 10:00:01+00'),
  ('S10', 'SETTLED', TIMESTAMP '2026-07-08 18:00:00+00', NULL, 0, 'I', TIMESTAMP '2026-07-08 18:00:01+00'),
  ('S11', 'PLACED', TIMESTAMP '2026-07-08 10:00:00+00', 80, NULL, 'I', TIMESTAMP '2026-07-08 10:00:01+00'),
  ('S11', 'SETTLED', TIMESTAMP '2026-07-08 18:00:00+00', NULL, 30, 'I', TIMESTAMP '2026-07-08 18:00:01+00'),
  ('S12', 'PLACED', TIMESTAMP '2025-12-15 10:00:00+00', 100, NULL, 'I', TIMESTAMP '2025-12-15 10:00:01+00'),
  ('S12', 'SETTLED', TIMESTAMP '2025-12-15 18:00:00+00', NULL, 40, 'I', TIMESTAMP '2025-12-15 18:00:01+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_games (game_id STRING, game_name STRING, provider STRING, provider_game_ref STRING, game_type_raw STRING, _op STRING, _commit_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_games VALUES
  ('G1', 'Starburst', 'NetEnt', '1101', 'Video Slots', 'I', TIMESTAMP '2026-07-01 09:00:00+00'),
  ('G2', 'Lightning Roulette', 'Evolution', 'lr_01', 'Live Roulette', 'I', TIMESTAMP '2026-07-01 09:00:00+00'),
  ('G3', 'Blackjack Classic', 'NetEnt', '1102', 'Table Games - Blackjack', 'I', TIMESTAMP '2026-07-01 09:00:00+00'),
  ('G4', 'Mega Fortune', 'NetEnt', '1103', 'Slots', 'I', TIMESTAMP '2026-07-01 09:00:00+00'),
  ('G5', 'Punto Banco Pro', 'Evolution', 'pb_02', 'Punto Banco', 'I', TIMESTAMP '2026-07-01 09:00:00+00'),
  ('G6', 'Texas Hold\'em 6-Max', 'in_house', NULL, 'Poker - Cash', 'I', TIMESTAMP '2026-07-01 09:00:00+00'),
  ('G7', 'Sunday Deepstack', 'in_house', NULL, 'Poker Tournament', 'I', TIMESTAMP '2026-07-01 09:00:00+00'),
  ('G8', 'Aviator', 'Spribe', 'aviator', 'Crash', 'I', TIMESTAMP '2026-07-01 09:00:00+00'),
  ('G9', 'Age of the Gods', 'Playtech', 'aog', 'Slot', 'I', TIMESTAMP '2026-07-01 09:00:00+00'),
  ('OJ1', 'Operator Mega Jackpot', 'operator', NULL, 'Operator Jackpot', 'I', TIMESTAMP '2026-07-01 09:00:00+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_netent_rounds (round_ref STRING, player_ref STRING, game_ref STRING, bet_amount NUMERIC, win_amount NUMERIC, jp_contribution NUMERIC, jp_id STRING, round_ts TIMESTAMP, _op STRING, _commit_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_netent_rounds VALUES
  ('R1', 'A1001', '1101', 2, 0.5, 0, NULL, TIMESTAMP '2026-07-08 09:00:00+00', 'I', TIMESTAMP '2026-07-08 09:00:01+00'),
  ('R3', 'A1001', '1102', 25, 25, 0, NULL, TIMESTAMP '2026-07-08 09:20:00+00', 'I', TIMESTAMP '2026-07-08 09:20:01+00'),
  ('R4', 'A1001', '1103', 4, 0, 0.04, 'JP1', TIMESTAMP '2026-07-08 09:30:00+00', 'I', TIMESTAMP '2026-07-08 09:30:01+00'),
  ('R7', 'A2001', '1101', 8, 12, 0, NULL, TIMESTAMP '2026-07-08 10:00:00+00', 'I', TIMESTAMP '2026-07-08 10:00:01+00'),
  ('R8', 'A2002', '1103', 10, 0, 0.1, 'JP1', TIMESTAMP '2026-07-08 10:10:00+00', 'I', TIMESTAMP '2026-07-08 10:10:01+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_evolution_transactions (tx_id STRING, round_ref STRING, player_ref STRING, table_ref STRING, tx_type STRING, amount_cents NUMERIC, tx_ts TIMESTAMP, _op STRING, _commit_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_evolution_transactions VALUES
  ('T1', 'R2', 'A1002', 'lr_01', 'BET', 1000, TIMESTAMP '2026-07-08 09:10:00+00', 'I', TIMESTAMP '2026-07-08 09:10:01+00'),
  ('T2', 'R5', 'A1001', 'pb_02', 'BET', 500, TIMESTAMP '2026-07-08 09:40:00+00', 'I', TIMESTAMP '2026-07-08 09:40:01+00'),
  ('T3', 'R5', 'A1001', 'pb_02', 'WIN', 1000, TIMESTAMP '2026-07-08 09:40:20+00', 'I', TIMESTAMP '2026-07-08 09:40:21+00'),
  ('T2', 'R5', 'A1001', 'pb_02', 'BET', 500, TIMESTAMP '2026-07-08 09:40:00+00', 'I', TIMESTAMP '2026-07-08 09:45:00+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_playtech_rounds (round_ref STRING, player_ref STRING, game_code STRING, stake NUMERIC, payout NUMERIC, round_ts TIMESTAMP, _op STRING, _commit_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_playtech_rounds VALUES
  ('R9', 'A1002', 'aog', 6, 1, TIMESTAMP '2026-07-08 09:55:00+00', 'I', TIMESTAMP '2026-07-08 09:55:01+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_aggregator_rounds (round_ref STRING, sub_provider STRING, player_ref STRING, game_ref STRING, bet NUMERIC, win NUMERIC, round_ts TIMESTAMP, _op STRING, _commit_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_aggregator_rounds VALUES
  ('R6', 'Spribe', 'A1001', 'aviator', 3, 0, TIMESTAMP '2026-07-08 09:50:00+00', 'I', TIMESTAMP '2026-07-08 09:50:01+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_player_limits (limit_id STRING, account_id STRING, limit_type STRING, amount NUMERIC, set_at TIMESTAMP, revoked_at TIMESTAMP, _op STRING, _commit_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_player_limits VALUES
  ('L1', 'A2001', 'DEPOSIT_DAILY', 200, TIMESTAMP '2026-05-01 09:00:00+00', TIMESTAMP '2026-06-01 09:00:00+00', 'I', TIMESTAMP '2026-05-01 09:00:01+00'),
  ('L2', 'A2001', 'DEPOSIT_DAILY', 100, TIMESTAMP '2026-06-01 09:00:00+00', NULL, 'I', TIMESTAMP '2026-06-01 09:00:01+00'),
  ('L3', 'A1001', 'DEPOSIT_DAILY', 500, TIMESTAMP '2026-01-15 09:00:00+00', NULL, 'I', TIMESTAMP '2026-01-15 09:00:01+00'),
  ('L4', 'A1001', 'LOSS_DAILY', 50, TIMESTAMP '2026-06-01 09:00:00+00', NULL, 'I', TIMESTAMP '2026-06-01 09:00:01+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_self_exclusions (exclusion_id STRING, account_id STRING, source STRING, start_ts TIMESTAMP, end_ts TIMESTAMP, _op STRING, _commit_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_self_exclusions VALUES
  ('X1', 'A2003', 'RGIAJ', TIMESTAMP '2026-06-01 00:00:00+00', NULL, 'I', TIMESTAMP '2026-06-01 00:00:01+00'),
  ('X2', 'A1002', 'OPERATOR', TIMESTAMP '2025-01-01 00:00:00+00', TIMESTAMP '2025-07-01 00:00:00+00', 'I', TIMESTAMP '2025-01-01 00:00:01+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_verifications (verification_id STRING, account_id STRING, check_type STRING, status STRING, event_ts TIMESTAMP, _op STRING, _commit_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_verifications VALUES
  ('V1', 'A1001', 'IDENTITY', 'VERIFIED', TIMESTAMP '2025-01-11 10:00:00+00', 'I', TIMESTAMP '2025-01-11 10:00:01+00'),
  ('V2', 'A1002', 'IDENTITY', 'VERIFIED', TIMESTAMP '2025-03-03 10:00:00+00', 'I', TIMESTAMP '2025-03-03 10:00:01+00'),
  ('V3', 'A2001', 'IDENTITY', 'VERIFIED', TIMESTAMP '2025-02-21 10:00:00+00', 'I', TIMESTAMP '2025-02-21 10:00:01+00'),
  ('V4', 'A2002', 'IDENTITY', 'PENDING', TIMESTAMP '2026-07-06 09:00:00+00', 'I', TIMESTAMP '2026-07-06 09:00:01+00'),
  ('V5', 'A2002', 'IDENTITY', 'VERIFIED', TIMESTAMP '2026-07-07 09:00:00+00', 'I', TIMESTAMP '2026-07-07 09:00:01+00'),
  ('V6', 'A2003', 'IDENTITY', 'PENDING', TIMESTAMP '2026-06-02 09:00:00+00', 'I', TIMESTAMP '2026-06-02 09:00:01+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_payments (payment_id STRING, account_id STRING, direction STRING, amount NUMERIC, method STRING, status STRING, requested_ts TIMESTAMP, completed_ts TIMESTAMP, _op STRING, _commit_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_payments VALUES
  ('D1', 'A1001', 'DEPOSIT', 200, 'CARD', 'COMPLETED', TIMESTAMP '2026-07-07 08:00:00+00', TIMESTAMP '2026-07-07 08:00:05+00', 'I', TIMESTAMP '2026-07-07 08:00:06+00'),
  ('D2', 'A1002', 'DEPOSIT', 50, 'PAYPAL', 'COMPLETED', TIMESTAMP '2026-07-08 08:30:00+00', TIMESTAMP '2026-07-08 08:30:05+00', 'I', TIMESTAMP '2026-07-08 08:30:06+00'),
  ('D3', 'A2001', 'DEPOSIT', 90, 'BIZUM', 'COMPLETED', TIMESTAMP '2026-07-08 08:45:00+00', TIMESTAMP '2026-07-08 08:45:05+00', 'I', TIMESTAMP '2026-07-08 08:45:06+00'),
  ('D4', 'A2002', 'DEPOSIT', 550, 'SEPA', 'COMPLETED', TIMESTAMP '2026-07-08 09:00:00+00', TIMESTAMP '2026-07-08 09:00:05+00', 'I', TIMESTAMP '2026-07-08 09:00:06+00'),
  ('D5', 'A2003', 'DEPOSIT', 100, 'CARD', 'FAILED', TIMESTAMP '2026-07-08 09:15:00+00', NULL, 'I', TIMESTAMP '2026-07-08 09:15:06+00'),
  ('W1', 'A1001', 'WITHDRAWAL', 150, 'SEPA', 'COMPLETED', TIMESTAMP '2026-07-08 14:00:00+00', TIMESTAMP '2026-07-08 16:00:00+00', 'I', TIMESTAMP '2026-07-08 16:00:01+00'),
  ('W2', 'A2002', 'WITHDRAWAL', 20, 'SEPA', 'COMPLETED', TIMESTAMP '2026-07-08 10:00:00+00', TIMESTAMP '2026-07-08 12:00:00+00', 'I', TIMESTAMP '2026-07-08 12:00:01+00'),
  ('W3', 'A2003', 'WITHDRAWAL', 40, 'SEPA', 'REQUESTED', TIMESTAMP '2026-07-08 11:00:00+00', NULL, 'I', TIMESTAMP '2026-07-08 11:00:01+00'),
  ('D6', 'A3001', 'DEPOSIT', 200, 'CARD', 'COMPLETED', TIMESTAMP '2026-07-08 09:00:00+00', TIMESTAMP '2026-07-08 09:00:05+00', 'I', TIMESTAMP '2026-07-08 09:00:06+00'),
  ('D7', 'A4001', 'DEPOSIT', 100, 'CARD', 'COMPLETED', TIMESTAMP '2026-07-08 09:00:00+00', TIMESTAMP '2026-07-08 09:00:05+00', 'I', TIMESTAMP '2026-07-08 09:00:06+00'),
  ('D8', 'A5001', 'DEPOSIT', 1000, 'CARD', 'COMPLETED', TIMESTAMP '2026-07-08 09:00:00+00', TIMESTAMP '2026-07-08 09:00:05+00', 'I', TIMESTAMP '2026-07-08 09:00:06+00'),
  ('D9', 'A6001', 'DEPOSIT', 150, 'CARD', 'COMPLETED', TIMESTAMP '2026-07-08 09:00:00+00', TIMESTAMP '2026-07-08 09:00:05+00', 'I', TIMESTAMP '2026-07-08 09:00:06+00'),
  ('D10', 'A4002', 'DEPOSIT', 500, 'CARD', 'COMPLETED', TIMESTAMP '2025-12-01 09:00:00+00', TIMESTAMP '2025-12-01 09:00:05+00', 'I', TIMESTAMP '2025-12-01 09:00:06+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_provider_statements (provider STRING, statement_date DATE, reported_ggr NUMERIC);

INSERT INTO cdc_landing.cdc_provider_statements VALUES
  ('NetEnt', DATE '2026-07-08', 11.5),
  ('Evolution', DATE '2026-07-08', 5),
  ('Playtech', DATE '2026-07-08', 5),
  ('Spribe', DATE '2026-07-08', 3);

CREATE OR REPLACE TABLE cdc_landing.cdc_poker_activity (activity_id STRING, account_id STRING, game_id STRING, kind STRING, amount_in NUMERIC, amount_out NUMERIC, rake_or_fee NUMERIC, activity_ts TIMESTAMP, _op STRING, _commit_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_poker_activity VALUES
  ('P1', 'A1002', 'G6', 'CASH_HAND', 5, 9.7, 0.3, TIMESTAMP '2026-07-08 11:00:00+00', 'I', TIMESTAMP '2026-07-08 11:00:01+00'),
  ('P2', 'A1001', 'G7', 'TOURNAMENT_ENTRY', 11, 40, 1, TIMESTAMP '2026-07-08 12:00:00+00', 'I', TIMESTAMP '2026-07-08 12:00:01+00'),
  ('P3', 'A2001', 'G6', 'CASH_HAND', 20, 0, 1, TIMESTAMP '2026-07-08 11:30:00+00', 'I', TIMESTAMP '2026-07-08 11:30:01+00'),
  ('P4', 'A2002', 'G7', 'TOURNAMENT_ENTRY', 55, 0, 5, TIMESTAMP '2026-07-08 12:30:00+00', 'I', TIMESTAMP '2026-07-08 12:30:01+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_jackpot_pools (jackpot_id STRING, jackpot_name STRING, provider STRING, seed_amount NUMERIC, contribution_rate NUMERIC);

INSERT INTO cdc_landing.cdc_jackpot_pools VALUES
  ('JP1', 'Mega Fortune Mega', 'NetEnt', 100000, 0.01);

CREATE OR REPLACE TABLE cdc_landing.cdc_jackpot_wins (win_id STRING, jackpot_id STRING, account_id STRING, amount NUMERIC, win_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_jackpot_wins VALUES
  ('W1', 'JP1', 'A2002', 100000.1, TIMESTAMP '2026-07-08 10:10:05+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_operator_jackpot_pools (jackpot_id STRING, jackpot_name STRING, seed_amount NUMERIC);

INSERT INTO cdc_landing.cdc_operator_jackpot_pools VALUES
  ('OJP1', 'Operator Mega Jackpot', 500);

CREATE OR REPLACE TABLE cdc_landing.cdc_jackpot_optins (optin_id STRING, account_id STRING, jackpot_id STRING, opted_in_at TIMESTAMP, opted_out_at TIMESTAMP, _op STRING, _commit_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_jackpot_optins VALUES
  ('OPT1', 'A1001', 'OJP1', TIMESTAMP '2026-07-01 00:00:00+00', NULL, 'I', TIMESTAMP '2026-07-01 00:00:01+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_operator_jackpot_contributions (contribution_id STRING, account_id STRING, jackpot_id STRING, game_id STRING, trigger_type STRING, trigger_ref STRING, amount NUMERIC, contributed_at TIMESTAMP, _op STRING, _commit_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_operator_jackpot_contributions VALUES
  ('OJC1', 'A1001', 'OJP1', 'OJ1', 'GAMING_ROUND', 'NE:R1', 5, TIMESTAMP '2026-07-08 09:00:05+00', 'I', TIMESTAMP '2026-07-08 09:00:06+00'),
  ('OJC2', 'A1001', 'OJP1', 'OJ1', 'SPORTS_BET', 'S1', 4, TIMESTAMP '2026-07-08 10:00:05+00', 'I', TIMESTAMP '2026-07-08 10:00:06+00'),
  ('OJC3', 'A1001', 'OJP1', 'OJ1', 'SPORTS_BET', 'S2', 6, TIMESTAMP '2026-07-08 11:00:05+00', 'I', TIMESTAMP '2026-07-08 11:00:06+00'),
  ('OJC4', 'A1001', 'OJP1', 'OJ1', 'GAMING_ROUND', 'NE:R99', 7, TIMESTAMP '2026-07-08 09:05:05+00', 'I', TIMESTAMP '2026-07-08 09:05:06+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_operator_jackpot_wins (win_id STRING, jackpot_id STRING, account_id STRING, game_id STRING, amount NUMERIC, win_ts TIMESTAMP, _op STRING, _commit_ts TIMESTAMP);

INSERT INTO cdc_landing.cdc_operator_jackpot_wins VALUES
  ('OJW1', 'OJP1', 'A1001', 'OJ1', 3, TIMESTAMP '2026-07-08 11:00:00+00', 'I', TIMESTAMP '2026-07-08 11:00:01+00');

CREATE OR REPLACE TABLE cdc_landing.cdc_game_round_voids (round_id STRING, voided_at TIMESTAMP);

INSERT INTO cdc_landing.cdc_game_round_voids VALUES
  ('NE:R99', TIMESTAMP '2026-07-08 09:05:30+00');
