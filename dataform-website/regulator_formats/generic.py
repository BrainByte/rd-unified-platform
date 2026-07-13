# The neutral BetNova <Record> format — used for jurisdictions with no
# sampled regulator schema (MT, BG, DE) and for record types a regulator
# defines no model for (e.g. DK account movements). This is the shape the
# whole demo used before the per-regulator formats existed.
import xml.etree.ElementTree as ET

from ._util import el, utc

# canonical field -> element name, in output order, per record type
_FIELDS = {
    "bet": ["slip_id", "player_ref", "sport", "event", "selection", "odds",
            "stake", "payout", "status", "void_reason", "placed_at", "terminal_at"],
    "payment": ["payment_id", "player_ref", "direction", "amount", "method",
                "completed_at"],
    "player": ["player_ref", "jurisdiction", "kyc_status", "opened_at"],
    "gaming": ["round_id", "player_ref", "game", "game_type_code", "stake",
               "payout", "funding", "session_id", "played_at"],
}

_NAMES = {
    "slip_id": "SlipId", "player_ref": "PlayerRef", "sport": "Sport",
    "event": "Event", "selection": "Selection", "odds": "Odds",
    "stake": "Stake", "payout": "Payout", "status": "Status",
    "void_reason": "VoidReason", "placed_at": "PlacedAt",
    "terminal_at": "SettledAt", "payment_id": "PaymentId",
    "direction": "Direction", "amount": "Amount", "method": "Method",
    "completed_at": "CompletedAt", "jurisdiction": "Jurisdiction",
    "kyc_status": "KycStatus", "opened_at": "OpenedAt",
    "round_id": "RoundId", "game": "Game", "game_type_code": "GameType",
    "played_at": "PlayedAt",
}

_MONEY = {"odds", "stake", "payout", "amount"}
_TIMES = {"placed_at", "terminal_at", "completed_at", "opened_at", "played_at"}


def record(record_type, rec):
    singular = {"bets": "bet", "payments": "payment", "players": "player",
                "gaming": "gaming"}.get(record_type, record_type)
    root = ET.Element("Record", {"type": singular, "id": rec["record_key"]})
    for field in _FIELDS.get(singular, sorted(k for k in rec if k != "record_key")):
        value = rec.get(field)
        if value is None:
            continue
        if field in _MONEY:
            value = f"{float(value):.2f}"
        elif field in _TIMES:
            value = utc(value).isoformat()
        el(root, _NAMES.get(field, field), value)
    return root
