# BigQuery + Dataform on GCP — Installation & Setup How-To

This is the **deployment runbook** for this repository: how to install the
reporting pipeline (`dataform-example/`) into an **existing GCP project**
on BigQuery using Dataform, and how to stand up the **Python translation
layer** (`dataform-website/regulator_formats/`) on Cloud Run, orchestrated
by **Cloud Workflows** so it runs when submission data is ready to be
converted to regulator XML.

Companion documents — this runbook tells you *what to type*; they tell you
*why it's shaped this way*:

| Doc | Covers |
|---|---|
| [`dataform-example/ARCHITECTURE.md`](dataform-example/ARCHITECTURE.md) + [`CLAUDE.md`](dataform-example/CLAUDE.md) | The pipeline's layers and maintainer contract |
| [`docs/regulator/translation-architecture.md`](docs/regulator/translation-architecture.md) | Why translation lives outside BigQuery, config-driven |
| [`docs/regulator/mapping-engine-deployment.md`](docs/regulator/mapping-engine-deployment.md) | The mapping method in detail + the deployment design this runbook implements |
| [`how-to.md`](how-to.md) | Day-2 changes (fields, rules, markets) once you're deployed |

What you will have at the end:

```
CDC landing tables ──> Dataform (scheduled run: models + assertions)
  (seed script now,        │ produces submission_ready_{mkt}, tax, recon
   Datastream later)       │ — fail-closed: bad/late data quarantined
                           ▼
Cloud Scheduler ──> Cloud Workflows ─ per market, in parallel ─> Cloud Run JOB
                    (waits for the Dataform                      "submission-engine"
                     run to SUCCEED —                            reads submission_ready_{mkt},
                     that is "data ready")                       serialises regulator XML via
                           │                                     regulator_formats specs,
                           ▼                                     writes files + receipts
                    verify receipts in BigQuery <────────────────┘
```

Throughout, replace `PROJECT_ID`, `REGION` (examples use `europe-west1`)
and bucket/repo names with your own. All commands are `bash`-style; on
Windows run them in Git Bash or Cloud Shell.

---

## Part 0 — Prerequisites

1. **An existing GCP project** with billing enabled, and you holding (or
   able to grant) `roles/owner` or at minimum: BigQuery Admin, Dataform
   Admin, Cloud Run Admin, Workflows Admin, Cloud Scheduler Admin,
   Artifact Registry Admin, Secret Manager Admin, Service Account Admin.
2. **Local tooling**: `gcloud` CLI (authenticated: `gcloud auth login`,
   `gcloud config set project PROJECT_ID`), `bq` (ships with gcloud),
   Node 18+ (for staging/verifying the Dataform workspace), git.
3. **Enable the APIs** (one-time):

```bash
gcloud services enable \
  bigquery.googleapis.com dataform.googleapis.com \
  run.googleapis.com workflows.googleapis.com \
  cloudscheduler.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com
```

4. **Pick your locations and keep them consistent**: a BigQuery location
   (the repo defaults to the `EU` multi-region in
   `workflow_settings.yaml`) and a compute region for
   Dataform/Run/Workflows (e.g. `europe-west1`).

---

## Part 1 — The pipeline: BigQuery + Dataform

### 1.1 Understand the deployable artifact

The Dataform project is **exactly three things**:
`dataform-example/workflow_settings.yaml` + `definitions/` + `includes/`.
Everything else in `dataform-example/` (package.json, node_modules, seed/,
local/, test/) belongs to the offline DuckDB harness, and **Dataform 3.x
refuses to compile a workspace that contains npm artifacts**. The repo
already solves this: `npm run dataform:compile` stages the pure workspace
into a temp folder and runs the genuine `@dataform/cli` against it — the
staged folder IS what you deploy. (There are no `.sqlx` files by design:
the project uses Dataform's JavaScript API so the same SQL builders run
offline; see `dataform-example/ARCHITECTURE.md` §7.)

### 1.2 Point the project at your GCP project

Edit `dataform-example/workflow_settings.yaml`:

