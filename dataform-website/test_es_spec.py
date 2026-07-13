# ============================================================================
# Byte-identity proof for the mapping-driven engine (ES).
#
# The hand-written regulator_formats/es.py is the ORACLE; the engine +
# specs/es_v3_3.py must reproduce its output byte-for-byte over canonical
# records covering every branch: deposits vs withdrawals (Depositos /
# Retiradas variants), known vs missing payment method, pending vs verified
# KYC, gaming with and without a session id, and the two-registro periodic
# filings (RUD daily, RUT monthly) with their per-row Jugador loops.
# es.py takes no clock — every date comes from the record — so no freezing
# is needed.
#
#   python test_es_spec.py        (exit 0 = identical, 1 = divergence)
# ============================================================================
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from regulator_formats import engine, es
from regulator_formats.specs import es_v3_3

T1 = datetime(2026, 7, 13, 10, 30, 0, tzinfo=timezone.utc)
T2 = datetime(2026, 7, 13, 11, 15, 0, tzinfo=timezone.utc)
DAY = datetime(2026, 7, 13, 0, 0, 0, tzinfo=timezone.utc)
MONTH = datetime(2026, 7, 1, 0, 0, 0, tzinfo=timezone.utc)

ROWS = [
    {"player_ref": "a" * 64, "opened_at": T1, "bets_settled": 3,
     "stake_sum": 30.0, "winnings_sum": 12.5, "ggr_sum": 17.5},
    {"player_ref": "b" * 64, "opened_at": T2, "bets_settled": 1,
     "stake_sum": 5.0, "winnings_sum": 0.0, "ggr_sum": 5.0},
]

CASES = [
    ("bets", es.bet, {
        "record_key": "S8001", "slip_id": "S8001", "player_ref": "c" * 64,
        "fixture_id": "F8001", "sport": "Football",
        "event": "Alpha v Beta (Demo League)", "selection": "HOME",
        "odds": 2.5, "stake": 10.0, "payout": 25.0,
        "status": None, "void_reason": None,        # ES suppresses voids
        "placed_at": T1, "terminal_at": T2}),
    ("payments", es.payment, {
        "record_key": "P8001", "payment_id": "P8001", "player_ref": "c" * 64,
        "direction": "DEPOSIT", "amount": 100.0, "method": "CARD",
        "completed_at": T1, "balance": 100.0}),
    ("payments", es.payment, {                      # no method -> OTRO / 99
        "record_key": "P8002", "payment_id": "P8002", "player_ref": "c" * 64,
        "direction": "DEPOSIT", "amount": 20.0, "method": None,
        "completed_at": T1, "balance": 120.0}),
    ("payments", es.payment, {                      # withdrawal -> Retiradas side
        "record_key": "P8003", "payment_id": "P8003", "player_ref": "c" * 64,
        "direction": "WITHDRAWAL", "amount": 50.0, "method": "BANK",
        "completed_at": T2, "balance": 70.0}),
    ("players", es.player, {                        # PENDING -> CambiosEnDatos A
        "record_key": "W8001", "player_ref": "d" * 64, "jurisdiction": "ES",
        "kyc_status": "PENDING", "opened_at": T1,
        "date_of_birth": None, "balance": 0.0}),
    ("players", es.player, {                        # VERIFIED -> S
        "record_key": "W8002", "player_ref": "e" * 64, "jurisdiction": "ES",
        "kyc_status": "VERIFIED", "opened_at": T2,
        "date_of_birth": None, "balance": 10.0}),
    ("gaming", es.gaming, {
        "record_key": "R8001", "round_id": "R8001", "player_ref": "f" * 64,
        "game": "SLOTS", "game_type_code": 1, "stake": 2.0, "payout": 6.0,
        "funding": "CASH", "session_id": "GS8001", "played_at": T2}),
    ("gaming", es.gaming, {                         # no session -> round id fallback
        "record_key": "R8002", "round_id": "R8002", "player_ref": "f" * 64,
        "game": "OTHER_GAME", "game_type_code": None, "stake": 5.0, "payout": 0,
        "funding": "GOLDEN_CHIP", "session_id": None, "played_at": T2}),
    ("rud", es.periodic_rud, {
        "record_key": "RUD-2026-07-13", "register_id": "RUD", "cadence": "daily",
        "period_start": DAY, "period_end": DAY, "rows": ROWS}),
    ("rut", es.periodic_rut, {
        "record_key": "RUT-2026-07-01", "register_id": "RUT", "cadence": "monthly",
        "period_start": MONTH, "period_end": MONTH, "rows": ROWS}),
]


def main():
    failures = 0
    for record_type, oracle, rec in CASES:
        expected = ET.tostring(oracle(rec), encoding="unicode")
        actual = ET.tostring(
            engine.serialise(es_v3_3.SPEC, record_type, rec), encoding="unicode")
        if expected == actual:
            print(f"  ok  {record_type:<9} {rec['record_key']}")
        else:
            failures += 1
            print(f"FAIL  {record_type:<9} {rec['record_key']}")
            print(f"  oracle: {expected}")
            print(f"  engine: {actual}")
    print(f"\n{len(CASES) - failures}/{len(CASES)} byte-identical"
          + ("" if not failures else f" — {failures} DIVERGENT"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
