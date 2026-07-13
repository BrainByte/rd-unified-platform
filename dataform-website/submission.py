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


def _el(parent, name, value):
    if value is None:
        return
    ET.SubElement(parent, name).text = str(value)


def _soap_submit(mkt, rtype, record_el):
    """POST one <Record> to the SAFE; returns the ReceiptId (raises on fault)."""
    envelope = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">'
        "<soap:Body><SubmitRecord>"
        + ET.tostring(record_el, encoding="unicode") +
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


def _log(cur, rtype, key, mkt, receipt):
    cur.execute("INSERT INTO safe_submissions VALUES (?, ?, ?, ?, ?)",
                [rtype, key, mkt, receipt, db.now()])


# ---- record type: bets (the submission-table analog) -----------------------
PENDING_BETS_SQL = """
SELECT b.slip_id, a.jurisdiction, a.account_id, a.national_id,
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
    for (slip_id, mkt, account_id, national_id, sport, comp, home, away,
         selection, odds, stake, status, payout, reason, placed_at, terminal_at) in cur.fetchall():
        meta = MARKETS.get(mkt)
        if meta is None:
            continue
        if status == "VOIDED" and not meta["include_voided"]:
            # this market never reports voids; log it as suppressed so we
            # don't re-examine the slip every poll
            _log(cur, "bets", f"{slip_id}|VOIDED", mkt, "SUPPRESSED-VOID")
            continue
        rec = ET.Element("Record", {"type": "bet", "id": slip_id})
        _el(rec, "SlipId", slip_id)
        _el(rec, "PlayerRef", _player_ref(mkt, account_id, national_id))
        _el(rec, "Sport", sport)
        _el(rec, "Event", f"{home} v {away} ({comp})")
        _el(rec, "Selection", selection)
        _el(rec, "Odds", f"{float(odds):.2f}")
        _el(rec, "Stake", f"{float(stake):.2f}")
        _el(rec, "Payout", f"{float(payout):.2f}")
        if meta["include_voided"]:
            _el(rec, "Status", status)
        if status == "VOIDED":
            _el(rec, "VoidReason", reason or "voided")
        _el(rec, "PlacedAt", placed_at.isoformat())
        _el(rec, "SettledAt", terminal_at.isoformat() if terminal_at else None)
        receipt = _soap_submit(mkt, "bets", rec)
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
        rec = ET.Element("Record", {"type": "payment", "id": payment_id})
        _el(rec, "PaymentId", payment_id)
        _el(rec, "PlayerRef", _player_ref(mkt, account_id, national_id))
        _el(rec, "Direction", direction)
        _el(rec, "Amount", f"{float(amount):.2f}")
        _el(rec, "Method", method)
        _el(rec, "CompletedAt", completed_ts.isoformat())
        receipt = _soap_submit(mkt, "payments", rec)
        _log(cur, "payments", payment_id, mkt, receipt)
        print(f"[SUBMIT] {mkt}/payments {payment_id} ({direction}) -> {receipt}")
        n += 1
    return n


# ---- record type: players (re-reported when KYC status changes) -------------
PENDING_PLAYERS_SQL = """
SELECT a.account_id, a.jurisdiction, a.national_id, a.kyc_status, a.opened_at
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
    for (account_id, mkt, national_id, kyc_status, opened_at) in cur.fetchall():
        if mkt not in MARKETS:
            continue
        rec = ET.Element("Record", {"type": "player", "id": account_id})
        _el(rec, "PlayerRef", _player_ref(mkt, account_id, national_id))
        _el(rec, "Jurisdiction", mkt)
        _el(rec, "KycStatus", kyc_status)
        _el(rec, "OpenedAt", opened_at.isoformat())
        receipt = _soap_submit(mkt, "players", rec)
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
        rec = ET.Element("Record", {"type": "gaming", "id": round_id})
        _el(rec, "RoundId", round_id)
        _el(rec, "PlayerRef", _player_ref(mkt, account_id, national_id))
        _el(rec, "Game", game)
        # the configurable magic number: operator-jackpot rounds are
        # deducible from the gaming data alone.
        # REQ: requirements/operator-jackpots (REQ-OJ-8)
        _el(rec, "GameType", GAME_TYPE_CODES.get(game))
        _el(rec, "Stake", f"{float(stake):.2f}")
        _el(rec, "Payout", f"{float(payout):.2f}")
        # bonus-funded play is visible to the regulator:
        # REQ: requirements/golden-chips (REQ-GC-6)
        _el(rec, "Funding", funding)
        # the gaming session this play belonged to.
        # REQ: requirements/operator-jackpots (REQ-OJ-2)
        _el(rec, "SessionId", session_id)
        _el(rec, "PlayedAt", round_ts.isoformat())
        receipt = _soap_submit(mkt, "gaming", rec)
        _log(cur, "gaming", round_id, mkt, receipt)
        print(f"[SUBMIT] {mkt}/gaming {round_id} ({game}) -> {receipt}")
        n += 1
    return n


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
