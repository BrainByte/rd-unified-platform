# ============================================================================
# NL — KSA Controle Databank (CDB) data model v1.11 (docs/regulator/nl).
#
# Every CDB file is a <Root> of 1..512 records of one versioned type
# (WOK_Bet_v1.11, ...). Every record opens with the same header: Record_ID
# (lowercase UUID), Extraction_Date (strict YYYY-MM-DDThh:mm:ssZ — the
# schema pattern rejects offsets and fractional seconds), Operator_ID and
# Data_Safe_ID. Amounts are 2-decimal with NO currency element (EUR is
# implicit); business identifiers that the schema types as UID are derived
# deterministically from the demo's readable ids (uuid5), so re-runs
# reproduce the same regulator identifiers.
#
# Mapping choices:
#   bets     -> WOK_Bet_v1.11: a SINGLE bet with one Part (event, odds,
#               prognosis = the selection) and its STAKE transaction ref.
#   payments -> WOK_Player_Account_Transaction_v1.11 (the financial spine).
#   players  -> WOK_Player_Profile_v1.11: pseudonymised exactly as the KSA
#               wants it — profile id, DOB and balance, no name/address.
#   gaming   -> WOK_Game_Session_v1.11 with one round (the demo reports per
#               round; the KSA aggregates casino play to session level).
#
# Demo defaults, stated once: Part_Match_Datetime uses the placement time
# (the demo does not carry the fixture kick-off into submission), and the
# NL market suppresses voids upstream so bets always arrive BET_SETTLED.
# ============================================================================
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from ._util import el, iso_z, money2, uid

OPERATOR_ID = "BETNOVA"
DATA_SAFE_ID = "CDB-BETNOVA-1"


def _record(record_name, *key):
    root = ET.Element("Root")
    record = el(root, record_name)
    el(record, "Record_ID", uid(*key))
    el(record, "Extraction_Date", iso_z(datetime.now(timezone.utc)))
    el(record, "Operator_ID", OPERATOR_ID)
    el(record, "Data_Safe_ID", DATA_SAFE_ID)
    return root, record


def bet(rec):
    root, record = _record("WOK_Bet_v1.11", "nl-bet", rec["slip_id"], rec["status"])
    el(record, "Bet_ID", uid("nl-bet-id", rec["slip_id"]))
    el(record, "Bet_Start_Datetime", iso_z(rec["placed_at"]))
    el(record, "Bet_Type", "SINGLE")
    el(record, "Bet_Status", "BET_SETTLED")
    part = el(el(record, "Bet_Parts"), "Part")
    el(part, "Part_ID", uid("nl-part", rec["slip_id"]))
    el(part, "Part_Event", rec["event"][:256])
    el(part, "Part_Odds", money2(rec["odds"]))
    el(part, "Part_Sport", rec["sport"][:32])
    el(part, "Part_Live", "false")
    el(part, "Part_Match_Datetime", iso_z(rec["placed_at"]))
    el(part, "Part_Prognosis_Result_Type", "MATCH ODDS")
    el(part, "Part_Prognosis_Value", rec["selection"])
    el(part, "Part_Stake", money2(rec["stake"]))
    el(record, "Bet_Total_Stake", money2(rec["stake"]))
    txn = el(el(record, "Bet_Transactions"), "Bet_Transaction")
    el(txn, "Transaction_ID", uid("nl-txn", rec["slip_id"], "STAKE"))
    el(txn, "Player_Profile_ID", rec["player_ref"])
    return root


def payment(rec):
    root, record = _record("WOK_Player_Account_Transaction_v1.11",
                           "nl-payment", rec["payment_id"])
    el(record, "Player_Profile_ID", rec["player_ref"])
    el(record, "Transaction_ID", uid("nl-txn", rec["payment_id"]))
    el(record, "Transaction_Datetime", iso_z(rec["completed_at"]))
    el(record, "Transaction_Amount", money2(rec["amount"]))
    if rec["direction"] == "DEPOSIT":
        instrument = {"CARD": "CREDIT_CARD", "BANK": "BANK_TRANSFER"}
        el(record, "Transaction_Deposit_Instrument",
           instrument.get(rec["method"], "OTHER"))
    el(record, "Transaction_Type", rec["direction"])   # DEPOSIT / WITHDRAWAL
    el(record, "Transaction_Status", "SUCCESSFUL")
    return root


def player(rec):
    root, record = _record("WOK_Player_Profile_v1.11",
                           "nl-player", rec["player_ref"], rec["kyc_status"])
    el(record, "Player_Profile_ID", rec["player_ref"])
    el(record, "Player_Profile_Registration_Datetime", iso_z(rec["opened_at"]))
    if rec.get("date_of_birth") is not None:
        el(record, "Player_Profile_DOB", rec["date_of_birth"].strftime("%Y-%m-%d"))
    el(record, "Player_Profile_Modified", iso_z(datetime.now(timezone.utc)))
    el(record, "Player_Profile_Status",
       "ACTIVE" if rec["kyc_status"] == "VERIFIED" else "TRIAL")
    el(record, "Player_Profile_EOD_Balance", money2(rec["balance"]))
    return root


def gaming(rec):
    root, record = _record("WOK_Game_Session_v1.11", "nl-gaming", rec["round_id"])
    el(record, "Game_ID", uid("nl-game", rec["game"]))
    el(record, "Game_Session_ID", uid("nl-session", rec["round_id"]))
    el(record, "Game_Session_Start_Datetime", iso_z(rec["played_at"]))
    el(record, "Game_Session_End_Datetime", iso_z(rec["played_at"]))
    el(record, "Game_Session_Rounds", "1")
    el(record, "Game_Session_Rounds_Won", "1" if float(rec["payout"]) > 0 else "0")
    txn = el(el(record, "Game_Transactions"), "Game_Transaction")
    el(txn, "Transaction_ID", uid("nl-txn", rec["round_id"], "STAKE"))
    el(txn, "Player_Profile_ID", rec["player_ref"])
    return root
