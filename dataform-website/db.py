# ============================================================================
# BetNova demo — DuckDB persistence layer.
#
# One persistent DuckDB file (data/betnova.duckdb) checked into git. The
# schema deliberately mirrors the OLTP shapes that the reporting pipeline's
# CDC landing tables (dataform-example: cdc_accounts, cdc_bet_slips,
# cdc_bet_slip_events, cdc_payments, cdc_player_limits, ...) are captured
# from — so a demo audience can trace a click on this website all the way
# into the regulatory pipeline's models.
#
# Concurrency: one module-level connection; each request takes a cursor
# (the documented duckdb pattern for threaded use). Single-user demo.
# ============================================================================
import os
import duckdb
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "betnova.duckdb")

_conn = None


def connect():
    """Open (or return) the process-wide connection."""
    global _conn
    if _conn is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        _conn = duckdb.connect(DB_PATH)
    return _conn


def cursor():
    """A per-request cursor over the shared connection (thread-safe)."""
    return connect().cursor()


def now():
    return datetime.now(timezone.utc)


# ---- readable, prefixed ids (demo-friendly: W1007, S1042, F1010...) ----
def next_id(cur, name, prefix):
    cur.execute(
        "UPDATE seq_counters SET value = value + 1 WHERE name = ? RETURNING value", [name]
    )
    row = cur.fetchone()
    if row is None:
        cur.execute("INSERT INTO seq_counters VALUES (?, 1001)", [name])
        return f"{prefix}1001"
    return f"{prefix}{row[0]}"


