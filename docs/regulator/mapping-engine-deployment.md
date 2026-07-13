# The Mapping Engine: Method in Detail, and Deployment with Cloud Workflows

This document is the practitioner's companion to
[translation-architecture.md](translation-architecture.md). That document
argues *why* regulator translation lives outside BigQuery and *why* it must
be config-driven; this one explains **how the mapping method actually
works** — as implemented and proven in this repo for NL and ES — and gives
**concrete steps to deploy it on GCP orchestrated by Cloud Workflows**.

Implementation referenced throughout:

| Artifact | Role |
|---|---|
| `dataform-website/regulator_formats/engine.py` | the generic serialiser (one tree-walker, written once) |
| `dataform-website/regulator_formats/specs/nl_v1_11.py` | KSA CDB v1.11 as a mapping spec |
| `dataform-website/regulator_formats/specs/es_v3_3.py` | DGOJ Monitorización 3.3 as a mapping spec |
| `dataform-website/test_nl_spec.py`, `test_es_spec.py` | byte-identity proofs against the retained hand-written oracles |
| `dataform-starter/submission-service/` | the Cloud Run slot this lifts into |

---

## Part 1 — The mapping method

### 1.1 The three-part contract

Every serialisation involves exactly three things, each owned by a
different layer:

1. **A canonical record dict** — produced by the submission layer (the
   demo's SQL today, a `submission_ready_{mkt}` BigQuery row in
   production). Neutral field names (`stake`, `player_ref`, `placed_at`),
   no regulator vocabulary. All *business* decisions (what to report, void
   suppression, pseudonymisation) already happened upstream.
2. **A mapping spec** — pure data, one per regulator per schema version,
   declaring how canonical fields become the regulator's document.
3. **The engine** — one generic function,
   `engine.serialise(spec, record_type, record) -> XML element`. It knows
   *no* regulator; everything jurisdictional it does, it was told by the
   spec.

The registry in `regulator_formats/__init__.py` binds
`(jurisdiction, record_type)` to `engine.bind(SPEC, record_type)`, so
callers are unaware whether a market is spec-driven or (temporarily)
hand-written.

### 1.2 Anatomy of a spec

A spec is a nested dict with four top-level parts:

```python
SPEC = {
  "market": "NL", "schema_version": "1.11",
  "config":   {...},        # operator constants (licence ids, safe ids)
  "envelope": {...},        # the document wrapper
  "record_header": {...},   # optional: fields opening EVERY record
  "records":  {...},        # one entry per canonical record type
}
```

**The envelope** declares the root element, its literal attributes
(namespaces), and an optional header element emitted before the records:

```python
"envelope": {
  "root": "Lote",
  "attrs": {"xmlns": "http://cnjuego.gob.es/sci/v3.3.xsd",
            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"},
  "header": {"element": "Cabecera", "fields": {
      "OperadorId": {"config": "operador_id"},
      "AlmacenId":  {"config": "almacen_id"},
      "LoteId":     {"defer": "lote_id"},   # ← per-record-type value, see below
      "Version":    {"const": "3.3"},
  }},
}
```

**A record type** is either a single element with fields (NL), or a list
of `registros` when one filing carries several regulator records (the ES
periodic Lote holds a `RegistroRUD` *and* a `RegistroCJD`):

```python
"records": {
  "rud": {
    "lote_id": {"format": "LOTE-RUD-{period_start:%Y%m%d}"},
    "registros": [
      {"element": "Registro", "attrs": {"xsi:type": "RegistroRUD"},  "fields": {...}},
      {"element": "Registro", "attrs": {"xsi:type": "RegistroCJD"}, "fields": {...}},
    ],
  },
}
```

### 1.3 The binding vocabulary

