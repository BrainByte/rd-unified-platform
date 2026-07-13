# ============================================================================
# BetNova demo — the fictitious regulator SAFE (SOAP web service).
#
# In real regulation each authority runs its OWN record store (Denmark's
# Spillemyndigheden literally calls it the SAFE: operators must deposit a
# Standard Record per event). For this demo ONE service exposes a SOAP
# endpoint per jurisdiction PER RECORD TYPE:
#
#     POST http://127.0.0.1:5002/safe/<MKT>/<type>       SubmitRecord (SOAP 1.1)
#     GET  http://127.0.0.1:5002/safe/<MKT>/<type>?wsdl  minimal WSDL
#     GET  http://127.0.0.1:5002/                        status page (demo-friendly)
#
#     <MKT>  = MT | ES | DK | BG | GR | NL | DE
#     <type> = bets | payments | players | gaming | rud | rut
#
# The SAFE stands in for the EXTERNAL, regulator-operated store the operator
# writes to — so it translates NOTHING. What arrives inside SubmitRecord is
# already in the regulator's own format (a DK Standard Record, an ES DGOJ
# Lote, a GR HGC Batch, an NL KSA CDB Root — built by regulator_formats/),
# accompanied by a RecordKey: the name the operator files the deposit under.
# Accepted payloads are stored AS RECEIVED (pretty-printed, receipt as a
# leading comment), one XML file per deposit, in
#     dataform-safe/<MKT>/<type>/<seq>-<RecordKey>.xml
#
# Started automatically (daemon thread) by app.py; also runs standalone:
#     python safe.py
# ============================================================================
import os
import re
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import xml.etree.ElementTree as ET
from xml.dom import minidom

PORT = 5002
JURISDICTIONS = ["MT", "ES", "DK", "BG", "GR", "NL", "DE"]
# 'gaming' (casino rounds) added with financial reconciliation: GGR for tax
# spans sports AND gaming, so the reported record set must cover both.
# 'rud'/'rut' are the DGOJ-style periodic registers (daily detailed /
# monthly totalized); only markets configured for them submit any.
# REQ: requirements/dgoj-periodic-reporting (REQ-DGOJ-5)
RECORD_TYPES = ["bets", "payments", "players", "gaming", "rud", "rut"]
SAFE_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "dataform-safe")
SOAP_ENV = "http://schemas.xmlsoap.org/soap/envelope/"

_receipt_lock = threading.Lock()


def _type_dir(mkt, rtype):
    path = os.path.join(SAFE_ROOT, mkt, rtype)
    os.makedirs(path, exist_ok=True)
    return path


def _record_count(mkt, rtype):
    return len([f for f in os.listdir(_type_dir(mkt, rtype)) if f.endswith(".xml")])


def _local(tag):
    """Element local name, ignoring any namespace."""
    return tag.rsplit("}", 1)[-1]


def _find_local(root, name):
    for el in root.iter():
        if _local(el.tag) == name:
            return el
    return None


# deposits are stored under <seq>-<RecordKey>.xml; keep keys filesystem-safe
_KEY_RE = re.compile(r"^[A-Za-z0-9._-]{1,120}$")


def _pretty(element, comment=None):
    """Pretty-print the payload exactly as received; the SAFE's own receipt
    metadata rides in a leading XML comment so the stored document stays in
    the regulator's schema."""
    raw = ET.tostring(element, encoding="unicode")
    pretty = minidom.parseString(raw).toprettyxml(indent="  ")
    if comment:
        first_newline = pretty.index("\n") + 1     # after the <?xml ...?> line
        pretty = pretty[:first_newline] + f"<!--{comment}-->\n" + pretty[first_newline:]
    return pretty


def _soap(body_xml):
    return (f'<?xml version="1.0" encoding="utf-8"?>'
            f'<soap:Envelope xmlns:soap="{SOAP_ENV}"><soap:Body>{body_xml}'
            f'</soap:Body></soap:Envelope>')