SCHEMA = """
CREATE TABLE IF NOT EXISTS seq_counters (name VARCHAR PRIMARY KEY, value BIGINT NOT NULL);

-- pipeline: cdc_accounts
CREATE TABLE IF NOT EXISTS accounts (
  account_id   VARCHAR PRIMARY KEY,
  username     VARCHAR UNIQUE NOT NULL,
  password_hash VARCHAR NOT NULL,
  jurisdiction VARCHAR NOT NULL,       -- MT / ES / DK / BG / GR / NL
  national_id  VARCHAR,
  date_of_birth DATE,                  -- REQ: requirements/max-stake-limits (age-banded caps)
  kyc_status   VARCHAR NOT NULL,       -- PENDING / VERIFIED
  is_admin     BOOLEAN NOT NULL DEFAULT FALSE,
  opened_at    TIMESTAMPTZ NOT NULL,
  last_seen    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS terms_acceptances (
  account_id VARCHAR NOT NULL, version VARCHAR NOT NULL, accepted_at TIMESTAMPTZ NOT NULL
);

-- pipeline: cdc_account_addresses
CREATE TABLE IF NOT EXISTS account_addresses (
  account_id VARCHAR PRIMARY KEY, street VARCHAR, city VARCHAR,
  postcode VARCHAR, updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_methods (
  account_id VARCHAR PRIMARY KEY, method VARCHAR NOT NULL,
  card_last4 VARCHAR, added_at TIMESTAMPTZ NOT NULL
);

-- pipeline: cdc_player_limits
CREATE TABLE IF NOT EXISTS player_limits (
  limit_id VARCHAR PRIMARY KEY, account_id VARCHAR NOT NULL,
  limit_type VARCHAR NOT NULL,          -- DEPOSIT_DAILY/WEEKLY/MONTHLY, LOSS_DAILY/...
  amount DECIMAL(12,2) NOT NULL, set_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ
);

-- pipeline: cdc_self_exclusions
CREATE TABLE IF NOT EXISTS self_exclusions (
  exclusion_id VARCHAR PRIMARY KEY, account_id VARCHAR NOT NULL,
  source VARCHAR NOT NULL,              -- OPERATOR / NATIONAL
  start_ts TIMESTAMPTZ NOT NULL, end_ts TIMESTAMPTZ
);

-- pipeline: cdc_verifications
CREATE TABLE IF NOT EXISTS verifications (
  verification_id VARCHAR PRIMARY KEY, account_id VARCHAR NOT NULL,
  check_type VARCHAR NOT NULL, status VARCHAR NOT NULL, event_ts TIMESTAMPTZ NOT NULL
);

-- pipeline: cdc_payments
CREATE TABLE IF NOT EXISTS payments (
  payment_id VARCHAR PRIMARY KEY, account_id VARCHAR NOT NULL,
  direction VARCHAR NOT NULL,           -- DEPOSIT / WITHDRAWAL
  amount DECIMAL(12,2) NOT NULL, method VARCHAR,
  status VARCHAR NOT NULL,              -- REQUESTED / COMPLETED / FAILED
  reason VARCHAR,                       -- why FAILED / held
  requested_ts TIMESTAMPTZ NOT NULL, completed_ts TIMESTAMPTZ
);

-- pipeline: cdc_fixtures
CREATE TABLE IF NOT EXISTS fixtures (
  fixture_id VARCHAR PRIMARY KEY, sport VARCHAR NOT NULL,
  competition VARCHAR NOT NULL, home VARCHAR NOT NULL, away VARCHAR NOT NULL,
  start_ts TIMESTAMPTZ NOT NULL,
  status VARCHAR NOT NULL,              -- OPEN / SETTLED / ABANDONED
  result VARCHAR,                       -- winning selection
  settle_at TIMESTAMPTZ                 -- set when the first bet lands (demo speed)
);

CREATE TABLE IF NOT EXISTS fixture_odds (
  fixture_id VARCHAR NOT NULL, selection VARCHAR NOT NULL,  -- HOME / DRAW / AWAY
  odds DECIMAL(6,2) NOT NULL
);

-- pipeline: cdc_bet_slips
CREATE TABLE IF NOT EXISTS bet_slips (
  slip_id VARCHAR PRIMARY KEY, account_id VARCHAR NOT NULL,
  fixture_id VARCHAR NOT NULL, selection VARCHAR NOT NULL,
  odds DECIMAL(6,2) NOT NULL, product VARCHAR NOT NULL DEFAULT 'sports',
  created_at TIMESTAMPTZ NOT NULL
);

-- pipeline: cdc_bet_slip_events (append-only lifecycle, exactly like CDC)
CREATE TABLE IF NOT EXISTS bet_slip_events (
  slip_id VARCHAR NOT NULL, event_type VARCHAR NOT NULL,  -- PLACED/SETTLED/VOIDED
  event_ts TIMESTAMPTZ NOT NULL, stake DECIMAL(12,2), payout DECIMAL(12,2),
  reason VARCHAR
);

-- pipeline: gaming activity (cdc_*_rounds / cdc_poker_activity)
CREATE TABLE IF NOT EXISTS game_rounds (
  round_id VARCHAR PRIMARY KEY, account_id VARCHAR NOT NULL,
  game VARCHAR NOT NULL,                -- SLOTS / BLACKJACK / POKER / operator-jackpots
  stake DECIMAL(12,2) NOT NULL, payout DECIMAL(12,2) NOT NULL,
  funding VARCHAR NOT NULL DEFAULT 'CASH',  -- CASH / GOLDEN_CHIP (REQ: requirements/golden-chips)
  session_id VARCHAR,                   -- the gaming session (REQ: requirements/operator-jackpots, OJ-2)
  detail VARCHAR, round_ts TIMESTAMPTZ NOT NULL
);

-- Gaming sessions: minted at login, ended by logout or inactivity. Every
-- gaming play is stamped with its session and the session is reported to
-- the regulator. REQ: requirements/operator-jackpots (REQ-OJ-1)
CREATE TABLE IF NOT EXISTS gaming_sessions (
  session_id VARCHAR PRIMARY KEY,
  account_id VARCHAR NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  last_activity_ts TIMESTAMPTZ NOT NULL,
  ended_at   TIMESTAMPTZ,
  end_reason VARCHAR                    -- LOGOUT / INACTIVITY
);

-- Operator-jackpot opt-in lifecycle (open interval = currently opted in).
-- Same shape as the pipeline's cdc_jackpot_optins.
-- REQ: requirements/operator-jackpots (REQ-OJ-3)
CREATE TABLE IF NOT EXISTS jackpot_optins (
  optin_id   VARCHAR PRIMARY KEY,
  account_id VARCHAR NOT NULL,
  opted_in_at  TIMESTAMPTZ NOT NULL,
  opted_out_at TIMESTAMPTZ
);

-- Promotional golden chips: operator-funded table-game stakes. The chip is
-- consumed win/lose/push and only WINNINGS come back (as cash).
-- REQ: requirements/golden-chips (REQ-GC-1)
CREATE TABLE IF NOT EXISTS golden_chips (
  chip_id    VARCHAR PRIMARY KEY,
  account_id VARCHAR NOT NULL,
  value      DECIMAL(12,2) NOT NULL,
  reason     VARCHAR,                  -- 'deposit promotion' / 'customer services award'
  status     VARCHAR NOT NULL,         -- AVAILABLE / USED
  awarded_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  used_round_id VARCHAR
);

-- SAFE submission log: which records the submission engine (submission.py)
-- has already delivered to the regulator SAFE (safe.py), with the receipt.
-- record_key encodes the reportable state (e.g. 'S1001|VOIDED',
-- 'W1002|VERIFIED'), so a state change is re-reported exactly once.
CREATE TABLE IF NOT EXISTS safe_submissions (
  record_type VARCHAR NOT NULL,         -- bets / payments / players
  record_key  VARCHAR NOT NULL,
  jurisdiction VARCHAR NOT NULL,
  receipt_id  VARCHAR NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (record_type, record_key)
);
"""


