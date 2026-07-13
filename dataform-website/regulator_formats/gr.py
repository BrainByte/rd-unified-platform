# ============================================================================
# GR — Hellenic Gaming Commission online data models (docs/regulator/gr).
#
# Every HGC file is a single-model <Batch>: a BatchHeader (FileID sequence
# number + LicenseeID, the operator's Greek VAT number as elXXXXXXXXX)
# followed by records of exactly one data model. Records carry a UUID
# RecordID, timestamps are pattern-forced UTC (`...Z`), amounts are
# 2-decimal MonetaryAmount with an ISO currency alongside, and coded values
# are the HGC's integer lists.
#
# Mapping choices:
#   bets     -> Online_Betting (model 2). HGC splits placement from
#               settlement: the wager, odds and selection live here; the
#               amount won belongs to Online_Betting_Winnings (model 3),
#               which this demo does not file — noted, not hidden.
#   payments -> Online_Customer_Account_Transaction (model 22), the player
#               wallet ledger (credit=1 / debit=0, balance after).
#   players  -> Online_Customer_Account (model 21). The demo pseudonymises
#               players, so the KYC identity block (name, ID number,
#               address, email) is omitted.
#   gaming   -> Online_Game (model 5): an RNG game session (category A=2)
#               with certified game/paytable/RNG identifiers.
# ============================================================================
import time
import xml.etree.ElementTree as ET

from ._util import el, iso_z, money2, uid, utc

NS = "https://www.gamingcommission.gov.gr"
LICENSEE_ID = "el999999999"      # HGC licensee id: Greek VAT, elXXXXXXXXX
DOMAIN = "www.betnova.example"   # licensed domain the activity occurred on
CURRENCY = "EUR"

# demo game -> GameCategoryB (1 slots, 2 blackjack, 0 other)
_CATEGORY_B = {"SLOTS": "1", "BLACKJACK": "2", "POKER": "0",
               "operator-jackpots": "0"}


def _batch(record_name):
    """Batch + BatchHeader; FileID is the licensee-assigned sequence number
    (time-derived here — the demo keeps no per-licensee file counter)."""
    root = ET.Element("Batch", {"xmlns": NS})
    header = el(root, "BatchHeader")
    el(header, "FileID", str(time.time_ns()))
    el(header, "LicenseeID", LICENSEE_ID)
    return root, el(root, record_name)


def _record_id(record, *key):
    el(record, "RecordID", uid(*key))


def bet(rec):
    root, betting = _batch("Online_Betting")
    _record_id(betting, "gr-bet", rec["slip_id"], rec["status"])
    el(betting, "PlayerID", rec["player_ref"])
    el(betting, "ManufacturerLN", "BETNOVA")
    bet_data = el(betting, "BetData")
    el(bet_data, "BetID", rec["slip_id"])
    el(bet_data, "BetName", rec["event"][:40])
    event = el(bet_data, "BetEventData")
    el(event, "BetEventID", rec["fixture_id"])
    el(event, "MarketID", "1X2")
    el(event, "PlayerSelection", rec["selection"])
    odds = el(event, "PlayerSelectionOdds")
    el(odds, "Odds", money2(rec["odds"]))
    el(odds, "BetTypeB", "1")                       # 1 = pre-game
    el(bet_data, "BetType", "1")                    # 1 = single
    el(bet_data, "BetIP", "0.0.0.0")                # demo captures no IP
    el(bet_data, "BetPlacedDate", iso_z(rec["placed_at"]))
    el(bet_data, "BetAmount", money2(rec["stake"]))
    el(bet_data, "Currency", CURRENCY)
    # settlement amounts (payout) belong to Online_Betting_Winnings, a
    # separate HGC data model this demo does not file
    el(betting, "LogInSessionID", uid("gr-login", rec["player_ref"], rec["placed_at"]))
    el(betting, "DomainName", DOMAIN)
    return root


def payment(rec):
    root, txn = _batch("Online_Customer_Account_Transaction")
    _record_id(txn, "gr-payment", rec["payment_id"])
    el(txn, "PlayerID", rec["player_ref"])
    data = el(txn, "TransactionData")
    el(data, "TransactionID", rec["payment_id"])
    el(data, "TransactionCategory", "PAYMENT")
    el(data, "TransactionDesc", f"{rec['direction']} via {rec['method'] or 'OTHER'}")
    el(data, "AdjustmentIndicator", "false")
    el(data, "TransactionType", "1" if rec["direction"] == "DEPOSIT" else "0")
    el(data, "TransactionAmount", money2(rec["amount"]))
    el(data, "TransactionDate", iso_z(rec["completed_at"]))
    el(data, "TransactionCurrency", CURRENCY)
    el(data, "AccountBalance", money2(rec["balance"]))
    return root


def player(rec):
    root, account = _batch("Online_Customer_Account")
    _record_id(account, "gr-player", rec["player_ref"], rec["kyc_status"])
    el(account, "PlayerID", rec["player_ref"])
    data = el(account, "CustomerAccount")
    el(data, "Username", rec["player_ref"][:32])
    el(data, "AccountType", "1")                   # 1 = Greek account
    # HGC status: 1 temporary (pre-KYC), 2 active
    el(data, "AccountStatus", "1" if rec["kyc_status"] == "PENDING" else "2")
    el(data, "AccountStatusDate", iso_z(rec["opened_at"]))
    # KYC identity block (Gender/Surname/FirstName/IDNumber/address/email)
    # omitted: the demo holds only a pseudonym
    if rec["kyc_status"] == "VERIFIED":
        el(data, "KYCDate", iso_z(rec["opened_at"]))
    el(data, "PlayerRisk", "1")                    # 1 = low risk
    el(data, "Currency", CURRENCY)
    return root


def gaming(rec):
    root, game = _batch("Online_Game")
    _record_id(game, "gr-gaming", rec["round_id"])
    el(game, "GameCategoryA", "2")                 # 2 = RNG-driven game
    el(game, "GameCategoryB", _CATEGORY_B.get(rec["game"], "0"))
    el(game, "PlayerID", rec["player_ref"])
    el(game, "ManufacturerLN", "BETNOVA")
    session_key = rec.get("session_id") or rec["round_id"]
    el(game, "LogInSessionID", uid("gr-login-session", session_key))
    el(game, "TaxationSessionID", uid("gr-tax-session", session_key,
                                      utc(rec["played_at"]).date()))
    data = el(game, "GameSessionData")
    el(data, "GameSessionID", rec["round_id"])
    el(data, "GameSessionStartDate", iso_z(rec["played_at"]))
    el(data, "GameSessionEndDate", iso_z(rec["played_at"]))
    stakes = el(data, "Stakes")
    el(stakes, "GameSessionAmountWagered", money2(rec["stake"]))
    winnings = el(data, "Winnings")
    el(winnings, "GameSessionAmountWon", money2(rec["payout"]))
    el(data, "Currency", CURRENCY)
    el(game, "IncompleteGameSessionIndicator", "1")   # 1 = complete session
    rng = el(game, "RNGGames")
    el(rng, "GameID", f"HGC-GAME-{rec['game']}")
    el(rng, "PaytableID", f"HGC-PT-{rec['game']}")
    el(rng, "RNGID", "HGC-RNG-BETNOVA-1")
    el(game, "DomainName", DOMAIN)
    return root
