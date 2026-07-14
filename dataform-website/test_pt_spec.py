# ============================================================================
# Golden-file + gazette-schema proof for the PT mapping spec.
#
# PT has no hand-written oracle module. Its oracle is twofold: golden
# files (reviewed once against the gazette structures, frozen) AND —
# uniquely — the XSDs of docs/regulator/pt/derived/, which this repo
# transcribed from the schemas Regulamento n.º 903-B/2015 prints in
# Anexo 1. Phase 2 validates every golden against them, closing the loop
# from the regulator's own gazette to the wire. (Those schemas are the
# repo's DERIVED transcription, not SRIJ's current Modelo de Dados — see
# docs/regulator/pt/derived/README.md.)
#
# Cases cover every branch: settled winner / settled loser / void (the
# g_*/r_* triplet variants), deposit vs withdrawal (CREDITO/DEBITO),
# pending vs verified registration, and the three homologated gaming
# sub-record families (fortazar / bjack / poker). The file-production
# clock (datahr) is frozen on both sides.
#
#   python test_pt_spec.py            compare + validate (exit 0/1)
#   python test_pt_spec.py --regen    rewrite the goldens (review the diff!)
# ============================================================================
import os
import sys
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone

from regulator_formats import engine
from regulator_formats.specs import pt_v1

GOLDEN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "goldens", "pt")
XSD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "docs", "regulator", "pt", "derived")
XSD_FAMILY = {"bets": "AJOG.xsd", "gaming": "AJOG.xsd",
              "payments": "TRAN.xsd", "players": "JGDR.xsd",
              "sessions": "SESS.xsd"}

FROZEN = datetime(2026, 7, 14, 12, 0, 0, tzinfo=timezone.utc)
T1 = datetime(2026, 7, 14, 10, 30, 0, tzinfo=timezone.utc)
T2 = datetime(2026, 7, 14, 11, 15, 0, tzinfo=timezone.utc)

CASES = [
    ("bets", "S6001", {   # settled winner: g_* pays, r_valor 0
        "record_key": "S6001", "slip_id": "S6001", "player_ref": "W6001",
        "username": "joana_pt", "fixture_id": "F6001", "sport": "Football",
        "event": "Alfa v Beta (Liga Demo)",
        "participants": [{"name": "Alfa"}, {"name": "Beta"}],
        "selection": "HOME", "odds": 2.5, "stake": 10.0, "payout": 25.0,
        "status": "SETTLED", "void_reason": None,
        "placed_at": T1, "terminal_at": T2,
        "balance_before_stake": 100.0, "balance_after_stake": 90.0,
        "balance_before_credit": 90.0, "balance_after_credit": 115.0,
        "balance_net": 15.0}),
    ("bets", "S6002", {   # settled loser: g_ganho 0, triplets flat
        "record_key": "S6002", "slip_id": "S6002", "player_ref": "W6001",
        "username": "joana_pt", "fixture_id": "F6001", "sport": "Tennis",
        "event": "Gama v Delta (Taca)",
        "participants": [{"name": "Gama"}, {"name": "Delta"}],
        "selection": "AWAY", "odds": 3.0, "stake": 5.0, "payout": 0,
        "status": "SETTLED", "void_reason": None,
        "placed_at": T1, "terminal_at": T2,
        "balance_before_stake": 115.0, "balance_after_stake": 110.0,
        "balance_before_credit": 110.0, "balance_after_credit": 110.0,
        "balance_net": -5.0}),
    ("bets", "S6003", {   # voided: r_* refunds the stake
        "record_key": "S6003", "slip_id": "S6003", "player_ref": "W6001",
        "username": "joana_pt", "fixture_id": "F6002", "sport": "Basketball",
        "event": "Epsilon v Zeta (Liga)",
        "participants": [{"name": "Epsilon"}, {"name": "Zeta"}],
        "selection": "HOME", "odds": 1.8, "stake": 4.0, "payout": 0,
        "status": "VOIDED", "void_reason": "erro de cotacao",
        "placed_at": T1, "terminal_at": T2,
        "balance_before_stake": 110.0, "balance_after_stake": 106.0,
        "balance_before_credit": 106.0, "balance_after_credit": 110.0,
        "balance_net": 0.0}),
    ("payments", "P6001", {
        "record_key": "P6001", "payment_id": "P6001", "player_ref": "W6001",
        "direction": "DEPOSIT", "amount": 100.0, "method": "CARD",
        "completed_at": T1, "balance": 100.0, "balance_before": 0.0}),
    ("payments", "P6002", {
        "record_key": "P6002", "payment_id": "P6002", "player_ref": "W6001",
        "direction": "WITHDRAWAL", "amount": 40.0, "method": "BANK",
        "completed_at": T2, "balance": 70.0, "balance_before": 110.0}),
    ("players", "W6001-PENDING", {
        "record_key": "W6001", "player_ref": "W6001", "jurisdiction": "PT",
        "kyc_status": "PENDING", "opened_at": T1, "username": "joana_pt",
        "national_id": "PT-NIF-123456789",
        "date_of_birth": date(1991, 3, 14), "balance": 0.0}),
    ("players", "W6001-VERIFIED", {
        "record_key": "W6001", "player_ref": "W6001", "jurisdiction": "PT",
        "kyc_status": "VERIFIED", "opened_at": T1, "username": "joana_pt",
        "national_id": "PT-NIF-123456789",
        "date_of_birth": date(1991, 3, 14), "balance": 70.0}),
    ("gaming", "R6001", {   # slots win -> fortazar
        "record_key": "R6001", "round_id": "R6001", "player_ref": "W6001",
        "username": "joana_pt", "game": "SLOTS", "game_type_code": 1,
        "stake": 2.0, "payout": 6.0, "funding": "CASH",
        "session_id": "GS6001", "played_at": T2, "status": None,
        "balance_before_stake": 70.0, "balance_after_stake": 68.0,
        "balance_before_credit": 68.0, "balance_after_credit": 74.0,
        "balance_net": 4.0}),
    ("gaming", "R6002", {   # blackjack loss -> bjack
        "record_key": "R6002", "round_id": "R6002", "player_ref": "W6001",
        "username": "joana_pt", "game": "BLACKJACK", "game_type_code": 2,
        "stake": 5.0, "payout": 0, "funding": "CASH",
        "session_id": "GS6001", "played_at": T2, "status": None,
        "balance_before_stake": 74.0, "balance_after_stake": 69.0,
        "balance_before_credit": 69.0, "balance_after_credit": 69.0,
        "balance_net": -5.0}),
    ("sessions", "GS6001", {   # platform session -> SESS_ LOGIN+LOGOUT rows
        "record_key": "GS6001", "session_id": "GS6001", "player_ref": "W6001",
        "started_at": T1, "ended_at": T2, "end_reason": "INACTIVITY",
        "events": [
            {"player_ref": "W6001", "session_id": "GS6001", "at": T1, "tipo": "LOGIN"},
            {"player_ref": "W6001", "session_id": "GS6001", "at": T2, "tipo": "LOGOUT"},
        ]}),
    ("gaming", "R6003", {   # poker win -> poker (with pinscr_* zeros)
        "record_key": "R6003", "round_id": "R6003", "player_ref": "W6001",
        "username": "joana_pt", "game": "POKER", "game_type_code": 3,
        "stake": 3.0, "payout": 9.0, "funding": "CASH",
        "session_id": None, "played_at": T2, "status": None,
        "balance_before_stake": 69.0, "balance_after_stake": 66.0,
        "balance_before_credit": 66.0, "balance_after_credit": 75.0,
        "balance_net": 6.0}),
]


