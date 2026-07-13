# ============================================================================
# BetNova demo — the SUBMISSION ENGINE (operator -> regulator SAFE).
#
# Pulls newly-reportable records from the submission views over the demo's
# OLTP tables and pushes each one, near-realtime, as a SOAP SubmitRecord
# call to the fictitious SAFE (safe.py) — one endpoint per jurisdiction per
# record type. Successful submissions are logged in safe_submissions so a
# record is sent exactly once (a bet that is later voided is re-reported as
# a VOIDED record; a player whose KYC status changes is re-reported).
#
# The engine deliberately does as LITTLE as possible: it decides WHAT is
# reportable (the SQL below), builds a canonical dict per record, and hands
# it to the regulator_formats package, which owns HOW each regulator wants
# it said — DK Standard Records, ES DGOJ Lotes, GR HGC Batches, NL KSA CDB
# records (see regulator_formats/__init__.py for the architecture note).
# The engine never touches an element name; the SAFE never translates.
#
# Market variance is DATA here too (same principle as the pipeline):
#   - MT/DK report voided bets with a status column; ES/BG/GR/NL never do.
#   - ES/BG/GR/NL pseudonymise the player (sha256 of national id);
#     MT/DK report the account id.
#
# Lifecycle: app.py starts run_loop() in a daemon thread (shares the app's
# DuckDB connection via cursors — DuckDB allows one writer process), so the
# engine runs and stops with the demo app. Standalone one-shot drain (only
# while app.py is NOT running):   python submission.py
# ============================================================================
import hashlib
import time
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET

import db
import regulator_formats

SAFE_BASE = "http://127.0.0.1:5002/safe"
POLL_SECONDS = 3

# per-market reporting variance, as data (mirrors includes/jurisdictions.js)
MARKETS = {
    "MT": {"include_voided": True,  "hashed_ref": False},
    "DK": {"include_voided": True,  "hashed_ref": False},
    "ES": {"include_voided": False, "hashed_ref": True},
    "BG": {"include_voided": False, "hashed_ref": True},
    "GR": {"include_voided": False, "hashed_ref": True},
    "NL": {"include_voided": False, "hashed_ref": True},
    "DE": {"include_voided": False, "hashed_ref": True},  # LUGAS pseudonym; voids refunded, never taxed
}


def _player_ref(mkt, account_id, national_id):
    if MARKETS[mkt]["hashed_ref"]:
        return hashlib.sha256((national_id or account_id).encode("utf-8")).hexdigest()
    return account_id