```yaml
defaultProject: PROJECT_ID        # was: your-gcp-project
defaultLocation: EU               # your BigQuery location
defaultDataset: reporting_core
defaultAssertionDataset: reporting_assertions
dataformCoreVersion: 3.0.0
vars:
  env: prod          # dev | staging | prod — non-prod suffixes datasets
  parallel_run: "false"  # "true" only while running legacy parallel-run diffs
```

Set `parallel_run: "false"` unless you have landed legacy capture tables
(the `40_recon` legacy-diff models read them).

### 1.3 Verify it compiles before touching the cloud

```bash
cd dataform-example
npm install
npm run check              # unit tests + demo + offline pipeline + emit-sql
npm run dataform:compile   # the GENUINE @dataform/cli against the staged workspace
```

Expect `dataform compile SUCCEEDED` with ~200+ actions. Nothing deploys
until this is green — it is the same gate the maintainers use.

### 1.4 Create the landing tables and proof data (seed)

In production the `cdc_*` landing tables are fed by CDC replication
(Datastream from the OLTP estate — see §1.9). For installation and the
first verified run, use the generated seed script, which creates the
datasets/tables and loads the deterministic demo data whose expected
outputs are documented in `dataform-example/README.md`:

```bash
cd dataform-example
npm run seed:generate                       # regenerates seed/bigquery_setup.sql
bq query --location=EU --use_legacy_sql=false < seed/bigquery_setup.sql
```

The script is a BigQuery multi-statement script (CREATE SCHEMA + CREATE
TABLE + INSERTs). Verify: `bq ls` shows the landing dataset(s), and e.g.
`SELECT COUNT(*) FROM cdc_bet_slips` returns the seeded count.

> ⚠️ **The watermark rule** — the single most repeated onboarding mistake
> in this repo's history (bit DE, deliberately re-proven for FR and PT):
> the pipeline is **fail-closed** on `cdc_source_watermarks`. If your
> ingestion does not maintain a watermark row per source per market, that
> market compiles fine, ships **empty files**, and parks its entities in
> `fct_exceptions` as `WAITING_DATA`. The seed includes watermarks; your
> Datastream/ingestion job must keep them current in production.

### 1.5 Create the Dataform repository (Git-connected)

Dataform on GCP executes from a Git repository whose **root** is the pure
workspace. Because this monorepo keeps the workspace under
`dataform-example/` with harness files beside it, publish the staged
workspace to a dedicated deployment repo (or an orphan branch):

```bash
cd dataform-example
npm run dataform:compile          # stages to $TMPDIR/dataform-workspace and verifies
cd "$TMPDIR/dataform-workspace"   # Windows: %TEMP%\dataform-workspace
git init -b main && git add -A && git commit -m "Dataform workspace $(date +%F)"
git remote add origin https://github.com/YOUR-ORG/reporting-dataform-deploy.git
git push -u origin main
```

(Automate this staging+push as a CI step on merges to `main` later.)

Connect it to Dataform — token first, then the repository:

```bash
# a GitHub fine-grained PAT with read access to the deploy repo
printf '%s' "$GITHUB_TOKEN" | gcloud secrets create dataform-git-token --data-file=-

gcloud dataform repositories create reporting \
  --region=REGION \
  --set-git-remote-settings=url=https://github.com/YOUR-ORG/reporting-dataform-deploy.git,default-branch=main,authentication-token-secret-version=projects/PROJECT_ID/secrets/dataform-git-token/versions/latest
```

(Console equivalent: BigQuery ▸ Dataform ▸ Create repository ▸ Connect
with Git. If you prefer not to Git-connect, you can instead paste the
staged files into a Dataform **workspace** in the console and commit from
there — functionally identical, less automatable.)

### 1.6 Grant the Dataform service agent access

Dataform executes as a Google-managed service agent
`service-PROJECT_NUMBER@gcp-sa-dataform.iam.gserviceaccount.com`:

```bash
PN=$(gcloud projects describe PROJECT_ID --format='value(projectNumber)')
SA="service-${PN}@gcp-sa-dataform.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:${SA}" --role=roles/bigquery.jobUser
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:${SA}" --role=roles/bigquery.dataEditor
gcloud secrets add-iam-policy-binding dataform-git-token \
  --member="serviceAccount:${SA}" --role=roles/secretmanager.secretAccessor
```

