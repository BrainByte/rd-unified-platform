# ============================================================================
# BetNova demo — the REGULATOR FORMAT translation layer.
#
# WHERE TRANSLATION LIVES (the architectural point this package exists to
# make): translating canonical submission rows into each regulator's
# stipulated XML is its own layer, sitting between the submission views and
# the wire. Neither neighbour does any of it:
#
#   submission views      canonical rows   — WHAT is reportable (SQL, per
#   (submission.py SQL)                      market variance as data)
#   regulator_formats     regulator XML    — HOW each regulator wants it
#   (this package)                           said (schema, typing, envelope)
#   submission engine     transport        — WHEN/WHERE it is delivered
#   (submission.py loop)                     (poll, SOAP, receipts, log)
#   the SAFE (safe.py)    storage          — the regulator's own record
#                                            store; accepts and keeps what
#                                            arrives, translates nothing
#
# The submission engine therefore stays thin (it never touches an element
# name), and the SAFE stays a faithful stand-in for the external, regulator-
# operated store we would really be writing to. In the production pipeline
# this layer is the serialisation stage fed by the Dataform submission
# views: same canonical rows in, per-jurisdiction files out.
#
# Formats are keyed (jurisdiction, record_type). Jurisdictions whose schemas
# are sampled under docs/regulator/ get their stipulated format:
#
#   DK  Spillemyndigheden "Standard Records"   docs/regulator/dk  dk.py
#   ES  DGOJ Sistema de Monitorización 3.3     docs/regulator/es  es.py
#   GR  HGC online licensee data models        docs/regulator/gr  gr.py
#   NL  KSA Controle Databank (CDB) v1.11      docs/regulator/nl  nl.py
#
# Everything else (MT, BG, DE, and record types a regulator has no model
# for — e.g. DK has no account-movements standard record) falls back to the
# neutral BetNova <Record> shape in generic.py.
#
# Fidelity note: each module produces the regulator's real envelope, element
# names, order and lexical conventions (digit-string dates and S/N booleans
# for ES, Z-suffixed UTC and EUR-implicit amounts for NL, batch headers and
# integer code lists for GR, Danish element names for DK). Blocks the demo
# cannot source — full KYC identity, IPs, device ids — are omitted or
# defaulted, and each module says so where it does it.
# ============================================================================
from . import dk, es, generic, gr, nl

# (jurisdiction, record_type) -> formatter(canonical dict) -> xml.etree Element
FORMATTERS = {
    ("DK", "bets"):     dk.bet,
    ("DK", "players"):  dk.player,
    ("DK", "gaming"):   dk.gaming,
    # DK has no standard record for account movements -> payments fall back

    ("ES", "bets"):     es.bet,
    ("ES", "payments"): es.payment,
    ("ES", "players"):  es.player,
    ("ES", "gaming"):   es.gaming,
    ("ES", "rud"):      es.periodic_rud,
    ("ES", "rut"):      es.periodic_rut,

    ("GR", "bets"):     gr.bet,
    ("GR", "payments"): gr.payment,
    ("GR", "players"):  gr.player,
    ("GR", "gaming"):   gr.gaming,

    ("NL", "bets"):     nl.bet,
    ("NL", "payments"): nl.payment,
    ("NL", "players"):  nl.player,
    ("NL", "gaming"):   nl.gaming,
}


def format_record(jurisdiction, record_type, record):
    """Serialise one canonical record dict into the XML the regulator of
    `jurisdiction` stipulates for `record_type`. Falls back to the neutral
    BetNova <Record> format where no stipulated format applies."""
    formatter = FORMATTERS.get((jurisdiction, record_type))
    if formatter is None:
        return generic.record(record_type, record)
    return formatter(record)