def _fault(code, message):
    return _soap(f"<soap:Fault><faultcode>soap:{code}</faultcode>"
                 f"<faultstring>{message}</faultstring></soap:Fault>")


WSDL_TEMPLATE = """<?xml version="1.0" encoding="utf-8"?>
<definitions name="BetNovaSafe{mkt}{Type}" targetNamespace="urn:betnova:safe:{mkt}:{rtype}"
    xmlns="http://schemas.xmlsoap.org/wsdl/"
    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
    xmlns:tns="urn:betnova:safe:{mkt}:{rtype}">
  <message name="SubmitRecordRequest"><part name="Record" type="xsd:anyType"/></message>
  <message name="SubmitRecordResponse"><part name="ReceiptId" type="xsd:string"/></message>
  <portType name="SafePort">
    <operation name="SubmitRecord">
      <input message="tns:SubmitRecordRequest"/>
      <output message="tns:SubmitRecordResponse"/>
    </operation>
  </portType>
  <binding name="SafeBinding" type="tns:SafePort">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="SubmitRecord"><soap:operation soapAction="urn:betnova:safe#SubmitRecord"/></operation>
  </binding>
  <service name="BetNovaSafe">
    <port name="SafePort" binding="tns:SafeBinding">
      <soap:address location="http://127.0.0.1:{port}/safe/{mkt}/{rtype}"/>
    </port>
  </service>
</definitions>
"""


