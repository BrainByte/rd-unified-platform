# ============================================================================
# Golden-file proof for the FR mapping spec.
#
# FR has no hand-written oracle module — the spec was built directly from
# the regulator's schemas and example traces (docs/regulator/fr/), so the
# oracle is a set of GOLDEN FILES under goldens/fr/, reviewed once against
# those examples and frozen. The cases cover every document branch: a
# settled winner (MISE+GAIN), a settled loser (MISE only), a void
# (MISE+ANNUL), deposit vs withdrawal, pending vs verified KYC, and poker
# rounds with and without winnings. All timestamps come from the records
# (FR traces carry no serialisation clock), so output is deterministic.
#
# Session attribution (REQ: requirements/fr-new-jurisdiction, REQ-FR-9):
# the player-instigated cases carry a session_id and their traces must
# state it in IDSession; the operator events (GAIN/ANNUL/IDENT) must
# emit 0-sys even though the canonical record carries the player's
# session — the VERIFIED case has one precisely to prove it is ignored.
# R7002's None proves the 0-sys fallback for unstamped legacy rows.
#
#   python test_fr_spec.py            compare against the goldens (exit 0/1)
#   python test_fr_spec.py --regen    rewrite the goldens (review the diff!)
#
# Phase 2 validates every golden against the VENDORED regulator XSDs
# (docs/regulator/fr/referentiel/xsd/) — the fail-closed Option-B gate of
# docs/regulator/translation-architecture.md. The PO family is excluded:
# the regulator's own 2.0.0-draft schema does not compile (cercle.xsd
# references an undeclared `poker` namespace prefix) — exactly the kind
# of drift a schema gate exists to surface.
# ============================================================================
import os
import sys
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone

from regulator_formats import engine
from regulator_formats.specs import fr_v1

GOLDEN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "goldens", "fr")
XSD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "docs", "regulator", "fr", "referentiel", "xsd")

# record type -> root schema; gaming/PO omitted (vendored schema broken)
XSD_FAMILY = {"bets": "PASP.xsd", "payments": "CJ.xsd", "players": "CJ.xsd"}

T1 = datetime(2026, 7, 13, 10, 30, 0, tzinfo=timezone.utc)
T2 = datetime(2026, 7, 13, 11, 15, 0, tzinfo=timezone.utc)