(Tighten `dataEditor` to the `reporting_*` datasets once created, if your
project hosts other data.)

### 1.7 Release + workflow configuration, and the first run

```bash
# compile main on a schedule (hourly compile of the latest commit)
gcloud dataform release-configs create prod \
  --repository=reporting --region=REGION \
  --git-commitish=main --cron-schedule="0 * * * *" --timezone="Etc/UTC"

# execute everything (models + assertions) daily at 01:30 UTC
gcloud dataform workflow-configs create prod-daily \
  --repository=reporting --region=REGION \
  --release-config=prod --cron-schedule="30 1 * * *" --timezone="Etc/UTC"
```

Kick a run now instead of waiting for cron: console ▸ Dataform ▸
reporting ▸ prod ▸ **Start execution** (or `gcloud dataform
workflow-invocations create` referencing the latest compilation result —
the Workflows definition in Part 2 does exactly this programmatically).

**Verify against the documented expectations** (`dataform-example/README.md`
lists the exact expected rows for the seed):

```sql
SELECT * FROM `PROJECT_ID.reporting_mt.submission_ready_mt` ORDER BY slip_id;
SELECT * FROM `PROJECT_ID.reporting_pt.tax_summary_pt`;
-- assertion results: every reporting_assertions view should return 0 rows
```

All ~130 rule assertions are first-class Dataform assertions named after
their regulatory clause ids (`rule_pt_pt_101`, …) — a red assertion
blocks dependents, which is the point: **a failed run means the data was
not ready, and Part 2 will refuse to serialise it.**

### 1.8 Alternative: CLI-only execution (no Git connection)

For a spike, or CI-driven execution without the managed scheduler:

```bash
cd "$TMPDIR/dataform-workspace"
npx -y @dataform/cli@latest init-creds   # choose ADC / JSON key, location EU
npx -y @dataform/cli@latest run          # compiles and executes against BigQuery
```

Same artifacts, same result; you own scheduling and monitoring.

### 1.9 Production data: swap seed for CDC

Replace the seeded landing tables with real replication when ready:
Datastream (SQL Server/Oracle/MySQL → BigQuery) landing into the same
`cdc_*` names, or your ingestion of choice. Non-negotiables:

- land **append-only lifecycle events** as-is (the pipeline derives state;
  it never needs updates in place),
- maintain `cdc_source_watermarks` per source/market (§1.4 warning),
- keep UTC timestamps (local-time conversion happens inside the pipeline).

The staging layer already dedupes CDC replays (`stg_*` in
`definitions/10_staging/`), so at-least-once delivery is fine.

---

## Part 2 — The Python translation layer on Cloud Run + Cloud Workflows

The pipeline ends at `submission_ready_{mkt}` tables. Converting those
rows to each regulator's XML is the job of the **mapping engine**
(`dataform-website/regulator_formats/`: one generic serialiser + one spec
per market, already proven for NL/ES/FR/PT with golden files and XSD
gates). It runs as a **Cloud Run job**, and **Cloud Workflows** runs it
*when the data is ready* — "ready" meaning the Dataform invocation (models
**and** assertions) succeeded, on top of the pipeline's own fail-closed
row-level gates (watermarks, quarantine, holds).

### 2.1 Assemble the service

Create `submission-service/` (the skeleton exists in
`dataform-starter/submission-service/`; the engine+specs are lifted, not
rewritten — they are stdlib-only by design):

```
submission-service/
  regulator_formats/        # copied verbatim from dataform-website/regulator_formats/
  main.py                   # the batch entrypoint below
  Dockerfile
```

`main.py` — reads one market's ready rows for a report date, maps each row
to the canonical dict, serialises through the market's spec, writes the
XML to a GCS "Safe outbox", and records receipts:

