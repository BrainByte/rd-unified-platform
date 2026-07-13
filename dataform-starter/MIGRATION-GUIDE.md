# SQL Server → BigQuery Regulatory Reporting Migration

Strangler-fig migration of a 14-year legacy SQL Server reporting estate
(stored procs, triggers, views, SSRS, SOAP submissions for 17 regulated
gaming markets) to BigQuery + Dataform, designed for AI maintainability.

## Phase 1 — Replicate, migrate nothing

- CDC from SQL Server into BigQuery via **Datastream** (or Debezium/Kafka
  for more control).
- Raw append-only landing layer mirroring OLTP tables with change history.
- Legacy code untouched; BigQuery is a shadow environment.

## Phase 2 — Rebuild transformations in Dataform

Five-layer abstraction (see repo scaffold):

1. **`includes/jurisdictions.js`** — all market variance as config
   (rates, cutoffs, field lists, cadence). Regulatory change = one-line diff.
2. **`includes/common.js`** — shared SQL generators as pure JS functions
   (settlement windows, field expressions, tax models). Written once.
3. **Fan-out** — `definitions/30_submissions/submissions.js` loops the
   config to publish 17 partitioned tables, each in its own dataset for
   hard isolation + per-market IAM. Genuine divergence = small override
   SQLX, flagged `customSubmission: true`.
4. **Assertions** — executable regulatory spec: totals reconcile,
   completeness, uniqueness. Pipeline fails before a bad file ships.
5. **Tags** — per market + stage, so Cloud Workflows/Scheduler runs each
   market on its own cadence from one codebase.

Golden rules (enforced via CLAUDE.md):
- Staging/core layers never branch on jurisdiction.
- Submissions layer holds no business logic.
- All timezone conversion via one function; timestamps stored UTC.

## Phase 3 — Submissions out of the database

- Generic **Cloud Run engine** reads `submission_ready_{mkt}`, delegates
  to per-market **adapters** (~50 lines: SOAP envelope quirks only).
- Receipts written to `submission_receipts` → permanent internal recon
  (submitted vs ready vs back office) in Dataform, surfaced in Looker
  Studio (replaces SSRS recon reports).

## Phase 4 — Parallel run and cutover, market by market

1. **Capture legacy outputs, don't recompute** — land actual legacy
   submission tables/files into BigQuery (`legacy_capture.*`).
2. **Diff at three levels** (generated per market from `includes/recon.js`):
   - Totals: counts + sums per day.
   - Row-level anti-joins on (bet_id, report_date).
   - Field-level compare with rounding tolerance.
   Breaks land in `recon.recon_breaks_*` tables → Looker Studio trend page.
3. **Classify every break**: new-pipeline bug (fix) or faithful
   non-reproduction of a legacy bug (compliance decision — preserve or
   fix-and-notify regulator). Keep a breaks log as sign-off evidence.
4. **Cutover criteria**: ~30 consecutive clean daily cycles + one clean
   month-end; zero unexplained breaks; signed-off log. Flip the SOAP
   service to the new table; run legacy silently 2–4 weeks as fallback;
   decommission; delete that market's recon_legacy entries.
5. **Compress the cycle**: market 1 ≈ 2–3 months (builds the harness);
   subsequent markets ≈ 4–6 weeks, usually gated by compliance not
   engineering. Start with the simplest market.

## Known traps

- **Logic hiding outside the database**: SSRS report expressions and the
  SOAP layer often contain adjustments/formatting that won't appear in a
  stored-proc inventory. Audit both before parallel run.
- **Timezones/cutoffs** cause most breaks. Test DST transition dates for
  every market explicitly.
- **Latency**: BigQuery isn't OLTP. If a market needs sub-minute
  submission, use the streaming path (Datastream streaming inserts, or
  Pub/Sub direct to the submission service), not batch Dataform runs.
- Keep the JS generation boring: config objects + small pure functions +
  one loop per stage. If a human can't trace config → compiled SQL in a
  minute, an AI will make riskier edits too.

## AI maintainability checklist

- [ ] CLAUDE.md at repo root states the architecture rules
- [ ] All variance in jurisdictions.js; `dataform compile` diff shows
      blast radius of any change
- [ ] Assertions encode "what must remain true" per market
- [ ] Small files, numbered stage prefixes, tags mirror the DAG
- [ ] Typical change ("add field X to market Y") touches ≤ 2 files