def _soap_submit(mkt, rtype, record_key, payload_el):
    """POST one regulator-format record to the SAFE; returns the ReceiptId
    (raises on fault). The SOAP body carries the operator's record key —
    the name the deposited file is stored under, as a real operator names
    the files it writes to a regulator's safe — plus the payload exactly
    as the regulator's schema stipulates it."""
    envelope = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">'
        "<soap:Body><SubmitRecord>"
        f"<RecordKey>{record_key}</RecordKey>"
        + ET.tostring(payload_el, encoding="unicode") +
        "</SubmitRecord></soap:Body></soap:Envelope>"
    )
    req = urllib.request.Request(
        f"{SAFE_BASE}/{mkt}/{rtype}", data=envelope.encode("utf-8"),
        headers={"Content-Type": "text/xml; charset=utf-8",
                 "SOAPAction": "urn:betnova:safe#SubmitRecord"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        tree = ET.fromstring(resp.read().decode("utf-8"))
    receipt = None
    for el in tree.iter():
        if el.tag.rsplit("}", 1)[-1] == "ReceiptId":
            receipt = el.text
    if not receipt:
        raise RuntimeError("SAFE response carried no ReceiptId")
    return receipt


def _submit(mkt, rtype, record_key, rec):
    """Translate one canonical record and deliver it."""
    payload = regulator_formats.format_record(mkt, rtype, rec)
    return _soap_submit(mkt, rtype, record_key, payload)


def _log(cur, rtype, key, mkt, receipt):
    cur.execute("INSERT INTO safe_submissions VALUES (?, ?, ?, ?, ?)",
                [rtype, key, mkt, receipt, db.now()])


def _log_replace(cur, rtype, key, mkt, receipt):
    # periodic registers may be re-filed (a regenerated register supersedes
    # the previous filing); keep the latest receipt per register filing.
    # REQ: requirements/dgoj-periodic-reporting (REQ-DGOJ-5)
    cur.execute("INSERT OR REPLACE INTO safe_submissions VALUES (?, ?, ?, ?, ?)",
                [rtype, key, mkt, receipt, db.now()])


# ---- record type: bets (the submission-table analog) -----------------------
PENDING_BETS_SQL = """
SELECT b.slip_id, a.jurisdiction, a.account_id, a.national_id, b.fixture_id,
       f.sport, f.competition, f.home, f.away, b.selection, b.odds,
       p.stake,
       CASE WHEN v.slip_id IS NOT NULL THEN 'VOIDED' ELSE 'SETTLED' END AS status,
       CASE WHEN v.slip_id IS NOT NULL THEN 0 ELSE COALESCE(s.payout, 0) END AS payout,
       v.reason, p.event_ts AS placed_at, COALESCE(v.event_ts, s.event_ts) AS terminal_at
FROM bet_slips b
JOIN accounts a USING (account_id)
JOIN fixtures f USING (fixture_id)
JOIN bet_slip_events p ON p.slip_id = b.slip_id AND p.event_type = 'PLACED'
LEFT JOIN bet_slip_events s ON s.slip_id = b.slip_id AND s.event_type = 'SETTLED'
LEFT JOIN bet_slip_events v ON v.slip_id = b.slip_id AND v.event_type = 'VOIDED'
WHERE (s.slip_id IS NOT NULL OR v.slip_id IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM safe_submissions ss
    WHERE ss.record_type = 'bets'
      AND ss.record_key = b.slip_id || '|' ||
          CASE WHEN v.slip_id IS NOT NULL THEN 'VOIDED' ELSE 'SETTLED' END)
ORDER BY terminal_at
"""


def submit_pending_bets(cur):
    cur.execute(PENDING_BETS_SQL)
    n = 0
    for (slip_id, mkt, account_id, national_id, fixture_id, sport, comp, home,
         away, selection, odds, stake, status, payout, reason, placed_at,
         terminal_at) in cur.fetchall():
        meta = MARKETS.get(mkt)
        if meta is None:
            continue
        if status == "VOIDED" and not meta["include_voided"]:
            # this market never reports voids; log it as suppressed so we
            # don't re-examine the slip every poll
            _log(cur, "bets", f"{slip_id}|VOIDED", mkt, "SUPPRESSED-VOID")
            continue
        rec = {
            "record_key": slip_id,
            "slip_id": slip_id,
            "player_ref": _player_ref(mkt, account_id, national_id),
            "fixture_id": fixture_id,
            "sport": sport,
            "event": f"{home} v {away} ({comp})",
            "selection": selection,
            "odds": odds,
            "stake": stake,
            "payout": payout,
            # which fields a market reports is canonical-layer variance:
            # only void-reporting markets carry the status/void reason
            "status": status if meta["include_voided"] else None,
            "void_reason": (reason or "voided") if status == "VOIDED" else None,
            "placed_at": placed_at,
            "terminal_at": terminal_at,
        }
        receipt = _submit(mkt, "bets", slip_id, rec)
        _log(cur, "bets", f"{slip_id}|{status}", mkt, receipt)
        print(f"[SUBMIT] {mkt}/bets {slip_id} ({status}) -> {receipt}")
        n += 1
    return n


# ---- record type: payments --------------------------------------------------
PENDING_PAYMENTS_SQL = """
SELECT p.payment_id, a.jurisdiction, a.account_id, a.national_id,
       p.direction, p.amount, p.method, p.completed_ts
FROM payments p
JOIN accounts a USING (account_id)
WHERE p.status = 'COMPLETED'
  AND NOT EXISTS (SELECT 1 FROM safe_submissions ss
                  WHERE ss.record_type = 'payments' AND ss.record_key = p.payment_id)
ORDER BY p.completed_ts
"""


def submit_pending_payments(cur):
    cur.execute(PENDING_PAYMENTS_SQL)
    n = 0
    for (payment_id, mkt, account_id, national_id, direction, amount,
         method, completed_ts) in cur.fetchall():
        if mkt not in MARKETS:
            continue
        rec = {
            "record_key": payment_id,
            "payment_id": payment_id,
            "player_ref": _player_ref(mkt, account_id, national_id),
            "direction": direction,
            "amount": amount,
            "method": method,
            "completed_at": completed_ts,
            # GR reports the balance after each wallet movement; the demo
            # supplies the current balance (its ledger has no as-of view)
            "balance": db.balance(cur, account_id),
        }
        receipt = _submit(mkt, "payments", payment_id, rec)
        _log(cur, "payments", payment_id, mkt, receipt)
        print(f"[SUBMIT] {mkt}/payments {payment_id} ({direction}) -> {receipt}")
        n += 1
    return n


# ---- record type: players (re-reported when KYC status changes) -------------
PENDING_PLAYERS_SQL = """
SELECT a.account_id, a.jurisdiction, a.national_id, a.kyc_status,
       a.opened_at, a.date_of_birth
FROM accounts a
WHERE NOT a.is_admin
  AND NOT EXISTS (SELECT 1 FROM safe_submissions ss
                  WHERE ss.record_type = 'players'
                    AND ss.record_key = a.account_id || '|' || a.kyc_status)
ORDER BY a.opened_at
"""


def submit_pending_players(cur):
    cur.execute(PENDING_PLAYERS_SQL)
    n = 0
    for (account_id, mkt, national_id, kyc_status, opened_at,
         date_of_birth) in cur.fetchall():
        if mkt not in MARKETS:
            continue
        rec = {
            "record_key": account_id,
            "player_ref": _player_ref(mkt, account_id, national_id),
            "jurisdiction": mkt,
            "kyc_status": kyc_status,
            "opened_at": opened_at,
            # the NL profile record wants DOB and end-of-day balance
            "date_of_birth": date_of_birth,
            "balance": db.balance(cur, account_id),
        }
        receipt = _submit(mkt, "players", account_id, rec)
        _log(cur, "players", f"{account_id}|{kyc_status}", mkt, receipt)
        print(f"[SUBMIT] {mkt}/players {account_id} ({kyc_status}) -> {receipt}")
        n += 1
    return n


# ---- record type: gaming (casino rounds) ------------------------------------
# Added with financial reconciliation: the regulator-reported record set must
# cover the FULL GGR tax base (sports settlements AND gaming rounds), or the
# reconciliation of OLTP vs reported would carry a permanent structural gap.
PENDING_GAMING_SQL = """
SELECT r.round_id, a.jurisdiction, a.account_id, a.national_id,
       r.game, r.stake, r.payout, r.funding, r.session_id, r.round_ts
FROM game_rounds r
JOIN accounts a USING (account_id)
WHERE NOT EXISTS (SELECT 1 FROM safe_submissions ss
                  WHERE ss.record_type = 'gaming' AND ss.record_key = r.round_id)
ORDER BY r.round_ts
"""


def submit_pending_gaming(cur):
    from engine import GAME_TYPE_CODES   # game types as configurable data
    cur.execute(PENDING_GAMING_SQL)
    n = 0
    for (round_id, mkt, account_id, national_id, game, stake, payout, funding,
         session_id, round_ts) in cur.fetchall():
        if mkt not in MARKETS:
            continue
        rec = {
            "record_key": round_id,
            "round_id": round_id,
            "player_ref": _player_ref(mkt, account_id, national_id),
            "game": game,
            # the configurable magic number: operator-jackpot rounds are
            # deducible from the gaming data alone.
            # REQ: requirements/operator-jackpots (REQ-OJ-8)
            "game_type_code": GAME_TYPE_CODES.get(game),
            "stake": stake,
            "payout": payout,
            # bonus-funded play is visible to the regulator:
            # REQ: requirements/golden-chips (REQ-GC-6)
            "funding": funding,
            # the gaming session this play belonged to.
            # REQ: requirements/operator-jackpots (REQ-OJ-2)
            "session_id": session_id,
            "played_at": round_ts,
        }
        receipt = _submit(mkt, "gaming", round_id, rec)
        _log(cur, "gaming", round_id, mkt, receipt)
        print(f"[SUBMIT] {mkt}/gaming {round_id} ({game}) -> {receipt}")
        n += 1
    return n


# ---- record types: periodic registers (DGOJ-style RUD daily / RUT monthly) --
# Which markets file which registers, at which cadence, is DATA (mirrors
# periodicReports in the pipeline's jurisdictions.js). Registers totalise a
# player's SETTLED betting activity per period; they are generated ON DEMAND
# from Admin -> Periodic reports, not by the polling loop, so a demo never
# has to wait for a period to close. One filing = ONE regulator batch (for
# ES a single DGOJ Lote carrying the register records for every player).
# REQ: requirements/dgoj-periodic-reporting (REQ-DGOJ-1, REQ-DGOJ-2, REQ-DGOJ-5)
PERIODIC_REPORTS = {
    "ES": [
        {"id": "RUD", "cadence": "daily"},
        {"id": "RUT", "cadence": "monthly"},
    ],
}

# Per player: settled bets in [start, end) — voided slips never count.
PERIODIC_SQL = """
SELECT a.account_id, a.national_id, a.opened_at,
       COUNT(*) AS bets_settled,
       SUM(p.stake) AS stake_sum,
       SUM(COALESCE(s.payout, 0)) AS winnings_sum,
       SUM(p.stake - COALESCE(s.payout, 0)) AS ggr_sum
FROM bet_slips b
JOIN accounts a USING (account_id)
JOIN bet_slip_events p ON p.slip_id = b.slip_id AND p.event_type = 'PLACED'
JOIN bet_slip_events s ON s.slip_id = b.slip_id AND s.event_type = 'SETTLED'
WHERE a.jurisdiction = ?
  AND NOT EXISTS (SELECT 1 FROM bet_slip_events v
                  WHERE v.slip_id = b.slip_id AND v.event_type = 'VOIDED')
  AND s.event_ts >= ? AND s.event_ts < ?
GROUP BY 1, 2, 3
ORDER BY 1
"""


def _period_window(register, period_start):
    """[start, end) UTC datetimes for a register period. period_start is a
    date: the day itself (daily) or any day in the month (monthly)."""
    from datetime import datetime, timedelta, timezone as tz
    if register["cadence"] == "monthly":
        start = datetime(period_start.year, period_start.month, 1, tzinfo=tz.utc)
        end = (datetime(period_start.year + 1, 1, 1, tzinfo=tz.utc)
               if period_start.month == 12
               else datetime(period_start.year, period_start.month + 1, 1, tzinfo=tz.utc))
    else:
        start = datetime(period_start.year, period_start.month, period_start.day, tzinfo=tz.utc)
        end = start + timedelta(days=1)
    return start, end


def submit_periodic(cur, mkt, register, period_start):
    """Generate one register filing (all players with activity in the
    period) and SOAP it to the SAFE as a single batch in the regulator's
    format. Returns (rows_filed, receipt_id) — (0, None) when the period
    holds no activity."""
    start, end = _period_window(register, period_start)
    rid = register["id"]
    cur.execute(PERIODIC_SQL, [mkt, start, end])
    rows = [{
        "player_ref": _player_ref(mkt, account_id, national_id),
        "opened_at": opened_at,
        "bets_settled": bets,
        "stake_sum": stake_sum,
        "winnings_sum": winnings_sum,
        "ggr_sum": ggr_sum,
    } for (account_id, national_id, opened_at, bets, stake_sum, winnings_sum,
           ggr_sum) in cur.fetchall()]
    if not rows:
        return 0, None
    record_key = f"{rid}-{start:%Y-%m-%d}"
    rec = {
        "record_key": record_key,
        "register_id": rid,
        "cadence": register["cadence"],
        "period_start": start,
        "period_end": end,
        "rows": rows,
    }
    receipt = _submit(mkt, rid.lower(), record_key, rec)
    _log_replace(cur, rid.lower(), f"{rid}|{start:%Y-%m-%d}", mkt, receipt)
    print(f"[SUBMIT] {mkt}/{rid.lower()} {start:%Y-%m-%d} "
          f"({len(rows)} player(s) in one filing) -> {receipt}")
    return len(rows), receipt


def run_once(cur):
    """One polling pass over all four record types. Returns records sent."""
    return (submit_pending_players(cur)
            + submit_pending_payments(cur)
            + submit_pending_bets(cur)
            + submit_pending_gaming(cur))


def run_loop(interval=POLL_SECONDS):
    """Near-realtime engine: poll, submit, sleep. Started by app.py as a
    daemon thread; resilient to the SAFE not being up yet."""
    print(f"[SUBMIT] engine polling every {interval}s -> {SAFE_BASE}/<mkt>/<type>")
    while True:
        try:
            cur = db.cursor()
            try:
                run_once(cur)
            finally:
                cur.close()
        except (urllib.error.URLError, ConnectionError) as exc:
            print(f"[SUBMIT] SAFE unreachable ({exc}); retrying in {interval}s")
        except Exception as exc:                      # never kill the demo app
            print(f"[SUBMIT] error: {exc}; retrying in {interval}s")
        time.sleep(interval)


if __name__ == "__main__":
    # standalone one-shot drain — run only while app.py is stopped (DuckDB
    # allows a single writer process). The SAFE must be running (python safe.py).
    cur = db.cursor()
    db.init_schema(cur)
    sent = run_once(cur)
    cur.close()
    db.connect().close()
    print(f"[SUBMIT] one-shot drain complete: {sent} record(s) submitted")