```python
"""submission-engine: submission_ready_{mkt} rows -> regulator XML files.

One Cloud Run job execution = one (market, report_date). The mapping
specs (regulator_formats/specs/*) own every element name; this file owns
only reading rows, the row->canonical mapping, and delivery."""
import argparse
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone

from google.cloud import bigquery, storage

import regulator_formats

BQ = bigquery.Client()
GCS = storage.Client()

# submission_ready_* column -> canonical field, per market where they
# differ (the demo's submission.py builders are the reference for the
# canonical field names each spec binds to).
BETS_CANONICAL = {
    "PT": lambda r: {
        "record_key": r["slip_id"], "slip_id": r["slip_id"],
        "player_ref": r["account_id"], "username": r["account_id"],
        "fixture_id": r["slip_id"], "sport": r["sport_code"],
        "event": r["event_name"], "participants": [],
        "selection": "", "odds": 0, "stake": r["stake"],
        "payout": r["payout"], "status": r["slip_status"],
        "void_reason": None,
        "placed_at": r["placed_at_local"], "terminal_at": r["settled_at_local"],
        # balance triplets come from the wallet-ledger model in production
        # (fct_wallet_ledger); wire them here when that model is deployed
        "balance_before_stake": 0, "balance_after_stake": 0,
        "balance_before_credit": 0, "balance_after_credit": 0,
        "balance_net": 0,
    },
    # add NL/ES/FR/... mappings as those markets go live
}


def run(market: str, report_date: date, bucket: str):
    rows = list(BQ.query(
        f"SELECT * FROM `reporting_{market.lower()}.submission_ready_{market.lower()}` "
        "WHERE report_date = @d ORDER BY 1",
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("d", "DATE", report_date)])).result())
    if not rows:
        print(f"{market} {report_date}: no ready rows — nothing to file")
        return

    out = GCS.bucket(bucket)
    receipts = []
    for row in rows:
        rec = BETS_CANONICAL[market](dict(row))
        payload = regulator_formats.format_record(market, "bets", rec)
        documents = payload if isinstance(payload, list) else [(None, payload)]
        for suffix, root in documents:
            key = f"{rec['record_key']}-{suffix}" if suffix else rec["record_key"]
            ET.indent(root)
            blob = out.blob(f"{market}/bets/{report_date}/{key}.xml")
            blob.upload_from_string(ET.tostring(root, encoding="unicode"),
                                    content_type="application/xml")
            receipts.append({"jurisdiction": market, "record_type": "bets",
                             "record_key": key,
                             "report_date": report_date.isoformat(),
                             "uri": f"gs://{bucket}/{blob.name}",
                             "submitted_at": datetime.now(timezone.utc).isoformat()})
    BQ.insert_rows_json("reporting_core.submission_receipts", receipts)
    print(f"{market} {report_date}: filed {len(receipts)} document(s)")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--market", required=True)
    p.add_argument("--report-date", required=True)
    p.add_argument("--bucket", required=True)
    a = p.parse_args()
    run(a.market.upper(), date.fromisoformat(a.report_date), a.bucket)
```

Notes on honesty and scope: this entrypoint files the **bets** stream; add
the other record types the same way (players/payments/gaming), and swap
the GCS outbox for each regulator's real transport (FTPS deposit to the PT
Safe, signed manifests for NL, …) inside per-market delivery functions —
the design for signing/encryption/transport is in
`docs/regulator/mapping-engine-deployment.md` §2. Balance-triplet fields
must come from the wallet-ledger model, not be recomputed here.

`Dockerfile`:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY . .
RUN pip install --no-cache-dir google-cloud-bigquery google-cloud-storage xmlschema
ENTRYPOINT ["python", "main.py"]
```

### 2.2 Supporting resources

```bash
# the Safe outbox and the receipts table
gcloud storage buckets create gs://PROJECT_ID-regulator-outbox --location=EU

bq query --location=EU --use_legacy_sql=false '
CREATE TABLE IF NOT EXISTS reporting_core.submission_receipts (
  jurisdiction STRING, record_type STRING, record_key STRING,
  report_date DATE, uri STRING, submitted_at TIMESTAMP
)'
```

### 2.3 Build and create the Cloud Run job

```bash
gcloud artifacts repositories create reporting --repository-format=docker --location=REGION

cd submission-service
gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT_ID/reporting/submission-engine:v1

