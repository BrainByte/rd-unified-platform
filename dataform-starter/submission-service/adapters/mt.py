"""Malta adapter — SOAP envelope quirks ONLY. No business logic.

Each adapter exposes:
  build_envelopes(rows, report_date) -> iterable of envelope payloads
  send(envelope) -> receipt_id (str)
"""

from datetime import date

import requests
from lxml import etree

ENDPOINT = "https://regulator.example.mt/soap/submissions"  # from Secret Manager in prod
BATCH_SIZE = 5000  # regulator max rows per envelope


def build_envelopes(rows, report_date: date):
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        env = etree.Element("Envelope")
        header = etree.SubElement(env, "Header")
        etree.SubElement(header, "ReportDate").text = report_date.isoformat()
        body = etree.SubElement(env, "Body")
        for r in batch:
            bet = etree.SubElement(body, "Bet")
            for field in ("bet_id", "player_id", "game_type", "stake", "payout", "ggr"):
                etree.SubElement(bet, field).text = str(r[field])
        yield etree.tostring(env, xml_declaration=True, encoding="UTF-8")


def send(envelope: bytes) -> str:
    resp = requests.post(
        ENDPOINT,
        data=envelope,
        headers={"Content-Type": "text/xml; charset=UTF-8"},
        timeout=60,
    )
    resp.raise_for_status()
    ack = etree.fromstring(resp.content)
    return ack.findtext(".//ReceiptId")
