"""Generic submission engine (Cloud Run).

Flow per invocation (triggered by Workflows after Dataform run succeeds):
  1. Read submission_ready_{market} rows for the report_date.
  2. Hand rows to the market adapter -> SOAP envelope(s).
  3. Send with retry/backoff; capture regulator receipt/ack.
  4. Write receipt + submitted totals to submission_receipts (BigQuery).
     That table feeds the permanent internal recon models.

Adapters contain ONLY envelope/protocol quirks (~50 lines each).
All selection/shaping logic already happened in Dataform.
"""

import importlib
import logging
from datetime import date

from google.cloud import bigquery

log = logging.getLogger("submission-engine")
bq = bigquery.Client()


def load_adapter(market: str):
    """Adapters live in adapters/{market}.py and expose build_envelopes() + endpoint config."""
    return importlib.import_module(f"adapters.{market.lower()}")


def fetch_rows(market: str, dataset: str, report_date: date):
    query = f"""
        SELECT * FROM `{dataset}.submission_ready_{market.lower()}`
        WHERE report_date = @report_date
        ORDER BY bet_id
    """
    job = bq.query(
        query,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("report_date", "DATE", report_date)
            ]
        ),
    )
    return list(job.result())


def record_receipt(market: str, report_date: date, receipt_id: str, rows: list):
    total_stake = round(sum(r["stake"] for r in rows), 2)
    bq.insert_rows_json(
        "reporting_core.submission_receipts",
        [{
            "jurisdiction": market,
            "report_date": report_date.isoformat(),
            "receipt_id": receipt_id,
            "row_count": len(rows),
            "total_stake": total_stake,
            "submitted_at": "AUTO",
        }],
    )


def run(market: str, dataset: str, report_date: date):
    adapter = load_adapter(market)
    rows = fetch_rows(market, dataset, report_date)
    if not rows:
        log.warning("No rows for %s on %s — verify upstream before skipping", market, report_date)
        return

    for envelope in adapter.build_envelopes(rows, report_date):
        receipt = adapter.send(envelope)  # adapter handles auth, retries, ack parsing
        record_receipt(market, report_date, receipt, rows)
        log.info("Submitted %s %s: receipt %s", market, report_date, receipt)