# dedicated runtime service account, least privilege
gcloud iam service-accounts create submission-engine
SE="submission-engine@PROJECT_ID.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding PROJECT_ID --member="serviceAccount:${SE}" --role=roles/bigquery.jobUser
gcloud projects add-iam-policy-binding PROJECT_ID --member="serviceAccount:${SE}" --role=roles/bigquery.dataViewer
gcloud projects add-iam-policy-binding PROJECT_ID --member="serviceAccount:${SE}" --role=roles/bigquery.dataEditor   # tighten to reporting_core
gcloud storage buckets add-iam-policy-binding gs://PROJECT_ID-regulator-outbox \
  --member="serviceAccount:${SE}" --role=roles/storage.objectCreator

gcloud run jobs create submission-engine \
  --image=REGION-docker.pkg.dev/PROJECT_ID/reporting/submission-engine:v1 \
  --region=REGION --service-account="${SE}" \
  --task-timeout=30m --max-retries=1
```

Regulator credentials/signing keys, when you wire real transports, go in
Secret Manager and are attached with `--set-secrets` — never in the image
or the spec.

### 2.4 The Cloud Workflows definition — "run when data is ready"

"Data ready" is decided in two layers, both already built:

1. **Row-level** (inside the pipeline): the admissibility filter keeps
   quarantined/held/incomplete entities and unclosed periods out of
   `submission_ready_{mkt}` — fail-closed, per entity.
2. **Run-level** (this workflow): serialisation starts **only after the
   Dataform workflow invocation reports SUCCEEDED**, which includes every
   rule assertion. A red assertion = no XML is produced for anyone.

`submission.workflows.yaml`:

```yaml
main:
  params: [input]
  steps:
    - init:
        assign:
          - project: ${sys.get_env("GOOGLE_CLOUD_PROJECT_ID")}
          - region: "REGION"
          - repo: ${"projects/" + project + "/locations/" + region + "/repositories/reporting"}
          - markets: ${default(map.get(input, "markets"), ["MT","ES","DK","BG","GR","NL","DE","FR","PT"])}
          - report_date: ${default(map.get(input, "report_date"), text.substring(time.format(sys.now()), 0, 10))}
          - bucket: ${project + "-regulator-outbox"}

    # 1. compile the release and invoke the full Dataform run
    - compile:
        call: http.post
        args:
          url: ${"https://dataform.googleapis.com/v1beta1/" + repo + "/compilationResults"}
          auth: {type: OAuth2}
          body:
            releaseConfig: ${repo + "/releaseConfigs/prod"}
        result: compilation
    - invoke_dataform:
        call: http.post
        args:
          url: ${"https://dataform.googleapis.com/v1beta1/" + repo + "/workflowInvocations"}
          auth: {type: OAuth2}
          body:
            compilationResult: ${compilation.body.name}
        result: invocation

    # 2. wait until models AND assertions succeed — this IS "data ready"
    - await_dataform:
        steps:
          - poll:
              call: http.get
              args:
                url: ${"https://dataform.googleapis.com/v1beta1/" + invocation.body.name}
                auth: {type: OAuth2}
              result: state
          - check:
              switch:
                - condition: ${state.body.state == "SUCCEEDED"}
                  next: fan_out
                - condition: ${state.body.state == "FAILED" or state.body.state == "CANCELLED"}
                  raise: ${"Dataform invocation " + state.body.state + " — data NOT ready, no XML will be produced"}
          - backoff:
              call: sys.sleep
              args: {seconds: 60}
              next: poll

    # 3. one Cloud Run job execution per market, in parallel; one market's
    #    regulator outage never blocks the others
    - fan_out:
        parallel:
          for:
            value: market
            in: ${markets}
            steps:
              - run_market:
                  call: googleapis.run.v1.namespaces.jobs.run
                  args:
                    name: ${"namespaces/" + project + "/jobs/submission-engine"}
                    location: ${region}
                    body:
                      overrides:
                        containerOverrides:
                          - args: ["--market", "${market}",
                                   "--report-date", "${report_date}",
                                   "--bucket", "${bucket}"]
                  retry:
                    predicate: ${http.default_retry_predicate}
                    max_retries: 2
                    backoff: {initial_delay: 60, max_delay: 600, multiplier: 2}

    # 4. first-line completeness check (full recon stays in Dataform/Looker)
    - verify:
        call: googleapis.bigquery.v2.jobs.query
        args:
          projectId: ${project}
          body:
            useLegacySql: false
            parameterMode: NAMED
            queryParameters:
              - name: d
                parameterType: {type: DATE}
                parameterValue: {value: '${report_date}'}
            query: >-
              SELECT jurisdiction, COUNT(*) filed
              FROM reporting_core.submission_receipts
              WHERE report_date = @d GROUP BY 1 ORDER BY 1
        result: receipts
    - done:
        return: ${receipts.body.rows}
