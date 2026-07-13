# Shared lexical helpers for the regulator format modules. Each regulator
# stipulates its own date/amount conventions; the helpers here are only the
# mechanics (UTC coercion, element building, deterministic UUIDs).
import uuid
import xml.etree.ElementTree as ET
from datetime import timezone

# deterministic UUIDs: the same business key always yields the same UUID, so
# a re-run of the engine reproduces identical regulator identifiers
_NS = uuid.uuid5(uuid.NAMESPACE_URL, "urn:betnova:regulator-formats")


def uid(*key_parts):
    """Lowercase UUID derived from a business key (stable across runs)."""
    return str(uuid.uuid5(_NS, "|".join(str(p) for p in key_parts)))


def utc(dt):
    """Coerce a datetime to aware-UTC (DuckDB returns aware TIMESTAMPTZ,
    but be tolerant of naive values)."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def iso_z(dt):
    """UTC timestamp in the strict `YYYY-MM-DDThh:mm:ssZ` form (no offset,
    no fractional seconds) that NL/GR schemas pattern-enforce."""
    return utc(dt).strftime("%Y-%m-%dT%H:%M:%SZ")


def money2(value):
    """Two-decimal amount string."""
    return f"{float(value):.2f}"


def el(parent, name, value=None, **attrs):
    """Append a child element; set its text when a value is given."""
    child = ET.SubElement(parent, name, attrs)
    if value is not None:
        child.text = str(value)
    return child