def _render(root):
    ET.indent(root)
    return ET.tostring(root, encoding="unicode") + "\n"


def main(regen=False):
    failures = 0
    for record_type, label, rec in CASES:
        root = engine.serialise(pt_v1.SPEC, record_type, rec, now=FROZEN)
        fname = f"{record_type}-{label}.xml"
        path = os.path.join(GOLDEN_DIR, fname)
        actual = _render(root)
        if regen:
            os.makedirs(GOLDEN_DIR, exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(actual)
            print(f"  wrote  {fname}")
            continue
        with open(path, encoding="utf-8") as fh:
            expected = fh.read()
        if actual == expected:
            print(f"  ok  {fname}")
        else:
            failures += 1
            print(f"FAIL  {fname}\n  golden: {expected}\n  actual: {actual}")
    if not regen:
        print(f"\n{len(CASES) - failures}/{len(CASES)} documents match the goldens")
        failures += validate_against_xsd()
    return 1 if failures else 0


def validate_against_xsd():
    """Phase 2: every golden must validate against the derived gazette
    schemas — the regulator's own printed structures as the oracle."""
    try:
        import xmlschema
    except ImportError:
        print("\nXSD gate SKIPPED: xmlschema not installed (pip install -r requirements.txt)")
        return 0
    schemas = {f: xmlschema.XMLSchema(os.path.join(XSD_DIR, f))
               for f in sorted(set(XSD_FAMILY.values()))}
    failures = 0
    checked = 0
    for fname in sorted(os.listdir(GOLDEN_DIR)):
        family = XSD_FAMILY.get(fname.split("-")[0])
        if family is None:
            continue
        checked += 1
        errors = list(schemas[family].iter_errors(os.path.join(GOLDEN_DIR, fname)))
        if errors:
            failures += 1
            print(f"XSD FAIL  {fname}: {errors[0].reason}  @ {errors[0].path}")
    print(f"{checked - failures}/{checked} goldens valid against the derived gazette "
          f"schemas (docs/regulator/pt/derived/)")
    return failures


if __name__ == "__main__":
    sys.exit(main(regen="--regen" in sys.argv))
