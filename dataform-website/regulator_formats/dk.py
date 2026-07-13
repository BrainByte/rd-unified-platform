# ============================================================================
# DK — Spillemyndigheden "Standard Records" (docs/regulator/dk, v2).
#
# One XML file per report, namespace http://skat.dk/begrebsmodel/2009/01/15/,
# always: FilInformation (file version + id), Tilladelsesindehaver[OgSpil]
# (licence + game category), then the payload. Element names are the real
# Danish ones from the class layer (æ/ø/å included, exactly as the schemas
# declare them); amounts all flow through the signed 10-decimal money type,
# winnings are reported INCLUSIVE of the stake, timestamps are UTC, and
# cancellations ride on the original transaction id (SpilAnnullering 0/1).
#
# The casino report reproduces view/KasinospilPrSessionStrukturType.xsd
# faithfully; the sample set carries no fixed-odds view, so the bets report
# composes the documented class elements (Spil, Begivenhedsinformation) in
# the same house style. DK defines no standard record for account movements,
# so payments fall back to the generic format (see __init__.py).
#
# Demo defaults, stated once: the licence id and RNG certification ids are
# fixtures ("BETNOVA-DK-1", "RNG-BETNOVA-1"); amounts stay in the wallet's
# EUR (a real filing would declare DKK — SKAT accepts only DKK).
# ============================================================================
import xml.etree.ElementTree as ET

from ._util import el, iso_z, money2, uid

NS = "http://skat.dk/begrebsmodel/2009/01/15/"
LICENCE_ID = "BETNOVA-DK-1"          # SpilCertifikatIdentifikation (TamperToken user)
FILE_VERSION = "v2"
CURRENCY = "EUR"
WEBSITE = "https://betnova.example/dk"

# demo game -> KasinoSpilKategoriType enumeration value
_KASINO_KATEGORI = {"SLOTS": "spilleautomat", "BLACKJACK": "blackjack",
                    "POKER": "poker", "operator-jackpots": "andet"}


def _headers(parent, file_key, kategori):
    """FilInformation + licence header, as every view opens."""
    fil = el(parent, "FilInformation")
    el(fil, "SpilFilVersion", FILE_VERSION)
    el(fil, "SpilFilIdentifikation", uid(*file_key))
    name = "TilladelsesindehaverOgSpil" if kategori else "Tilladelsesindehaver"
    till = el(parent, name)
    el(till, "SpilCertifikatIdentifikation", LICENCE_ID)
    if kategori:
        el(till, "SpilKategoriNavn", kategori)


def bet(rec):
    """A settled/voided fixed-odds purchase as a Fastoddsspil record,
    composed from the class-layer elements (no fixed-odds view is present
    in the docs/regulator/dk sample)."""
    root = ET.Element("FastoddsspilStruktur", {"xmlns": NS})
    _headers(root, ("dk-bet", rec["slip_id"], rec["status"]), "Fastoddsspil")
    spil = el(root, "Fastoddsspil")
    el(spil, "SpillerInformationIdentifikation", rec["player_ref"])
    el(spil, "SpilTransaktionIdentifikation", rec["slip_id"])
    el(spil, "SpilKøbDatoTid", iso_z(rec["placed_at"]))
    if rec.get("terminal_at") is not None:
        el(spil, "SpilFaktiskSlutDatoTid", iso_z(rec["terminal_at"]))
    el(spil, "SpilSalgskanal", "Internet")
    el(el(spil, "SpilSted"), "SpilHjemmeside", WEBSITE)
    begivenhed = el(spil, "Begivenhedsinformation")
    el(begivenhed, "BegivenhedsIdentifikation", rec["fixture_id"])
    el(begivenhed, "Begivenhedsnavn", rec["event"])
    el(begivenhed, "Udfaldsnavn", rec["selection"])
    el(begivenhed, "Begivenhedsodds", money2(rec["odds"]))
    el(spil, "SpilIndskudSpil", money2(rec["stake"]))
    # DK convention: winnings include the returned stake; the demo payout
    # already is the full amount returned to the player.
    el(spil, "SpilGevinstSpil", money2(rec["payout"]))
    el(spil, "ValutaOplysningKode", CURRENCY)
    if rec["status"] == "VOIDED":
        annullering = el(spil, "SpilAnnullering")
        el(annullering, "SpilAnnullering", "1")
        el(annullering, "SpilAnnulleringDatoTid", iso_z(rec["terminal_at"]))
    return root


def gaming(rec):
    """One casino round, shaped exactly as the sample's
    view/KasinospilPrSessionStrukturType.xsd composes it (the demo reports
    per round, so a session carries exactly one træk/spin)."""
    root = ET.Element("KasinospilPrSessionStruktur", {"xmlns": NS})
    struktur = el(root, "KasinospilStruktur")
    _headers(struktur, ("dk-gaming", rec["round_id"]), "KasinospilSinglePlayer")
    session = el(el(struktur, "KasinospilAggregeretPrSession"), "KasinospilSession")
    el(session, "SpilProduktNavn", rec["game"])
    el(session, "SpilProduktÅbentNetværk", "0")
    el(session, "SpillerInformationIdentifikation", rec["player_ref"])
    el(session, "SpilTransaktionIdentifikation", rec["round_id"])
    el(session, "SpilKøbDatoTid", iso_z(rec["played_at"]))
    el(session, "SpilFaktiskSlutDatoTid", iso_z(rec["played_at"]))
    el(session, "SpilSalgskanal", "Internet")
    el(session, "KasinospilKategori", _KASINO_KATEGORI.get(rec["game"], "andet"))
    el(session, "KasinospilIndskudSpil", money2(rec["stake"]))
    el(session, "KasinospilGevinstSpil", money2(rec["payout"]))
    el(session, "KasinospilAntalTræk", "1")
    el(session, "ValutaOplysningKode", CURRENCY)
    el(el(session, "SpilSted"), "SpilHjemmeside", WEBSITE)
    generator = el(el(session, "TilfældighedGeneratorListe"), "TilfældighedGenerator")
    el(generator, "TilfældighedGeneratorIdentifikation", "RNG-BETNOVA-1")
    el(generator, "TilfældighedGeneratorSoftwareId", "1.0")
    el(session, "JackpotListe")           # required element, no jackpot feed
    return root


def player(rec):
    """DK player reporting is pseudonymous by design: the standard records
    carry only the operator-assigned id (never the CPR number), so KYC
    status has no DK element and stays in the operator's systems."""
    root = ET.Element("SpillerInformationStruktur", {"xmlns": NS})
    _headers(root, ("dk-player", rec["player_ref"], rec["kyc_status"]), None)
    spiller = el(root, "SpillerInformation")
    el(spiller, "SpillerInformationIdentifikation", rec["player_ref"])
    return root