Every leaf element is a **binding** — a small dict saying where its value
comes from. The whole vocabulary (engine.py's docstring is normative):

| Binding | Meaning | Real use |
|---|---|---|
| `{"const": v}` | literal | `Bet_Type: SINGLE`, `EnDirecto: N` |
| `{"config": name}` | operator constant | `Operator_ID`, `OperadorId` |
| `{"from": field}` | canonical field | `Part_Stake` from `stake` |
| `{"format": "T-{f:.12}"}` | `str.format` template (supports `:.N` truncation and `%`-datetime specs) | `LoteId: LOTE-ADC-{slip_id}`, `RUD-{player_ref:.32}` |
| `{"count": field}` | `len()` of a list field | `NumeroJugadores` |
| `{"uid": ["k", "$field"]}` | deterministic uuid5 over resolved parts | `Bet_ID`, `Transaction_ID` |
| `{"uid_from_key": True}` | uuid5 of the record's declared `key` | NL `Record_ID` |
| `{"now": True}` | the injectable serialisation clock | `Extraction_Date` |
| `{"children": {...}}` | nested element; `{}` = deliberately empty | `Bet_Parts`, empty `Importe` = zero |

Modifiers compose with any of the above:

| Modifier | Meaning | Real use |
|---|---|---|
| `"as": codec` | lexical codec (§1.4) | `"as": "digits14tz"` |
| `"truncate": n` | slice the raw value | `Part_Event` ≤ 256 |
| `"map": {...}, "default": d` | enumeration mapping | `CARD → CREDIT_CARD`, `VERIFIED → ACTIVE` |
| `"fallback_field"/"fallback"` | falsy value → another field / literal | `SesionId`: session id else round id |
| `"when": {...}` | conditional presence (`equals` / `present`) | DOB only when known |
| `"each": field` | repeat per item of a list field; inner bindings see the item | one `Jugador` per register row |
| `[variant, variant]` | first variant whose `when` holds wins | `Depositos` full vs zero, by direction |
| `{"defer": name}` | resolve the binding the record type declares under `name` | shared envelope, per-type `LoteId` |

Two properties worth noting:

- **Element order is spec order.** Dicts preserve insertion order, and XSD
  sequences care — the spec reads top-to-bottom like the schema.
- **Determinism is designed in.** Business identifiers that regulators
  type as UUIDs are `uuid5(business key)` — a re-run reproduces identical
  documents — and the clock is injectable, which is what makes
  byte-identity testing (and replay after an incident) possible.

### 1.4 Lexical profiles: the codec catalogue

Codecs encode each regulator's lexical conventions, named once in
`engine.CODECS` and shared by every spec. The catalogue after two markets:

| Codec | Produces | Used by |
|---|---|---|
| `datetime` | `YYYY-MM-DDThh:mm:ssZ` | NL, (GR when converted) |
| `date` | `YYYY-MM-DD` | NL DOB |
| `money` / `money4` | 2 / 4 decimals | all / ES odds & jackpots |
| `flag-positive` | `1`/`0` | NL rounds-won |
| `digits14` / `digits14tz` | `AAAAMMDDHHMMSS` (+`+0000`) | ES |
| `digits8` / `digits6` | `AAAAMMDD` / `AAAAMM` | ES periods |

This is the comparison document's observation made executable: the entire
lexical variance of four very different regimes clusters into a dozen
codecs. DK adds nothing new except its 10-decimal money type; GR reuses
NL's almost wholesale.

### 1.5 House patterns: constructors, not copy-paste

Recurring regulator idioms are built by tiny **spec constructors** —
functions that assemble dict literals at import time (the same way
`jurisdictions.js` uses JS helpers to shape config). ES defines
`_IMPORTE(field)` (the Cantidad/Unidad line list, empty = zero),
`_DESGLOSE(field)` (the Total+breakdown pattern) and `_CJD_JUGADOR` — one
declaration of the CJD player money block, shared by the payments record
and both periodic filings. Crucially these run once at import and contain
no runtime logic; what the engine sees is still plain data.

### 1.6 The testing discipline

Every conversion ships with a **byte-identity test** against a retained
oracle (`test_nl_spec.py`, `test_es_spec.py`): canonical records covering
every branch — both variant arms, conditional fields present and absent,
fallbacks firing and not firing, list loops with multiple rows — run
through oracle and engine, compared as serialised bytes, with the clock
frozen where the format stamps "now". For a *new* market with no oracle,
the same harness compares against **golden files** reviewed once against
the regulator's schema and examples, and the CI gate validates output
against the vendored XSDs (Option B of the architecture doc).

### 1.7 The routine changes, costed

| Change | Touches | Example |
|---|---|---|
| New reported field | one binding line per affected spec | add `Bet_Commission`: `{"from": "commission", "as": "money"}` |
| New market | new spec file + XSDs + golden tests | `specs/dk_v2.py` |
| Regulator version bump | copy spec to new version, adjust, run both in parallel | `nl_v1_11.py` → `nl_v1_12.py` |
| New lexical convention | one codec, once | DK's 10-decimal money |
| New structural mechanism | engine change (rare, reviewed once) | ES needed `each`, variants, `defer` — NL→ES was the last big step; GR is expected to need none |

---

## Part 2 — Deploying with Cloud Workflows

### 2.1 What runs where

```
Cloud Scheduler ──> Cloud Workflows ──> Dataform run (SQL: all business logic)
                          │  on success
                          ├─ parallel per market ──> Cloud Run JOB "submission-engine"
                          │      args: --market=ES --report-date=2026-07-13
                          │      1. query submission_ready_es (BigQuery Storage API)
                          │      2. engine.serialise(spec, ...) per record/filing
                          │      3. validate against vendored XSDs (fail-closed)
                          │      4. sign/encrypt where the regime demands it
                          │      5. deliver (SFTP safe / SOAP / REST)
                          │      6. write receipts -> reporting_core.submission_receipts
                          └─ on any failure: alert + halt that market only
```

The container is deliberately tiny: the engine, the spec files, the
vendored XSDs, `google-cloud-bigquery`, an XSD validator (`xmlschema` or
`lxml`), and the crypto/transport libraries. No web framework — the demo
website is not deployed; it was only ever a local harness around the same
engine.

### 2.2 Step-by-step

**Step 1 — package the service.** Lift `regulator_formats/` (engine +
specs, already dependency-free) into
`dataform-starter/submission-service/`, alongside a `main.py` that parses
`--market/--report-date`, streams rows, and runs steps 1–6 above.

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY submission-service/ ./
RUN pip install --no-cache-dir google-cloud-bigquery google-cloud-secret-manager \
    xmlschema paramiko requests
ENTRYPOINT ["python", "main.py"]
```

**Step 2 — create the Cloud Run job** (one job, parameterised per
execution — not one job per market):

```bash
gcloud run jobs create submission-engine \
  --image europe-west1-docker.pkg.dev/$PROJECT/reporting/submission-engine:$TAG \
  --region europe-west1 \
  --service-account submission-engine@$PROJECT.iam.gserviceaccount.com \
  --set-secrets "REGULATOR_CREDS=regulator-creds:latest" \
  --task-timeout 30m --max-retries 1
```

IAM for the service account: `roles/bigquery.jobUser` +
`roles/bigquery.dataViewer` on the reporting dataset,
`roles/bigquery.dataEditor` on `submission_receipts`,
`roles/secretmanager.secretAccessor` on the regulator credential secrets.
Signing keys and endpoint credentials live in **Secret Manager**, never in
the image or the spec.

**Step 3 — the Workflow.** Cloud Workflows is the orchestrator: it runs
the Dataform invocation, waits for success, then fans the markets out in
parallel, passing each as an argument to a job execution:

```yaml
# submission.workflows.yaml
main:
  params: [input]            # {"report_date": "2026-07-13"} (or computed)
  steps:
    - init:
        assign:
          - markets: ["MT", "ES", "DK", "BG", "GR", "NL", "DE"]
          - report_date: ${default(map.get(input, "report_date"), text.substring(time.format(sys.now()), 0, 10))}

    - run_dataform:
        call: http.post
        args:
          url: ${"https://dataform.googleapis.com/v1beta1/projects/" + sys.get_env("GOOGLE_CLOUD_PROJECT_ID") + "/locations/europe-west1/repositories/reporting/workflowInvocations"}
          auth: {type: OAuth2}
          body:
            compilationResult: ${latest_compilation}
        result: dataform_invocation

    - await_dataform:            # poll until SUCCEEDED; fail the run otherwise
        call: poll_dataform_until_done
        args: {invocation: ${dataform_invocation.body.name}}

    - submit_all_markets:
        parallel:
          for:
            value: market
            in: ${markets}
            steps:
              - run_market_job:
                  call: googleapis.run.v1.namespaces.jobs.run
                  args:
                    name: ${"namespaces/" + sys.get_env("GOOGLE_CLOUD_PROJECT_ID") + "/jobs/submission-engine"}
                    location: europe-west1
                    body:
                      overrides:
                        containerOverrides:
                          - args: ["--market", "${market}", "--report-date", "${report_date}"]
                  result: execution
                  # connector waits for the execution to complete and
                  # raises on non-zero exit -> retry, then surface
                  retry:
                    predicate: ${http.default_retry_predicate}
                    max_retries: 2
                    backoff: {initial_delay: 60, max_delay: 600, multiplier: 2}

    - verify_receipts:           # the workflow's own completeness gate
        call: googleapis.bigquery.v2.jobs.query
        args:
          projectId: ${sys.get_env("GOOGLE_CLOUD_PROJECT_ID")}
          body:
            query: >-
              SELECT jurisdiction FROM reporting_core.submission_receipts
              WHERE report_date = @d GROUP BY 1
            queryParameters:
              - name: d
                parameterType: {type: DATE}
                parameterValue: {value: '${report_date}'}
        result: receipts

    - done:
        return: ${receipts}
```

(The Dataform trigger/poll steps are sketched — most estates already have
them; the load-bearing parts are the **parallel fan-out**, the **job-arg
overrides**, and the **retry policy per market** so one regulator's
outage never blocks the other sixteen.)

**Step 4 — schedule it.** One Cloud Scheduler trigger per cadence, each
invoking the workflow with its parameters — daily end-of-day after the
Dataform close, monthly on the regulator's filing day (e.g. ES RUT), plus
an on-demand invocation path (`gcloud workflows run submission
--data='{"report_date":"2026-07-12","markets":["ES"]}'`) for refiles —
the production equivalent of the demo's *Admin → Periodic reports* button.

**Step 5 — CI/CD for specs.** Because specs are files in this repo, the
pipeline is ordinary code review plus two mechanical gates on every PR:
the byte-identity/golden suites (`test_nl_spec.py`, `test_es_spec.py`,
one per converted market) and XSD validation of generated golden files
against `docs/regulator/`. Merge → build image → `gcloud run jobs update`.
A regulator version bump ships as a new spec version file behind a config
flag, run in parallel against the old one until cutover.

### 2.3 Operational notes

- **Idempotency**: the engine keys deliveries exactly as the demo does
  (record key / filing key logged with the receipt); a retried job
  execution skips what already holds a receipt, and a refiled register
  supersedes its predecessor.
- **Failure isolation**: one market = one job execution = one retry
  policy = one alert. A DGOJ outage is an ES incident, not a reporting
  incident.
- **Scale**: executions are stateless and parallel; within a market, the
  BigQuery Storage Read API streams rows and envelope config splits files
  at the regulator's ceilings (NL 512 records; ES subregistro splitting).
- **Observability**: receipts land in BigQuery, so the existing
  reconciliation (ready vs submitted vs acknowledged) stays in Dataform
  and Looker — the workflow's `verify_receipts` step is only the
  first-line completeness check.
- **The demo stays useful**: the local website exercises the *same*
  engine and specs end to end (`python dataform-website/app.py`), so a
  spec change can be watched hitting a SAFE before it ever ships.
