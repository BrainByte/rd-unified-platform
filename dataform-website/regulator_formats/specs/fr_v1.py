# ============================================================================
# FR — ARJEL/ANJ trace events as a MAPPING SPEC (pure data).
#
# France is an EVENT-LOG regime (docs/regulator/fr/fr-data-model.md): one
# small French-language XML per player action, deposited into the sealed
# coffre-fort the demo SAFE stands in for. There is no batch envelope —
# the trace event IS the document — and one canonical record fans out to
# several traces via the engine's `documents` capability:
#
#   bets     -> PASPMISE always, + PASPGAIN (winning settlement) or
#               PASPANNUL (void, stake refunded)
#   payments -> CPTEALIM (deposit) | CPTERETRAIT (withdrawal)
#   players  -> OUVINFOPERSO (account opening, while KYC pending) |
#               CPTEIDENTITE (identity verified)
#   gaming   -> POACHAT (poker stake) + POGAIN (poker winnings, if any);
#               only POKER rounds reach FR — casino games are unlicensed
#               in France and the submission layer suppresses them
#
# Shapes and element order follow the regulator's own example XMLs in
# docs/regulator/fr/xml/ (which seed the golden files in test_fr_spec.py)
# and the schemas in docs/regulator/fr/referentiel/xsd/. FR lexical
# conventions: 12-digit two-digit-year timestamps without timezone
# (digits12-yy), implicit-EUR plain decimals, SHA-1 uppercase player
# hash, numeric per-vault event ids (IDEvt — derived deterministically
# via crc32 here; a real frontal keeps a hard counter), and every money
# event carrying a before/movement/after balance triplet computed from
# the wallet ledger by the submission layer.
#
# Demo defaults, declared once: operator id 9001 and vault id 1 are
# fixtures; the website captures no client IP (0.0.0.0); OUVINFOPERSO
# identity beyond login/pseudonym/DOB is omitted (the demo captures no
# name/address at registration).
#
# IDSession attribution — REQ: requirements/fr-new-jurisdiction (REQ-FR-9):
# a trace for a PLAYER-instigated action (MISE, ALIM/RETRAIT, OUV, PO
# play) carries the player's current session id, exactly as the
# regulator's own examples do (PASPMISE7.xml: <IDSession>638604</IDSession>);
# a trace for an OPERATOR/system action (GAIN, ANNUL, IDENT) carries the
# "0-sys" sentinel the samples pair with the Supervision flag.
# ============================================================================

_IP = {"const": "0.0.0.0"}


def _HEADER(date_field, event_key, session=None, po_order=False):
    """The common trace header. The PASP/CJ families order it
    IDOper..IDCoffre; the newer PO family puts IDCoffre second and swaps
    IP/session — both orders exactly as the regulator's examples.
    IDSession defaults to the player's session (player-instigated
    events, falling back to 0-sys for unstamped legacy rows); operator
    events pass session={"const": "0-sys"}. (REQ-FR-9)"""
    fields = {
        "IDOper": {"config": "operator_id"},
        "DateEvt": {"from": date_field, "as": "digits12-yy"},
        "IDEvt": {"crc": event_key},
        "IDJoueur": {"from": "player_ref"},
        "HashJoueur": {"from": "player_ref", "as": "sha1-upper"},
        "IDSession": session or {"from": "session_id", "fallback": "0-sys"},
        "IPJoueur": _IP,
        "IDCoffre": {"config": "coffre_id"},
    }
    if po_order:
        order = ["IDOper", "IDCoffre", "DateEvt", "IDEvt", "IDJoueur",
                 "HashJoueur", "IPJoueur", "IDSession"]
        return {k: fields[k] for k in order}
    return fields


