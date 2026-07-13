# dataform-safe — the fictitious regulator SAFE's record store

This folder is written by the demo SAFE web service
(`dataform-website/safe.py`). In real regulation each authority runs its own
record store (Denmark's Spillemyndigheden literally calls it the **SAFE**);
for the demo one SOAP service impersonates all seven, with an endpoint per
jurisdiction per record type:

```
POST http://127.0.0.1:5002/safe/<MKT>/<type>       SubmitRecord (SOAP 1.1)
GET  http://127.0.0.1:5002/safe/<MKT>/<type>?wsdl  minimal WSDL
GET  http://127.0.0.1:5002/                        status page
```

`<MKT>` = MT · ES · DK · BG · GR · NL — `<type>` = bets · payments · players.

Each accepted record is stored pretty-printed, one XML file per record:

```
dataform-safe/
  MT/
    bets/000001-S1001.xml       <- receipt sequence + record id
    payments/000001-P1001.xml
    players/000001-W1002.xml
  ES/ ...
```

The records arrive **near-realtime** from the submission engine
(`dataform-website/submission.py`), which polls the demo site's DuckDB every
few seconds and SOAPs every newly-reportable record: players (re-reported on
KYC change), completed payments, and settled/voided bets. Both services start
and stop with the demo app (`python dataform-website/app.py`).

The `*.xml` files are demo output and are **gitignored**; this README pins the
folder. `reset_db.py` clears them along with the database.