def init_schema(cur):
    for stmt in SCHEMA.split(";"):
        if stmt.strip():
            cur.execute(stmt)


# ---- derived state (mirrors the pipeline's fct_* models) ----

def slip_status(cur, slip_id):
    """VOIDED beats SETTLED beats PLACED — same rule as fct_bet_slip_lifecycle."""
    cur.execute(
        """SELECT MAX(CASE event_type WHEN 'VOIDED' THEN 3 WHEN 'SETTLED' THEN 2 ELSE 1 END)
           FROM bet_slip_events WHERE slip_id = ?""", [slip_id])
    n = cur.fetchone()[0]
    return {3: "VOIDED", 2: "SETTLED", 1: "OPEN"}.get(n, "OPEN")


BALANCE_SQL = """
-- The unified wallet, exactly as the pipeline's fct_wallet_ledger derives it:
-- one signed ledger over payments, betting and gaming.
SELECT COALESCE(SUM(amt), 0) FROM (
  SELECT amount AS amt FROM payments
    WHERE account_id = ? AND direction = 'DEPOSIT' AND status = 'COMPLETED'
  UNION ALL
  SELECT -amount FROM payments
    WHERE account_id = ? AND direction = 'WITHDRAWAL' AND status = 'COMPLETED'
  UNION ALL
  -- stakes: negative unless the slip was voided (void refunds the stake)
  SELECT -e.stake FROM bet_slip_events e
    JOIN bet_slips s ON s.slip_id = e.slip_id
    WHERE s.account_id = ? AND e.event_type = 'PLACED'
      AND NOT EXISTS (SELECT 1 FROM bet_slip_events v
                      WHERE v.slip_id = e.slip_id AND v.event_type = 'VOIDED')
  UNION ALL
  SELECT e.payout FROM bet_slip_events e
    JOIN bet_slips s ON s.slip_id = e.slip_id
    WHERE s.account_id = ? AND e.event_type = 'SETTLED' AND e.payout > 0
      AND NOT EXISTS (SELECT 1 FROM bet_slip_events v
                      WHERE v.slip_id = e.slip_id AND v.event_type = 'VOIDED')
  UNION ALL
  -- cash rounds: net of stake and payout. GOLDEN_CHIP rounds: the stake was
  -- OPERATOR money (no wallet debit), so only the winnings credit the player.
  -- REQ: requirements/golden-chips (REQ-GC-4)
  SELECT CASE WHEN funding = 'GOLDEN_CHIP' THEN payout ELSE payout - stake END
  FROM game_rounds WHERE account_id = ?
) ledger
"""


def balance(cur, account_id):
    cur.execute(BALANCE_SQL, [account_id] * 5)
    return float(cur.fetchone()[0])
