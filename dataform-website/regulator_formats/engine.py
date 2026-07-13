# ============================================================================
# The mapping-driven serialisation engine — Option A of
# docs/regulator/translation-architecture.md, written ONCE.
#
# A regulator format is described by a SPEC that is pure data (see
# specs/nl_v1_11.py): an envelope, a shared record header, and per-record
# element trees whose leaves are field BINDINGS from the canonical record
# dict. The engine is a single tree-walker over that spec; adding a market
# or a field is a spec change, not an engine change — the same
# variance-as-data principle jurisdictions.js applies to the SQL side.
#
# Binding vocabulary (one dict per element):
#   {"const": v}                       literal value
#   {"config": name}                   operator constant from spec["config"]
#   {"from": field}                    canonical field, str()'d
#   {"uid": [part, "$field", ...]}     deterministic uuid5 over resolved parts
#   {"uid_from_key": True}             uuid5 over the record's resolved key
#   {"now": True}                      the serialisation clock (injectable)
#   {"children": {name: binding, …}}   nested element (dict order = XSD order)
# modifiers, composable with the above:
#   "as": codec                        lexical codec (see CODECS)
#   "truncate": n                      slice the raw value first
#   "map": {raw: out}, "default": d    enumeration mapping with fallback
#   "when": {"field": f, "equals": v}  emit only when the condition holds
#   "when": {"field": f, "present": True}
#
# Codecs are the lexical profile: the regulator's date/money/boolean
# conventions, named once per spec. NL needs four; other regimes add
# theirs here (digit-string dates, S/N booleans, Importe lines...) and
# every spec shares them.
# ============================================================================
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from ._util import iso_z, money2, uid

CODECS = {
    "datetime": iso_z,                                   # YYYY-MM-DDThh:mm:ssZ
    "date": lambda v: v.strftime("%Y-%m-%d"),
    "money": money2,                                     # 2 decimals
    "flag-positive": lambda v: "1" if float(v) > 0 else "0",
}


def _resolve_parts(parts, rec):
    """uid key parts: '$field' pulls the raw canonical value, else literal."""
    return [rec.get(p[1:]) if isinstance(p, str) and p.startswith("$") else p
            for p in parts]


def _condition_holds(cond, rec):
    value = rec.get(cond["field"])
    if "equals" in cond:
        return value == cond["equals"]
    if cond.get("present"):
        return value is not None
    raise ValueError(f"unknown condition: {cond}")


def _emit(parent, name, binding, ctx):
    if "when" in binding and not _condition_holds(binding["when"], ctx["rec"]):
        return
    element = ET.SubElement(parent, name)
    if "children" in binding:
        for child_name, child_binding in binding["children"].items():
            _emit(element, child_name, child_binding, ctx)
        return

    if "const" in binding:
        raw = binding["const"]
    elif "config" in binding:
        raw = ctx["config"][binding["config"]]
    elif "uid" in binding:
        raw = uid(*_resolve_parts(binding["uid"], ctx["rec"]))
    elif binding.get("uid_from_key"):
        raw = uid(*ctx["key"])
    elif binding.get("now"):
        raw = ctx["now"]
    elif "from" in binding:
        raw = ctx["rec"].get(binding["from"])
    else:
        raise ValueError(f"binding for <{name}> resolves no value: {binding}")

    if "truncate" in binding and raw is not None:
        raw = raw[:binding["truncate"]]
    if "map" in binding:
        raw = binding["map"].get(raw, binding.get("default", raw))
    if raw is None:
        parent.remove(element)          # nothing to say and not mandatory
        return
    codec = CODECS.get(binding.get("as"), str)
    element.text = str(codec(raw))


def serialise(spec, record_type, rec, now=None):
    """One canonical record dict -> the regulator document the spec
    describes. `now` is injectable so tests (and replays) are
    deterministic; production callers omit it."""
    record_spec = spec["records"][record_type]
    ctx = {
        "rec": rec,
        "config": spec["config"],
        "now": now or datetime.now(timezone.utc),
        "key": _resolve_parts(record_spec["key"], rec),
    }
    root = ET.Element(spec["envelope"]["root"])
    record = ET.SubElement(root, record_spec["element"])
    for name, binding in spec.get("record_header", {}).items():
        _emit(record, name, binding, ctx)
    for name, binding in record_spec["fields"].items():
        _emit(record, name, binding, ctx)
    return root


def bind(spec, record_type):
    """A formatter callable for the registry in __init__.py."""
    return lambda rec: serialise(spec, record_type, rec)
