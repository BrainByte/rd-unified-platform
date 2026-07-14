# ============================================================================
# NL — KSA Controle Databank v1.11 as a MAPPING SPEC (pure data).
#
# This file contains no logic: it declares what regulator_formats/nl.py
# used to do imperatively, in the binding vocabulary of engine.py. Element
# order below is the schema's sequence order (dicts preserve it). The spec
# is proven byte-identical to the hand-written module by
# dataform-website/test_nl_spec.py, which keeps nl.py as the test oracle.
#
# Schema source: docs/regulator/nl/wok_*_v1.11.xsd; design rationale:
# docs/regulator/translation-architecture.md (Option A).
# ============================================================================

SPEC = {
    "market": "NL",
    "schema_version": "1.11",

    "config": {
        "operator_id": "BETNOVA",
        "data_safe_id": "CDB-BETNOVA-1",
    },

    # every CDB file is a <Root> of records of one type
    "envelope": {"root": "Root"},

    # the four-field header every WOK record opens with; Record_ID is the
    # deterministic uuid5 of the record's business key
    "record_header": {
        "Record_ID":       {"uid_from_key": True},
        "Extraction_Date": {"now": True, "as": "datetime"},
        "Operator_ID":     {"config": "operator_id"},
        "Data_Safe_ID":    {"config": "data_safe_id"},
    },

    "records": {

        "bets": {
            "element": "WOK_Bet_v1.11",
            "key": ["nl-bet", "$slip_id", "$status"],
            "fields": {
                "Bet_ID":             {"uid": ["nl-bet-id", "$slip_id"]},
                "Bet_Start_Datetime": {"from": "placed_at", "as": "datetime"},
                "Bet_Type":           {"const": "SINGLE"},
                "Bet_Status":         {"const": "BET_SETTLED"},
                "Bet_Parts": {"children": {
                    "Part": {"children": {
                        "Part_ID":    {"uid": ["nl-part", "$slip_id"]},
                        "Part_Event": {"from": "event", "truncate": 256},
                        "Part_Odds":  {"from": "odds", "as": "money"},
                        "Part_Sport": {"from": "sport", "truncate": 32},
                        "Part_Live":  {"const": "false"},
                        "Part_Match_Datetime": {"from": "placed_at", "as": "datetime"},
                        "Part_Prognosis_Result_Type": {"const": "MATCH ODDS"},
                        "Part_Prognosis_Value": {"from": "selection"},
                        "Part_Stake": {"from": "stake", "as": "money"},
                    }},
                }},
                "Bet_Total_Stake": {"from": "stake", "as": "money"},
                "Bet_Transactions": {"children": {
                    "Bet_Transaction": {"children": {
                        "Transaction_ID":    {"uid": ["nl-txn", "$slip_id", "STAKE"]},
                        "Player_Profile_ID": {"from": "player_ref"},
                    }},
                }},
            },
        },

        "payments": {
            "element": "WOK_Player_Account_Transaction_v1.11",
            "key": ["nl-payment", "$payment_id"],
            "fields": {
                "Player_Profile_ID":    {"from": "player_ref"},
                "Transaction_ID":       {"uid": ["nl-txn", "$payment_id"]},
                "Transaction_Datetime": {"from": "completed_at", "as": "datetime"},
                "Transaction_Amount":   {"from": "amount", "as": "money"},
                "Transaction_Deposit_Instrument": {
                    "when": {"field": "direction", "equals": "DEPOSIT"},
                    "from": "method",
                    "map": {"CARD": "CREDIT_CARD", "BANK": "BANK_TRANSFER"},
                    "default": "OTHER",
                },
                "Transaction_Type":   {"from": "direction"},   # DEPOSIT / WITHDRAWAL
                "Transaction_Status": {"const": "SUCCESSFUL"},
            },
        },

        "players": {
            "element": "WOK_Player_Profile_v1.11",
            "key": ["nl-player", "$player_ref", "$kyc_status"],
            "fields": {
                "Player_Profile_ID": {"from": "player_ref"},
                "Player_Profile_Registration_Datetime": {"from": "opened_at", "as": "datetime"},
                "Player_Profile_DOB": {
                    "when": {"field": "date_of_birth", "present": True},
                    "from": "date_of_birth", "as": "date",
                },
                "Player_Profile_Modified": {"now": True, "as": "datetime"},
                "Player_Profile_Status": {
                    "from": "kyc_status",
                    "map": {"VERIFIED": "ACTIVE"}, "default": "TRIAL",
                },
                "Player_Profile_EOD_Balance": {"from": "balance", "as": "money"},
            },
        },

        # true per-game sessions: one record per DERIVED (platform session
        # x game) — single Game_ID each, the CDB's structural invariant.
        # The gaming stream below remains for markets consuming rounds;
        # for NL the submission engine routes rounds VIA these sessions.
        # REQ: requirements/session-tracking (REQ-ST-4/6)
        "sessions": {
            "element": "WOK_Game_Session_v1.11",
            "key": ["nl-gsession", "$session_id", "$game"],
            "fields": {
                "Game_ID":         {"uid": ["nl-game", "$game"]},
                "Game_Session_ID": {"uid": ["nl-gsession", "$session_id", "$game"]},
                "Game_Session_Start_Datetime": {"from": "first_played_at", "as": "datetime"},
                "Game_Session_End_Datetime":   {"from": "last_played_at", "as": "datetime"},
                "Game_Session_Rounds":     {"count": "rounds"},
                "Game_Session_Rounds_Won": {"from": "rounds_won"},
                "Game_Transactions": {"children": {
                    "Game_Transaction": {"each": "rounds", "children": {
                        # same Transaction_ID derivation as the per-round
                        # stream, so identifiers stay consistent across grains
                        "Transaction_ID":    {"uid": ["nl-txn", "$round_id", "STAKE"]},
                        "Player_Profile_ID": {"from": "player_ref"},
                    }},
                }},
            },
        },

        "gaming": {
            "element": "WOK_Game_Session_v1.11",
            "key": ["nl-gaming", "$round_id"],
            "fields": {
                "Game_ID":         {"uid": ["nl-game", "$game"]},
                "Game_Session_ID": {"uid": ["nl-session", "$round_id"]},
                "Game_Session_Start_Datetime": {"from": "played_at", "as": "datetime"},
                "Game_Session_End_Datetime":   {"from": "played_at", "as": "datetime"},
                "Game_Session_Rounds":     {"const": "1"},
                "Game_Session_Rounds_Won": {"from": "payout", "as": "flag-positive"},
                "Game_Transactions": {"children": {
                    "Game_Transaction": {"children": {
                        "Transaction_ID":    {"uid": ["nl-txn", "$round_id", "STAKE"]},
                        "Player_Profile_ID": {"from": "player_ref"},
                    }},
                }},
            },
        },
    },
}
