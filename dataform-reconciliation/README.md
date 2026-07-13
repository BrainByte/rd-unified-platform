# dataform-reconciliation — generated financial reconciliation reports

This folder is written by `dataform-website/reconciliation.py`: **one PDF per
jurisdiction per period** (daily and monthly), reconciling the operator OLTP
(the demo site's DuckDB) against the records reported to the regulator SAFE.

```
dataform-reconciliation/
  MT/BetNova-MT-daily-2026-07-12.pdf
  MT/BetNova-MT-monthly-2026-07.pdf
  ES/...
```

Each report carries five sections: the cash view (player transactions), the
settlement view (the GGR tax base), the bridge between them (open-bets
movement — any residual is flagged UNRECONCILED), three-way reported
completeness (OLTP ↔ SAFE receipts ↔ stored XML, breaks itemised), and the
GGR duty payable at each day's effective-dated rate.

The process, the two GGR bases and why they differ are documented in
[`../financial-reconciliations.md`](../financial-reconciliations.md).

Generate reports either from the demo site's back office (*Admin →
Financial reconciliation*: pick market, daily/monthly, day or month —
reports are listed there for download), or from the command line (site
stopped — the OLTP is opened read-only):

```bash
.venv/Scripts/python dataform-website/reconciliation.py                 # today + this month
.venv/Scripts/python dataform-website/reconciliation.py --date 2026-07-12
.venv/Scripts/python dataform-website/reconciliation.py --month 2026-07
```

The `*.pdf` files are demo output and are **gitignored**; this README pins
the folder. `reset_db.py` clears them along with the database and the SAFE.
