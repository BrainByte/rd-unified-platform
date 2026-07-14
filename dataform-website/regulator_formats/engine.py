# ============================================================================
# The mapping-driven serialisation engine — Option A of
# docs/regulator/translation-architecture.md, written ONCE.
#
# A regulator format is described by a SPEC that is pure data (see
# specs/nl_v1_11.py, specs/es_v3_3.py): an envelope, optional shared
# headers, and per-record element trees whose leaves are field BINDINGS
# from the canonical record dict. The engine is a single tree-walker over
# that spec; adding a market or a field is a spec change, not an engine
# change — the same variance-as-data principle jurisdictions.js applies
# to the SQL side.
#
# Binding vocabulary (one dict per element — or a LIST of variant dicts,
# where the first whose "when" holds is emitted):
#   {"const": v}                       literal value
#   {"config": name}                   operator constant from spec["config"]
#   {"from": field}                    canonical field, str()'d
#   {"format": "X-{field:.12}"}        str.format template over the record
#                                      (supports :.N truncation, %-datetime)
#   {"count": field}                   len() of a canonical list field
#   {"uid": [part, "$field", ...]}     deterministic uuid5 over resolved parts
#   {"crc": [part, "$field", ...]}     deterministic NUMERIC id (crc32) for
#                                      schemas typing ids as integers (FR IDEvt)
#   {"uid_from_key": True}             uuid5 over the record's resolved key
#   {"now": True}                      the serialisation clock (injectable)
#   {"children": {name: binding, …}}   nested element (dict order = XSD order;
#                                      {} emits an empty element)
# modifiers, composable with the above:
#   "attrs": {name: value}             literal XML attributes on the element
#   "as": codec                        lexical codec (see CODECS)
#   "truncate": n                      slice the raw value first
#   "map": {raw: out}, "default": d    enumeration mapping with fallback
#   "fallback_field": f, "fallback": v falsy raw -> another field / a literal
#   "when": {"field": f, "equals": v}  emit only when the condition holds
#   "when": {"field": f, "present": True}
#   "when": {"field": f, "positive": True}
#   "when": [cond, cond]               AND of conditions
#   "each": field                      repeat this element once per item of a
#                                      canonical list field; inner bindings
#                                      resolve against the item
#   {"defer": name}                    resolve the binding the current record
#                                      type declares under `name` (lets a
#                                      shared envelope carry per-record values,
#                                      e.g. the DGOJ LoteId)
#
# Codecs are the lexical profile: each regulator's date/money/boolean
# conventions, named once and shared by every spec (NL's ISO-Z datetimes
# next to ES's digit-string dates and 4-decimal odds).
#
# Document shape per record type:
#   {"element": name, "attrs"?, "key"?, "fields": {...}}          one record
#   {"registros": [ {element, attrs?, fields}, ... ], "lote_id"?} several
#   {"documents": [ {suffix, when?, element, fields}, ... ]}      one canonical
#       record fanning out to N separate regulator documents (event-log
#       regimes: FR's settled bet = [MISE, GAIN]); each document's suffix
#       distinguishes its deposit key
# wrapped in spec["envelope"] = {"root", "attrs"?, "header"?} where header
# is {"element": name, "fields": {...}} emitted before the record(s), and
# spec["record_header"] (if any) opens every record element. Envelope-less
# specs (FR: the trace event IS the document root) simply omit "envelope".
# ============================================================================
import hashlib
import re as _re
import xml.etree.ElementTree as ET
import zlib
from datetime import datetime, timezone

from ._util import iso_z, money2, uid, utc

CODECS = {
    "datetime": iso_z,                                   # YYYY-MM-DDThh:mm:ssZ
    "date": lambda v: v.strftime("%Y-%m-%d"),
    "date-compact": lambda v: v.strftime("%Y%m%d"),      # plain date, no tz (FR DateN)
    "money": money2,                                     # 2 decimals
    "money4": lambda v: f"{float(v):.4f}",               # odds, jackpot rates
    "flag-positive": lambda v: "1" if float(v) > 0 else "0",
    "digits14": lambda v: utc(v).strftime("%Y%m%d%H%M%S"),        # AAAAMMDDHHMMSS
    "digits14tz": lambda v: utc(v).strftime("%Y%m%d%H%M%S") + "+0000",
    "digits8": lambda v: utc(v).strftime("%Y%m%d"),               # AAAAMMDD
    "digits6": lambda v: utc(v).strftime("%Y%m"),                 # AAAAMM
    "digits12-yy": lambda v: utc(v).strftime("%y%m%d%H%M%S"),     # FR AAMMJJHHMMSS
    # PT "YYYYMMDDHH24MISS.FF TZH:TZM" (Oracle-style mask; UTC-normalised)
    "digits14-fftz": lambda v: utc(v).strftime("%Y%m%d%H%M%S") + ".00 +00:00",
    "sha1-upper": lambda v: hashlib.sha1(str(v).encode("utf-8")).hexdigest().upper(),
    # FR "canonique" names: uppercase, restricted to [0-9A-Z' -]
    "fr-canonique": lambda v: _re.sub(r"[^0-9A-Z' -]", "", str(v).upper()),
}


def _resolve_parts(parts, rec):
    """uid key parts: '$field' pulls the raw canonical value, else literal."""
    return [rec.get(p[1:]) if isinstance(p, str) and p.startswith("$") else p
            for p in parts]


def _condition_holds(cond, rec):
    if isinstance(cond, list):                           # AND of conditions
        return all(_condition_holds(c, rec) for c in cond)
    value = rec.get(cond["field"])
    if "equals" in cond:
        return value == cond["equals"]
    if cond.get("present"):
        return value is not None
    if cond.get("positive"):
        return value is not None and float(value) > 0
    raise ValueError(f"unknown condition: {cond}")