```

Deploy it with its own service account:

```bash
gcloud iam service-accounts create submission-orchestrator
SO="submission-orchestrator@PROJECT_ID.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding PROJECT_ID --member="serviceAccount:${SO}" --role=roles/dataform.editor
gcloud projects add-iam-policy-binding PROJECT_ID --member="serviceAccount:${SO}" --role=roles/run.developer
gcloud projects add-iam-policy-binding PROJECT_ID --member="serviceAccount:${SO}" --role=roles/bigquery.jobUser
gcloud iam service-accounts add-iam-policy-binding "${SE}" \
  --member="serviceAccount:${SO}" --role=roles/iam.serviceAccountUser

gcloud workflows deploy submission \
  --source=submission.workflows.yaml --location=REGION --service-account="${SO}"
```

(If you keep the Dataform workflow-config cron from §1.7, remove it — the
workflow now owns invocation, so the run isn't triggered twice.)

### 2.5 Schedule it — and the on-demand path

```bash
# daily end-of-day close at 01:30 UTC (after the PT-style 01:00 packaging window)
gcloud scheduler jobs create http submission-daily \
  --location=REGION --schedule="30 1 * * *" --time-zone="Etc/UTC" \
  --uri="https://workflowexecutions.googleapis.com/v1/projects/PROJECT_ID/locations/REGION/workflows/submission/executions" \
  --http-method=POST --oauth-service-account-email="${SO}" \
  --message-body='{"argument": "{}"}'
```

Add further schedules per cadence (e.g. monthly for ES RUT). Refiles and
backfills are the same workflow with arguments — the production analogue
of the demo's *Admin → Periodic reports* button:

```bash
gcloud workflows run submission --location=REGION \
  --data='{"report_date":"2026-07-13","markets":["PT"]}'
```

### 2.6 Smoke test the whole chain

```bash
gcloud workflows run submission --location=REGION --data='{"markets":["PT"]}'

gcloud storage ls gs://PROJECT_ID-regulator-outbox/PT/bets/   # XML landed?
bq query --use_legacy_sql=false \
  'SELECT * FROM reporting_core.submission_receipts ORDER BY submitted_at DESC LIMIT 10'
```

You should see one XML per ready record (per **document** for multi-trace
regimes like FR: `S1234-MISE.xml` + `S1234-GAIN.xml`) and matching receipt
rows. To prove fail-closed behaviour, corrupt a seeded row so a rule
assertion fires, re-run the workflow, and watch it raise at
`await_dataform` with **zero** new files — that is the design working.

---

## Part 3 — Operations notes

- **Idempotency**: re-running a (market, date) overwrites the same GCS
  object names; make receipt inserts a MERGE on
  (jurisdiction, record_type, record_key, report_date) if you need strict
  once-only semantics against real regulator endpoints (the demo's
  `safe_submissions` PK is the reference behaviour).
- **Spec changes** ship through this repo's gates *before* any image
  build: golden-file suites + XSD validation
  (`dataform-website/test_*_spec.py`) in CI, then rebuild the image and
  `gcloud run jobs update submission-engine --image=...:v2`.
- **Monitoring**: alert on Workflows execution failures and Cloud Run job
  failures; the reconciliation models (ready vs receipts) are the
  substantive completeness check — surface them in Looker Studio.
- **Cost**: everything here is serverless and scale-to-zero; the standing
  costs are BigQuery storage and the scheduled Dataform runs.
- **Local parity**: the same engine and specs run in the local demo
  (`python dataform-website/app.py`) — a change can be watched hitting a
  SAFE on your desktop before it ever ships to GCP.
- **Teardown** (of everything this runbook created): the scheduler job,
  workflow, Cloud Run job, Artifact Registry repo, GCS bucket, Dataform
  repository + release/workflow configs, the two service accounts, the
  git-token secret, and the `reporting_*` datasets.
