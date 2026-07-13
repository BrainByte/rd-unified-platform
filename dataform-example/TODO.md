# TODO — next steps

Ordered roughly by dependency and value. Each item has acceptance
criteria so a session (human or AI) can pick one up cold. Keep this file
current: tick items off, add discoveries, and mirror status changes in
CLAUDE.md's continuation notes.

## 1. Desktop bring-up ⏱ small
- [ ] Unzip into a Git repo, initial commit
- [ ] `npm install` then `npm run check` (tests + demo + offline pipeline)
- [ ] Fix any DuckDB niggles **in `includes/dialect.js` only** (the
      execution path was built and dry-run-verified in a sandbox without
      npm network access — first real run is the true end-to-end check)
- **Done when:** `npm run check` is green locally and committed.

## 2. CI pipeline ⏱ small
- [ ] GitLab CI (`brainbyte` GitLab is available) running:
      `npm test` → `npm run local` → `dataform compile` (compile can be
      a later stage once GCP creds exist)
- [ ] Fail the pipeline on any config validation error
- **Done when:** a PR that breaks a rule/test/expectation cannot merge.

## 3. Effective-dated nomenclature ⏱ medium
Regulators revise code lists; resubmissions must reproduce the codes
that were valid on the original report date.
- [ ] Add `valid_from` / `valid_to` to sport code maps (config shape:
      versioned entries per market) and to alias rows if needed
- [ ] `map_sport_regulator` becomes effective-dated; submission join
      picks the mapping row valid on `report_date`
- [ ] Validator: no gaps/overlaps in date ranges per (market, canonical)
- [ ] Tests + an expectation with a code that changes mid-seed-data
- **Done when:** two report dates straddling a code change produce
  different regulator codes for the same canonical sport, offline.

## 4. Extend nomenclature to competitions and bet/market types ⏱ medium
> Progress: the GAMING domain (July 2026) proved the pattern generalises —
> game types now flow through canonical + aliases + per-market codes +
> policy + queue exactly like sports. Competitions/bet-types remain.
Same pattern as sports (canonical + aliases + per-market codes + policy).
- [ ] `canonical.js`: competitions, betTypes taxonomies
- [ ] Alias tables + unmapped queues for each (generalise the queue
      builder rather than copy it)
- [ ] Per-market code maps + policies in `jurisdictions.js`
- [ ] Seed rows exercising mapped/unmapped paths; expectations
- **Done when:** ES file carries a DGOJ competition code end-to-end
  offline, and an unmapped competition appears in its queue.

## 5. Port the reconciliation layer ⏱ medium
From companion `dataform-starter` repo (`includes/recon.js`,
`definitions/40_recon/`).
- [ ] Adapt the three-level legacy diff generators (totals / rows /
      fields) to this repo's tables and dialect layer
- [ ] Permanent internal recon: submitted vs submission_ready
      (needs a mock `submission_receipts` in seed data)
- [ ] Offline demo: a mock "legacy" table with one deliberately wrong
      row → recon break surfaces; expectation asserts the break
- **Done when:** `npm run local` shows a seeded legacy discrepancy
  caught at the correct level with the correct break_type.

## 6. Submission service ⏱ medium
Skeleton exists in `dataform-starter/submission-service/`.
- [ ] Generic engine reads `submission_ready_{mkt}` for a report_date,
      delegates to per-market adapter, writes `submission_receipts`
- [ ] MT + ES adapters (SOAP envelope quirks only, ~50 lines each)
- [ ] Local test: adapter builds envelope from DuckDB rows; XML snapshot
      test (no network needed)
- **Done when:** envelope generation is unit-tested offline; Cloud Run
  deployment deferred to item 8.

## 7. Scale toward the real 17 markets ⏱ large, incremental
- [ ] Inventory each real market's requirements into the config shape
      (fields, rules with regulator clause ids, nomenclature, policies)
- [ ] Where a market genuinely can't be config (e.g. a monthly file with
      a different grain), use the override pattern: small dedicated
      builder + `customSubmission: true`
- [ ] Watch for pressure on the abstraction — new rule types and field
      expressions are expected; new `if (market === ...)` branches are a
      design smell to resolve in config instead
- **Done when:** each added market lands as (mostly) one config entry
  with its own expectations in the offline harness.

## 8. GCP deployment ⏱ medium
- [ ] Point `workflow_settings.yaml` at the project; run
      `seed/bigquery_setup.sql`; execute in Dataform; verify README
      expected results match BigQuery output
- [ ] Datastream CDC from the real SQL Server into `cdc_landing`
      (replaces seed data; models unchanged)
- [ ] Cloud Workflows/Scheduler per market cadence via tags
- [ ] Wire `dataform compile` into CI (item 2)
- **Done when:** MT + ES run on schedule in GCP from CDC data with all
  rule assertions green.

## 9. Parallel-run & cutover (first real market) ⏱ large
Follow `MIGRATION-GUIDE.md` (companion repo).
- [ ] Land actual legacy submission outputs into BigQuery
- [ ] Run recon diffs daily; classify every break (new-pipeline bug vs
      faithfully-unreproduced legacy bug — the latter is a compliance
      decision, keep a signed-off breaks log)
- [ ] Cutover criteria: ~30 clean daily cycles + one clean month-end
- **Done when:** first market submits from the new pipeline with legacy
  running silently as fallback, then decommissioned.

## Ideas / backlog (unordered)
- Player protection follow-ons: Spain's draft JOINT cross-operator
  deposit limits (700/1750/3300 over 4 weeks, DGOJ centralised
  monitoring — will need a cross-operator feed), limit-increase
  cooling-off enforcement (decrease immediate, increase delayed),
  RD 176/2023 risk-behaviour detection signals, session/time limits,
  reality checks, player funds segregation reporting (MGA monthly
  Player Funds Report)
- Provider layer follow-ons: multi-currency feeds (FX at round time),
  free-spin/bonus-round handling per provider (zero-stake rounds),
  provider statement ingestion via SFTP/API, jackpot network statements
  reconciled against fct_jackpot_liability
- Generalise the unmapped queue into one parameterised builder over
  {sports, competitions, betTypes, participants}
- Confidence-scored fuzzy matching to *propose* alias entries for the
  queue (proposals only — a human/CI-tested PR remains the merge gate)
- `slips_affected`-weighted alerting when a queue entry exceeds a
  threshold (unmapped sport taking real money = urgent)
- Late-event handling policy per market (event arrives after its
  report_date was submitted → correction file vs next-file inclusion)
- DST transition test dates per market timezone in expectations
- Currency conversion layer for markets reporting in non-EUR
- Per-market IAM automation for the dataset-per-jurisdiction isolation
