# ============================================================================
# Byte-identity proof for the mapping-driven engine (NL).
#
# The hand-written regulator_formats/nl.py is the ORACLE; the engine +
# specs/nl_v1_11.py must reproduce its output byte-for-byte over canonical
# records covering every branch (deposit/withdrawal, known/unknown payment
# method, verified/pending KYC, DOB present/absent, winning/losing rounds,
# void-suppressed bets). The clock is frozen on both sides so
# Extraction_Date/Modified compare equal.
#
#   python test_nl_spec.py        (exit 0 = identical, 1 = divergence)
# ============================================================================
import sys
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone
from types import SimpleNamespace

from regulator_formats import engine, nl
from regulator_formats.specs import nl_v1_11

FROZEN = datetime(2026, 7, 13, 12, 0, 0, tzinfo=timezone.utc)
nl.datetime = SimpleNamespace(now=lambda tz=None: FROZEN)   # freeze the oracle

T1 = datetime(2026, 7, 13, 10, 30, 0, tzinfo=timezone.utc)
T2 = datetime(2026, 7, 13, 11, 15, 0, tzinfo=timezone.utc)

CASES = [
    ("bets", nl.bet, {
        "record_key": "S9001", "slip_id": "S9001", "player_ref": "a" * 64,
        "fixture_id": "F9001", "sport": "Football",
        "event": "Alpha v Beta (Demo League)", "selection": "HOME",
        "odds": 2.5, "stake": 10.0, "payout": 25.0,
        "status": None, "void_reason": None,        # NL suppresses voids
        "placed_at": T1, "terminal_at": T2}),
    ("bets", nl.bet, {                              # long event/sport truncate
        "record_key": "S9002", "slip_id": "S9002", "player_ref": "b" * 64,
        "fixture_id": "F9002", "sport": "S" * 40, "event": "E" * 300,
        "selection": "AWAY", "odds": 11.0, "stake": 0.5, "payout": 0,
        "status": None, "void_reason": None, "placed_at": T1, "terminal_at": T2}),
    ("payments", nl.payment, {
        "record_key": "P9001", "payment_id": "P9001", "player_ref": "c" * 64,
        "direction": "DEPOSIT", "amount": 100.0, "method": "CARD",
        "completed_at": T1, "balance": 100.0}),
    ("payments", nl.payment, {                      # unknown method -> OTHER
        "record_key": "P9002", "payment_id": "P9002", "player_ref": "c" * 64,
        "direction": "DEPOSIT", "amount": 20.0, "method": "CRYPTO",
        "completed_at": T1, "balance": 120.0}),
    ("payments", nl.payment, {                      # withdrawal: no instrument
        "record_key": "P9003", "payment_id": "P9003", "player_ref": "c" * 64,
        "direction": "WITHDRAWAL", "amount": 50.0, "method": "BANK",
        "completed_at": T2, "balance": 70.0}),
    ("players", nl.player, {
        "record_key": "W9001", "player_ref": "d" * 64, "jurisdiction": "NL",
        "kyc_status": "VERIFIED", "opened_at": T1,
        "date_of_birth": date(1991, 3, 14), "balance": 70.0}),
    ("players", nl.player, {                        # pending KYC, no DOB
        "record_key": "W9002", "player_ref": "e" * 64, "jurisdiction": "NL",
        "kyc_status": "PENDING", "opened_at": T2,
        "date_of_birth": None, "balance": 0.0}),
    ("gaming", nl.gaming, {
        "record_key": "R9001", "round_id": "R9001", "player_ref": "f" * 64,
        "game": "SLOTS", "game_type_code": 1, "stake": 2.0, "payout": 6.0,
        "funding": "CASH", "session_id": "GS9001", "played_at": T2}),
    ("gaming", nl.gaming, {                         # losing round -> Rounds_Won 0
        "record_key": "R9002", "round_id": "R9002", "player_ref": "f" * 64,
        "game": "BLACKJACK", "game_type_code": 2, "stake": 5.0, "payout": 0,
        "funding": "GOLDEN_CHIP", "session_id": None, "played_at": T2}),
]


def main():
    failures = 0
    for record_type, oracle, rec in CASES:
        expected = ET.tostring(oracle(rec), encoding="unicode")
        actual = ET.tostring(
            engine.serialise(nl_v1_11.SPEC, record_type, rec, now=FROZEN),
            encoding="unicode")
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