def _emit(parent, name, binding, ctx):
    if isinstance(binding, list):                        # variants: first match wins
        for variant in binding:
            if "when" not in variant or _condition_holds(variant["when"], ctx["rec"]):
                _emit(parent, name, {k: v for k, v in variant.items() if k != "when"}, ctx)
                return
        return
    if "when" in binding and not _condition_holds(binding["when"], ctx["rec"]):
        return
    if "defer" in binding:
        _emit(parent, name, ctx["record_spec"][binding["defer"]], ctx)
        return
    if "each" in binding:
        inner = {k: v for k, v in binding.items() if k != "each"}
        for item in ctx["rec"].get(binding["each"]) or []:
            _emit(parent, name, inner, {**ctx, "rec": item})
        return

    element = ET.SubElement(parent, name, binding.get("attrs", {}))
    if "children" in binding:
        for child_name, child_binding in binding["children"].items():
            _emit(element, child_name, child_binding, ctx)
        return

    if "const" in binding:
        raw = binding["const"]
    elif "config" in binding:
        raw = ctx["config"][binding["config"]]
    elif "format" in binding:
        raw = binding["format"].format(**ctx["rec"])
    elif "count" in binding:
        raw = len(ctx["rec"].get(binding["count"]) or [])
    elif "uid" in binding:
        raw = uid(*_resolve_parts(binding["uid"], ctx["rec"]))
    elif "crc" in binding:                               # deterministic NUMERIC id
        parts = _resolve_parts(binding["crc"], ctx["rec"])
        raw = zlib.crc32("|".join(str(p) for p in parts).encode("utf-8"))
        if "mod" in binding:                             # fit narrow integer types
            raw = raw % binding["mod"]
    elif binding.get("uid_from_key"):
        raw = uid(*ctx["key"])
    elif binding.get("now"):
        raw = ctx["now"]
    elif "from" in binding:
        raw = ctx["rec"].get(binding["from"])
    else:
        raise ValueError(f"binding for <{name}> resolves no value: {binding}")

    if not raw and raw != 0:                             # falsy -> declared fallbacks
        if "fallback_field" in binding:
            raw = ctx["rec"].get(binding["fallback_field"])
        if (not raw and raw != 0) and "fallback" in binding:
            raw = binding["fallback"]
    if "truncate" in binding and raw is not None:
        raw = raw[:binding["truncate"]]
    if "map" in binding:
        raw = binding["map"].get(raw, binding.get("default", raw))
    if raw is None:
        parent.remove(element)          # nothing to say and not mandatory
        return
    codec = CODECS.get(binding.get("as"), str)
    element.text = str(codec(raw))


def _build_document(spec, doc_spec, ctx):
    """One document: the spec's envelope wrapping the doc's element(s) —
    or, for envelope-less regimes (FR traces), the element itself as root."""
    envelope = spec.get("envelope")
    parent = None
    root = None
    if envelope:
        root = ET.Element(envelope["root"], envelope.get("attrs", {}))
        header = envelope.get("header")
        if header:
            header_el = ET.SubElement(root, header["element"])
            for name, binding in header["fields"].items():
                _emit(header_el, name, binding, ctx)
        parent = root
    for registro in doc_spec.get("registros") or [doc_spec]:
        if parent is None:
            element = root = ET.Element(registro["element"], registro.get("attrs", {}))
        else:
            element = ET.SubElement(parent, registro["element"], registro.get("attrs", {}))
        for name, binding in spec.get("record_header", {}).items():
            _emit(element, name, binding, ctx)
        for name, binding in registro["fields"].items():
            _emit(element, name, binding, ctx)
    return root


def serialise_documents(spec, record_type, rec, now=None):
    """One canonical record dict -> [(suffix, document root), ...].

    Most record types produce one document (suffix None). Event-log
    regimes declare `documents`: a list of conditional document specs,
    each with a `suffix` distinguishing its deposit key — FR's settled
    bet is [MISE, GAIN], its voided bet [MISE, ANNUL]."""
    record_spec = spec["records"][record_type]
    base = {
        "rec": rec,
        "config": spec["config"],
        "now": now or datetime.now(timezone.utc),
        "key": _resolve_parts(record_spec.get("key", []), rec),
        "record_spec": record_spec,
    }
    documents = record_spec.get("documents")
    if not documents:
        return [(None, _build_document(spec, record_spec, base))]
    out = []
    for doc in documents:
        if "when" in doc and not _condition_holds(doc["when"], rec):
            continue
        ctx = {**base,
               "key": _resolve_parts(doc.get("key", record_spec.get("key", [])), rec),
               "record_spec": {**record_spec, **doc}}
        out.append((doc["suffix"], _build_document(spec, doc, ctx)))
    return out


def serialise(spec, record_type, rec, now=None):
    """Single-document convenience used by the byte-identity suites."""
    documents = serialise_documents(spec, record_type, rec, now)
    if len(documents) != 1:
        raise ValueError(f"{record_type} produced {len(documents)} documents; "
                         "use serialise_documents")
    return documents[0][1]


def bind(spec, record_type):
    """A formatter callable for the registry in __init__.py: returns a
    single element for one-document types, or [(suffix, element), ...]
    for multi-document (event-log) types."""
    if spec["records"][record_type].get("documents"):
        return lambda rec: serialise_documents(spec, record_type, rec)
    return lambda rec: serialise(spec, record_type, rec)
