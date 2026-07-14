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
# operated store we would really be writing to.
#
# DEPLOYMENT: nothing in this package is website code. It imports only the
# Python standard library — no Flask, no DuckDB, no db.py — precisely so it
# lifts straight into the production submission service
# (dataform-starter/submission-service/, the Cloud Run engine that reads
# BigQuery `submission_ready_{mkt}` after each Dataform run and delegates
# to per-market adapters). The mapping at cutover:
#
#   demo (this repo, local)              production (BigQuery + Cloud Run)
#   submission.py SQL over DuckDB    ->  Dataform submission_ready_{mkt} views
#   submission.py engine loop        ->  submission-service/engine/engine.py
#   regulator_formats/{mkt}.py       ->  submission-service/adapters/{mkt}.py
#   safe.py + dataform-safe/         ->  the regulator's real SAFE/CDB/endpoint
#
# The canonical record dict is the contract at the seam: a BigQuery row
# from submission_ready_{mkt} carries the same fields the demo dicts do,
# so these modules serialise either source unchanged.
#
# These hand-written modules are the REFERENCE implementation, not the
# end state for seventeen markets: the target is one generic engine
# driven by per-regulator mapping specs (variance as data, like
# jurisdictions.js), validated against the vendored XSDs — see
# docs/regulator/translation-architecture.md for that design and the
# migration path from these modules to it.
#
# NL and ES are converted (migration steps 3 and 5): they serialise
# through engine.py + specs/nl_v1_11.py / specs/es_v3_3.py, and
# test_nl_spec.py / test_es_spec.py prove each spec byte-identical to its
# retained hand-written oracle (nl.py / es.py).
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
from . import dk, engine, es, generic, gr, nl  # noqa: F401  (es/nl = test oracles)
from .specs import es_v3_3, fr_v1, nl_v1_11, pt_v1

# (jurisdiction, record_type) -> formatter(canonical dict) -> xml.etree Element
FORMATTERS = {
    ("DK", "bets"):     dk.bet,
    ("DK", "players"):  dk.player,
    ("DK", "gaming"):   dk.gaming,
    # DK has no standard record for account movements -> payments fall back

    # ES runs on the mapping-driven engine; es.py remains as the byte-
    # identity oracle exercised by test_es_spec.py
    ("ES", "bets"):     engine.bind(es_v3_3.SPEC, "bets"),
    ("ES", "payments"): engine.bind(es_v3_3.SPEC, "payments"),
    ("ES", "players"):  engine.bind(es_v3_3.SPEC, "players"),
    ("ES", "gaming"):   engine.bind(es_v3_3.SPEC, "gaming"),
    ("ES", "rud"):      engine.bind(es_v3_3.SPEC, "rud"),
    ("ES", "rut"):      engine.bind(es_v3_3.SPEC, "rut"),

    ("GR", "bets"):     gr.bet,
    ("GR", "payments"): gr.payment,
    ("GR", "players"):  gr.player,
    ("GR", "gaming"):   gr.gaming,

    # NL runs on the mapping-driven engine; nl.py remains as the byte-
    # identity oracle exercised by test_nl_spec.py
    ("NL", "bets"):     engine.bind(nl_v1_11.SPEC, "bets"),
    ("NL", "payments"): engine.bind(nl_v1_11.SPEC, "payments"),
    ("NL", "players"):  engine.bind(nl_v1_11.SPEC, "players"),
    ("NL", "gaming"):   engine.bind(nl_v1_11.SPEC, "gaming"),
    # true per-game session grain (rounds ride inside these for NL)
    # REQ: requirements/session-tracking (REQ-ST-6)
    ("NL", "sessions"): engine.bind(nl_v1_11.SPEC, "sessions"),

    # FR is spec-only (no hand-written module ever existed): the ANJ
    # event-log traces, where one canonical record fans out to several
    # documents (a settled bet = MISE + GAIN). Golden files in
    # test_fr_spec.py are the oracle.
    # REQ: requirements/fr-new-jurisdiction (REQ-FR-4/5)
    ("FR", "bets"):     engine.bind(fr_v1.SPEC, "bets"),
    ("FR", "payments"): engine.bind(fr_v1.SPEC, "payments"),
    ("FR", "players"):  engine.bind(fr_v1.SPEC, "players"),
    ("FR", "gaming"):   engine.bind(fr_v1.SPEC, "gaming"),

    # PT is spec-only: SRIJ Safe category files whose validation oracle
    # is the gazette's own schemas (docs/regulator/pt/derived/), proven
    # by test_pt_spec.py. REQ: requirements/pt-new-jurisdiction (REQ-PT-4/5)
    ("PT", "bets"):     engine.bind(pt_v1.SPEC, "bets"),
    ("PT", "payments"): engine.bind(pt_v1.SPEC, "payments"),
    ("PT", "players"):  engine.bind(pt_v1.SPEC, "players"),
    ("PT", "gaming"):   engine.bind(pt_v1.SPEC, "gaming"),
    # platform sessions as SESS_ LOGIN/LOGOUT files
    # REQ: requirements/session-tracking (REQ-ST-6)
    ("PT", "sessions"): engine.bind(pt_v1.SPEC, "sessions"),
}


def format_record(jurisdiction, record_type, record):
    """Serialise one canonical record dict into the XML the regulator of
    `jurisdiction` stipulates for `record_type`. Falls back to the neutral
    BetNova <Record> format where no stipulated format applies."""
    formatter = FORMATTERS.get((jurisdiction, record_type))
    if formatter is None:
        return generic.record(record_type, record)
    return formatter(record)
