# dataform-safe — the fictitious regulator SAFE's record store

This folder is written by the demo SAFE web service
(`dataform-website/safe.py`). In real regulation each authority runs its own
record store (Denmark's Spillemyndigheden literally calls it the **SAFE**);
for the demo one SOAP service impersonates all eight, with an endpoint per
jurisdiction per record type:

```
POST http://127.0.0.1:5002/safe/<MKT>/<type>       SubmitRecord (SOAP 1.1)
GET  http://127.0.0.1:5002/safe/<MKT>/<type>?wsdl  minimal WSDL
GET  http://127.0.0.1:5002/                        status page
```

`<MKT>` = MT · ES · DK · BG · GR · NL · DE · FR — `<type>` = bets · payments ·
players · gaming · rud · rut (the DGOJ-style periodic registers — see
`requirements/dgoj-periodic-reporting/`).

Each accepted deposit is stored **as received — in the regulator's own
format** — pretty-printed, one XML file per deposit, with the SAFE's receipt
in a leading comment:

```
dataform-safe/
  MT/
    bets/000001-S1001.xml       <- receipt sequence + operator's RecordKey
  DK/
    bets/000001-S1002.xml       <- a Spillemyndigheden Standard Record (Danish
                                   element names, winnings incl. stake)
  ES/
    bets/000001-S1003.xml       <- a DGOJ <Lote> with xsi:type Registros
    rud/000001-RUD-2026-07-13.xml  one Lote per register filing
  GR/
    bets/000001-S1004.xml       <- an HGC <Batch> with BatchHeader
  NL/
    bets/000001-S1005.xml       <- a KSA CDB <Root>/WOK_Bet_v1.11 record
```

The translation from the demo's canonical submission rows into each of these
formats happens in `dataform-website/regulator_formats/` (see its
`__init__.py` for where that layer sits and why); markets with no sampled
regulator schema (MT, BG, DE) keep the neutral BetNova `<Record>` shape. The
sampled schemas themselves live under `docs/regulator/<mkt>/`, alongside a
`<mkt>-data-model.md` describing each one.

The records arrive **near-realtime** from the submission engine
(`dataform-website/submission.py`), which polls the demo site's DuckDB every
few seconds and SOAPs every newly-reportable record: players (re-reported on
KYC change), completed payments, settled/voided bets, and gaming rounds.
Periodic registers (rud/rut) are filed on demand from *Admin → Periodic
reports*, one regulator batch per filing. Both services start and stop with
the demo app (`python dataform-website/app.py`).

The `*.xml` files are demo output and are **gitignored**; this README pins the
folder. `reset_db.py` clears them along with the database.