CASES = [
    ("bets", {   # settled winner -> MISE + GAIN
        "record_key": "S7001", "slip_id": "S7001", "player_ref": "W7001",
        "fixture_id": "F7001", "sport": "Football",
        "event": "Alpha v Beta (Demo League)",
        "participants": [{"name": "Alpha"}, {"name": "Beta"}],
        "selection": "HOME", "odds": 2.5, "stake": 10.0, "payout": 25.0,
        "status": "SETTLED", "void_reason": None, "session_id": "GS7001",
        "placed_at": T1, "terminal_at": T2,
        "balance_before_stake": 100.0, "balance_after_stake": 90.0,
        "balance_before_credit": 90.0, "balance_after_credit": 115.0}),
    ("bets", {   # settled loser -> MISE only (no gain event exists)
        "record_key": "S7002", "slip_id": "S7002", "player_ref": "W7001",
        "fixture_id": "F7001", "sport": "Tennis",
        "event": "Gamma v Delta (Cup)",
        "participants": [{"name": "Gamma"}, {"name": "Delta"}],
        "selection": "AWAY", "odds": 3.0, "stake": 5.0, "payout": 0,
        "status": "SETTLED", "void_reason": None, "session_id": "GS7001",
        "placed_at": T1, "terminal_at": T2,
        "balance_before_stake": 115.0, "balance_after_stake": 110.0,
        "balance_before_credit": 110.0, "balance_after_credit": 110.0}),
    ("bets", {   # voided -> MISE + ANNUL (stake refunded)
        "record_key": "S7003", "slip_id": "S7003", "player_ref": "W7001",
        "fixture_id": "F7002", "sport": "Basketball",
        "event": "Epsilon v Zeta (League)",
        "participants": [{"name": "Epsilon"}, {"name": "Zeta"}],
        "selection": "HOME", "odds": 1.8, "stake": 4.0, "payout": 0,
        "status": "VOIDED", "void_reason": "palpable error",
        "session_id": "GS7002",
        "placed_at": T1, "terminal_at": T2,
        "balance_before_stake": 110.0, "balance_after_stake": 106.0,
        "balance_before_credit": 106.0, "balance_after_credit": 110.0}),
    ("payments", {
        "record_key": "P7001", "payment_id": "P7001", "player_ref": "W7001",
        "direction": "DEPOSIT", "amount": 100.0, "method": "CARD",
        "session_id": "GS7001",
        "completed_at": T1, "balance": 100.0, "balance_before": 0.0}),
    ("payments", {
        "record_key": "P7002", "payment_id": "P7002", "player_ref": "W7001",
        "direction": "WITHDRAWAL", "amount": 40.0, "method": "BANK",
        "session_id": "GS7002",
        "completed_at": T2, "balance": 70.0, "balance_before": 110.0}),
    ("players", {  # pending -> OUVINFOPERSO (account opening, signup session)
        "record_key": "W7001-PENDING", "player_ref": "W7001", "jurisdiction": "FR",
        "kyc_status": "PENDING", "opened_at": T1, "username": "amelie_fr",
        "session_id": "GS7000",
        "date_of_birth": date(1991, 3, 14), "balance": 0.0}),
    ("players", {  # verified -> CPTEIDENTITE (operator event: the session
                   # on the record must be IGNORED — the trace says 0-sys)
        "record_key": "W7001-VERIFIED", "player_ref": "W7001", "jurisdiction": "FR",
        "kyc_status": "VERIFIED", "opened_at": T1, "username": "amelie_fr",
        "session_id": "GS7005",
        "date_of_birth": date(1991, 3, 14), "balance": 70.0}),
    ("gaming", {   # poker win -> POACHAT + POGAIN
        "record_key": "R7001", "round_id": "R7001", "player_ref": "W7001",
        "game": "POKER", "game_type_code": 3, "stake": 2.0, "payout": 6.0,
        "funding": "CASH", "session_id": "GS7001", "played_at": T2,
        "balance_before_stake": 70.0, "balance_after_stake": 68.0,
        "balance_before_credit": 68.0, "balance_after_credit": 74.0}),
    ("gaming", {   # poker loss -> POACHAT only
        "record_key": "R7002", "round_id": "R7002", "player_ref": "W7001",
        "game": "POKER", "game_type_code": 3, "stake": 3.0, "payout": 0,
        "funding": "CASH", "session_id": None, "played_at": T2,
        "balance_before_stake": 74.0, "balance_after_stake": 71.0,
        "balance_before_credit": 71.0, "balance_after_credit": 71.0}),
]

# every document each case must (and may only) produce
EXPECTED_DOCS = {
    "S7001": ["MISE", "GAIN"], "S7002": ["MISE"], "S7003": ["MISE", "ANNUL"],
    "P7001": ["ALIM"], "P7002": ["RETRAIT"],
    "W7001-PENDING": ["OUV"], "W7001-VERIFIED": ["IDENT"],
    "R7001": ["ACHAT", "GAIN"], "R7002": ["ACHAT"],
}


def _render(root):
    ET.indent(root)
    return ET.tostring(root, encoding="unicode") + "\n"


def main(regen=False):
    failures = 0
    for record_type, rec in CASES:
        key = rec["record_key"]
        docs = engine.serialise_documents(fr_v1.SPEC, record_type, rec)
        suffixes = [s for s, _ in docs]
        if suffixes != EXPECTED_DOCS[key]:
            failures += 1
            print(f"FAIL  {key}: documents {suffixes}, expected {EXPECTED_DOCS[key]}")
            continue
        for suffix, root in docs:
            fname = f"{record_type}-{key}-{suffix}.xml"
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
        total = sum(len(v) for v in EXPECTED_DOCS.values())
        print(f"\n{total - failures}/{total} documents match the goldens"
              + ("" if not failures else f" — {failures} DIVERGENT"))
        failures += validate_against_xsd()
    return 1 if failures else 0


def validate_against_xsd():
    """Phase 2: every golden must validate against its vendored root XSD."""
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
            continue                     # PO family: vendored schema broken
        checked += 1
        errors = list(schemas[family].iter_errors(os.path.join(GOLDEN_DIR, fname)))
        if errors:
            failures += 1
            print(f"XSD FAIL  {fname}: {errors[0].reason}")
    print(f"{checked - failures}/{checked} goldens valid against the vendored XSDs "
          f"(PO family excluded: the regulator's draft cercle.xsd does not compile)")
    return failures


if __name__ == "__main__":
    sys.exit(main(regen="--regen" in sys.argv))