class SafeHandler(BaseHTTPRequestHandler):
    server_version = "BetNovaSAFE/1.0"

    def log_message(self, fmt, *args):     # keep the demo console readable
        pass

    # ---- helpers ----
    def _send(self, status, body, content_type="text/xml; charset=utf-8"):
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _endpoint(self):
        m = re.match(r"^/safe/([A-Z]{2})/([a-z]+)(\?.*)?$", self.path)
        return (m.group(1), m.group(2)) if m else (None, None)

    # ---- GET: status page, per-endpoint listing, ?wsdl ----
    def do_GET(self):
        mkt, rtype = self._endpoint()
        if mkt in JURISDICTIONS and rtype in RECORD_TYPES:
            if self.path.endswith("?wsdl"):
                return self._send(200, WSDL_TEMPLATE.format(
                    mkt=mkt, rtype=rtype, Type=rtype.capitalize(), port=PORT))
            files = sorted(f for f in os.listdir(_type_dir(mkt, rtype)) if f.endswith(".xml"))
            items = "".join(f"<li><code>{f}</code></li>" for f in files) or "<li><i>none yet</i></li>"
            return self._send(200, f"<html><body style='font-family:sans-serif'>"
                                   f"<h2>SAFE — {mkt} / {rtype} ({len(files)} records)</h2>"
                                   f"<ul>{items}</ul><a href='/'>back</a></body></html>",
                              "text/html; charset=utf-8")
        if self.path in ("/", "/safe"):
            head = "".join(f"<th>{t}</th>" for t in RECORD_TYPES)
            rows = "".join(
                "<tr><td><b>{m}</b></td>{cells}</tr>".format(
                    m=m, cells="".join(
                        f"<td><a href='/safe/{m}/{t}'>{_record_count(m, t)}</a> "
                        f"<small>(<a href='/safe/{m}/{t}?wsdl'>wsdl</a>)</small></td>"
                        for t in RECORD_TYPES))
                for m in JURISDICTIONS)
            return self._send(200, "<html><body style='font-family:sans-serif'>"
                                   "<h2>BetNova demo SAFE — fictitious regulator record store</h2>"
                                   "<p>One SOAP endpoint per jurisdiction per record type; accepted "
                                   "deposits are stored AS RECEIVED — in the regulator's own format "
                                   "(DK Standard Records, ES DGOJ Lotes, GR HGC Batches, NL KSA CDB "
                                   "records), pretty-printed under "
                                   "<code>dataform-safe/&lt;MKT&gt;/&lt;type&gt;/</code>.</p>"
                                   f"<table border='1' cellpadding='6'>"
                                   f"<tr><th>Jurisdiction</th>{head}</tr>{rows}</table>"
                                   "</body></html>",
                              "text/html; charset=utf-8")
        return self._send(404, _fault("Client", "Unknown endpoint — GET /safe/<jurisdiction>/<type>"))

    # ---- POST: the SOAP SubmitRecord operation ----
    def do_POST(self):
        mkt, rtype = self._endpoint()
        if mkt is None:
            return self._send(404, _fault("Client", "Unknown endpoint — POST /safe/<jurisdiction>/<type>"))
        if mkt not in JURISDICTIONS:
            return self._send(500, _fault("Client", f"Jurisdiction '{mkt}' is not implemented by this SAFE"))
        if rtype not in RECORD_TYPES:
            return self._send(500, _fault("Client", f"Record type '{rtype}' is not implemented "
                                                    f"(expected one of: {', '.join(RECORD_TYPES)})"))
        try:
            length = int(self.headers.get("Content-Length", 0))
            envelope = ET.fromstring(self.rfile.read(length).decode("utf-8"))
        except Exception as exc:
            return self._send(500, _fault("Client", f"Malformed SOAP envelope: {exc}"))

        submit = _find_local(envelope, "SubmitRecord")
        if submit is None:
            return self._send(500, _fault("Client", "Body must carry a SubmitRecord operation"))
        # the operation carries the operator's RecordKey (the name the
        # deposit is filed under) and ONE payload element in whatever format
        # the depositing operator's regulator stipulates — the SAFE does not
        # interpret it, it stores it as received.
        record_key, payload = None, None
        for child in submit:
            if _local(child.tag) == "RecordKey":
                record_key = (child.text or "").strip()
            else:
                payload = child
        if payload is None:
            return self._send(500, _fault("Client", "SubmitRecord requires a payload element"))
        record_key = record_key or payload.get("id")
        if not record_key:
            return self._send(500, _fault("Client", "SubmitRecord requires a <RecordKey> "
                                                    "(or a payload with an id attribute)"))
        if not _KEY_RE.match(record_key):
            return self._send(500, _fault("Client", f"RecordKey '{record_key}' is not a valid file key"))

        with _receipt_lock:
            # store the payload under its own default namespace (not an ns0:
            # prefix), so the file reads like the regulator's own examples
            if payload.tag.startswith("{"):
                ET.register_namespace("", payload.tag[1:].split("}", 1)[0])
            seq = _record_count(mkt, rtype) + 1
            receipt = f"{mkt}-{rtype.upper()}-{seq:06d}"
            received = datetime.now(timezone.utc).isoformat()
            fname = f"{seq:06d}-{record_key}.xml"
            with open(os.path.join(_type_dir(mkt, rtype), fname), "w", encoding="utf-8") as fh:
                fh.write(_pretty(payload, comment=f" SAFE receipt {receipt} — received {received} "))

        print(f"[SAFE] {mkt}/{rtype} accepted deposit {record_key} "
              f"({_local(payload.tag)}) -> {receipt}")
        return self._send(200, _soap(f"<SubmitRecordResponse>"
                                     f"<ReceiptId>{receipt}</ReceiptId>"
                                     f"<Status>ACCEPTED</Status></SubmitRecordResponse>"))


def serve(port=PORT):
    for mkt in JURISDICTIONS:      # folders exist even before the first record
        for rtype in RECORD_TYPES:
            _type_dir(mkt, rtype)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), SafeHandler)
    print(f"[SAFE] listening on http://127.0.0.1:{port}/ "
          f"({len(JURISDICTIONS)} jurisdictions x {len(RECORD_TYPES)} record types)")
    httpd.serve_forever()


if __name__ == "__main__":
    serve()