SPEC = {
    "market": "FR",
    "schema_version": "referentiel-2025",

    "config": {
        "operator_id": "9001",   # ANJ-assigned 4-digit operator id (fixture)
        "coffre_id": "1",        # vault id within the frontal
    },

    # no envelope: an FR trace event is its own document root

    "records": {

        # a bet's lifecycle: MISE at placement, then GAIN (winnings paid,
        # incl. stake return) or ANNUL (void, stake refunded). A settled
        # losing bet is MISE only — no gain event exists for it.
        "bets": {
            "documents": [
                {"suffix": "MISE", "element": "PASPMISE", "fields": {
                    # placement is the player's action: IDSession is the
                    # session the bet was placed in (REQ-FR-9)
                    **_HEADER("placed_at", ["fr-bet-mise", "$slip_id", "$status"]),
                    "Tech": {"from": "slip_id"},
                    "PaSp": {"children": {
                        "Combi": {"const": "S"},          # simple (single) bet
                        "LigSp": {"children": {
                            # canonique type: uppercase [0-9A-Z' -] only
                            "Renc": {"from": "event", "as": "fr-canonique"},
                            "Tech": {"from": "fixture_id"},
                            "Sport": {"from": "sport",
                                      "map": {"Football": "FOOT", "Tennis": "TENN",
                                              "Basketball": "BASK"},
                                      "default": "AUTR"},
                            "Evnt": {"from": "fixture_id"},
                            "Genre": {"const": "H"},
                            "Date": {"from": "placed_at", "as": "digits12-yy"},
                            "Part": {"each": "participants", "from": "name",
                                     "as": "fr-canonique"},
                            "PronoSp": {"children": {
                                "TypeRes": {"const": "RES1X2"},   # codeTypRes: >= 5 chars
                                "Choix": {"from": "selection"},
                            }},
                            "Cote": {"from": "odds", "as": "money"},
                        }},
                        "MiseBase": {"from": "stake", "as": "money"},
                    }},
                    "SoldeAvantMise": {"from": "balance_before_stake", "as": "money"},
                    "Mise": {"from": "stake", "as": "money"},
                    "SoldeApresMise": {"from": "balance_after_stake", "as": "money"},
                }},
                {"suffix": "GAIN", "element": "PASPGAIN",
                 "when": {"field": "payout", "positive": True}, "fields": {
                    # settlement is the operator's action: 0-sys, paired
                    # with the Supervision flag below (REQ-FR-9)
                    **_HEADER("terminal_at", ["fr-bet-gain", "$slip_id"],
                              session={"const": "0-sys"}),
                    "Supervision": {"children": {}},
                    "Tech": {"from": "slip_id"},
                    "DateMise": {"from": "placed_at", "as": "digits12-yy"},
                    "DateHeure": {"from": "terminal_at", "as": "digits12-yy"},
                    "SoldeAvantGain": {"from": "balance_before_credit", "as": "money"},
                    "Gain": {"from": "payout", "as": "money"},
                    "SoldeApresGain": {"from": "balance_after_credit", "as": "money"},
                }},
                {"suffix": "ANNUL", "element": "PASPANNUL",
                 "when": {"field": "status", "equals": "VOIDED"}, "fields": {
                    # a void is the operator's action: 0-sys, paired with
                    # the Supervision flag below (REQ-FR-9)
                    **_HEADER("terminal_at", ["fr-bet-annul", "$slip_id"],
                              session={"const": "0-sys"}),
                    "Supervision": {"children": {}},
                    "Tech": {"from": "slip_id"},
                    "DateMise": {"from": "placed_at", "as": "digits12-yy"},
                    # Motif is a closed enumeration; free-text demo reasons
                    # degrade to the regulator's Autre bucket
                    "Motif": {"from": "void_reason",
                              "map": {v: v for v in ("NonConforme", "MSE",
                                                     "RencontreAnnulee", "Resultat",
                                                     "Joueur", "PariModifie")},
                              "default": "Autre"},
                    "SoldeAvantRembours": {"from": "balance_before_credit", "as": "money"},
                    "MontantRembours": {"from": "stake", "as": "money"},
                    "SoldeApresRembours": {"from": "balance_after_credit", "as": "money"},
                }},
            ],
        },

        # one completed wallet movement: deposit or withdrawal
        "payments": {
            "documents": [
                {"suffix": "ALIM", "element": "CPTEALIM",
                 "when": {"field": "direction", "equals": "DEPOSIT"}, "fields": {
                    # a deposit is the player's action: IDSession is the
                    # session it was made in (REQ-FR-9)
                    **_HEADER("completed_at", ["fr-alim", "$payment_id"]),
                    "IDRef": {"from": "payment_id"},
                    "DateDemande": {"from": "completed_at", "as": "digits12-yy"},
                    "DateEffective": {"from": "completed_at", "as": "digits12-yy"},
                    "SoldeAvant": {"from": "balance_before", "as": "money"},
                    "SoldeMouvement": {"from": "amount", "as": "money"},
                    "SoldeApres": {"from": "balance", "as": "money"},
                    "MoyenPaiement": {"from": "method", "fallback": "AUTRE"},
                    "TypeMoyenPaiement": {"from": "method",
                                          "map": {"CARD": "CarteBancaire",
                                                  "BANK": "VirementBancaire"},
                                          "default": "Autre"},
                }},
                {"suffix": "RETRAIT", "element": "CPTERETRAIT",
                 "when": {"field": "direction", "equals": "WITHDRAWAL"}, "fields": {
                    # a withdrawal request is the player's action: IDSession
                    # is the session it was requested in (REQ-FR-9)
                    **_HEADER("completed_at", ["fr-retrait", "$payment_id"]),
                    "IDRef": {"from": "payment_id"},
                    "DateDemande": {"from": "completed_at", "as": "digits12-yy"},
                    "SoldeDemande": {"from": "amount", "as": "money"},
                    "SoldeAvant": {"from": "balance_before", "as": "money"},
                    "SoldeMouvement": {"from": "amount", "as": "money"},
                    "SoldeApres": {"from": "balance", "as": "money"},
                }},
            ],
        },

        # account lifecycle: opening trace while KYC is pending, identity-
        # verification trace when the account is verified. Name/address
        # blocks the demo does not capture at registration are omitted.
        "players": {
            "documents": [
                {"suffix": "OUV", "element": "OUVINFOPERSO",
                 "when": {"field": "kyc_status", "equals": "PENDING"}, "fields": {
                    # the player registers inside the session minted for it:
                    # IDSession is that session (REQ-FR-9)
                    **_HEADER("opened_at", ["fr-ouv", "$player_ref"]),
                    "Login": {"from": "username", "fallback_field": "player_ref"},
                    "Pseudo": {"from": "username", "fallback_field": "player_ref"},
                    # the schema requires the full identity block; the demo
                    # captures none of it at registration, so the mandatory
                    # fields carry DECLARED placeholders (fictitious demo)
                    "Nom": {"from": "username", "fallback_field": "player_ref",
                            "as": "fr-canonique"},
                    "Prenom": {"const": "NonRenseigne"},
                    "Civilite": {"const": "M"},
                    "DateN": {"from": "date_of_birth", "as": "date-compact",
                              "when": {"field": "date_of_birth", "present": True}},
                    "VilleN": {"const": "NonRenseigne"},
                    "DptN": {"const": "00"},
                    "PaysN": {"const": "France"},
                    "Email": {"format": "{username}@betnova.example"},
                }},
                {"suffix": "IDENT", "element": "CPTEIDENTITE",
                 "when": {"field": "kyc_status", "equals": "VERIFIED"}, "fields": {
                    # identity verification is the operator's action: 0-sys,
                    # never the player's session (REQ-FR-9)
                    **_HEADER("opened_at", ["fr-ident", "$player_ref"],
                              session={"const": "0-sys"}),
                    "NatureVerification": {"const": "PieceIdentite"},
                }},
            ],
        },

        # a poker round: the stake as a purchase trace, winnings (if any)
        # as a gain trace — the PO family's newer header order
        "gaming": {
            "documents": [
                {"suffix": "ACHAT", "element": "POACHAT", "fields": {
                    **_HEADER("played_at", ["fr-po-achat", "$round_id"], po_order=True),
                    "Inscription": {"from": "session_id", "fallback_field": "round_id"},
                    "Tech": {"from": "round_id"},
                    "Description": {"format": "Mise {game}"},
                    "SoldeAvant": {"from": "balance_before_stake", "as": "money"},
                    "SoldeMouvement": {"from": "stake", "as": "money"},
                    "SoldeApres": {"from": "balance_after_stake", "as": "money"},
                }},
                {"suffix": "GAIN", "element": "POGAIN",
                 "when": {"field": "payout", "positive": True}, "fields": {
                    **_HEADER("played_at", ["fr-po-gain", "$round_id"], po_order=True),
                    "Inscription": {"from": "session_id", "fallback_field": "round_id"},
                    "Tech": {"from": "round_id"},
                    "Description": {"format": "Gain {game}"},
                    "SoldeAvant": {"from": "balance_before_credit", "as": "money"},
                    "SoldeMouvement": {"from": "payout", "as": "money"},
                    "SoldeApres": {"from": "balance_after_credit", "as": "money"},
                }},
            ],
        },
    },
}
