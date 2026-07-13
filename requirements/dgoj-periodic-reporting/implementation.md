# DGOJ periodic reporting — implementation

*Step-by-step record of how [requirements.md](requirements.md) was
implemented, following [`how-to.md`](../../how-to.md) § 6. Every change
site carries a grep-able `REQ: requirements/dgoj-periodic-reporting`
comment.*

## Part A — the pipeline (`dataform-example/`)

**A1. Config (REQ-DGOJ-1/2/4).** `includes/jurisdictions.js`: a new
`periodicReports` list on the ES market — two registers (`RUD` daily,
`RUT` monthly), each naming its cadence, player identification
(`playerField: "player_dni_hash"`, reusing the betting field registry),
measures, and declarative rules (SHA-256 format on `player_ref`,
non-negative stakes). Also `commonPeriodicRules` (not_null `player_ref` /
`period_start`) exported alongside `commonRules`/`commonGamingRules`.

**A2. Periodic field registry.** `includes/fields.js`: a third registry,
`periodicRegistry` — **aggregate-grained** (`bets_settled`, `stake_sum`,
`winnings_sum`, `ggr_sum`), all additive (SUM/COUNT) because the
completeness check rolls dailies up with SUM. The existing row-level
registries are untouched.

**A3. Validator (REQ-DGOJ-4).** `includes/validate.js`: `periodicReports`
checks — non-empty array, alphanumeric unique ids (they name tables),
cadence ∈ {daily, monthly}, `playerField` in the betting registry, fields
in the periodic registry, register rules validated against the register's
own columns, and a daily+monthly pair must share `playerField` (the
completeness join is on `player_ref`).

**A4. Query builders.** `includes/queries.js`:
- `periodicReportQuery(ctx, j, report)` — one builder for all markets and
  both cadences: groups settled activity by player + period, where the
  period is the local report date (daily) or `dateTrunc('month', …)` of it
  (monthly, via `dialect.js`). The standard admissibility filter applies,
  so quarantined/held/incomplete entities never reach a register.
- `periodicCompletenessQuery(ctx, j, daily, monthly)` (REQ-DGOJ-3) — FULL
  OUTER JOIN of the monthly register against the dailies rolled up per
  player-month; any total mismatch (tolerance 0.005) or one-sided
  player-month is a violation.

**A5. Rule engine generalisation.** `includes/rules.js`: `std()` and the
column-rule types accept a `dateColumn` (default `report_date`) so the
same declarative rules assert over register tables, whose period column
is `period_start`. `periodicRules(report, commonPeriodicRules)` merges
common + per-register rules. Existing event-file assertions are
byte-for-byte unchanged (proven by test).

**A6. Wiring (the one manual definitions step).**
- `definitions/30_submissions/periodic.js` — fan-out: one
  `submission_<register>_<mkt>` table per register per market, tagged
  with its cadence for the scheduler; today that is `submission_rud_es` +
  `submission_rut_es`, nothing for the other six markets.
- `definitions/90_assertions/periodic_assertions.js` — one assertion per
  register rule (named `periodic_rule_<mkt>_<register>_<ruleid>`) plus
  `periodic_completeness_<mkt>` for markets filing both cadences.
- `local/run.js` — the same tables/assertions mirrored into `buildPlan()`,
  plus `periodicNegativeTests()`: inflating every RUD `stake_sum` by 5 in
  a corrupt copy must make the completeness gate fire.

**A7. Seed + expectations.** `seed/data.js`: one new ES slip **S14**
(A2001, placed 2026-07-08 22:30 UTC, settled as a loss on the next Madrid
local day, 2026-07-09) so the July RUT genuinely totalises across two RUD
days; the ES `bet_settlement` watermark moved to 2026-07-10 so the new
settlement day is a *closed* period (readiness is fail-closed).
`local/expectations.js`: two new expectations pin the RUD rows
(07-08: 1 bet / 50 / 40 / 10 and 07-09: 1 bet / 10 / 0 / 10) and the RUT
row (2 bets / 60 / 40 / 20, `player_ref` 64 hex chars); three existing
expectations updated for the extra slip (19 slips, ES file = S4+S14).
`seed/bigquery_setup.sql` regenerated via `npm run seed:generate`.

**A8. Tests.** `test/periodic.test.js` — 16 tests over the query builder
(grouping, dialect month-trunc, settled-only, admissibility, DNI hash,
unknown-field throw), the completeness SQL, register rule targeting, the
unchanged default for event files, and every new validator rejection.

## Part B — the demo stack (`dataform-website/`)

**B1. SAFE (REQ-DGOJ-5).** `safe.py`: `RECORD_TYPES` gains `rud` and
`rut` — endpoints, WSDL, folders and the status page expand automatically
(7×6 = 42 endpoints). Header comment and `dataform-safe/README.md`
brought up to date (they also predated DE and `gaming`).

**B2. Submission engine.** `submission.py`: `PERIODIC_REPORTS` config
(mirrors the pipeline's `periodicReports`; ES → RUD daily, RUT monthly);
`PERIODIC_SQL` totalising each player's settled bets in a [start, end)
window; `submit_periodic()` builds one canonical filing (register id,
cadence, period, one row per pseudonymised player with BetsSettled /
StakeSum / WinningsSum / GgrSum), hands it to
`regulator_formats/` for serialisation — for ES a single DGOJ `<Lote>`
in the monitoring-system 3.3 format (RUD filings pair a `RegistroRUD`
with a `RegistroCJD Diaria` carrying the per-player money; RUT filings a
`RegistroRUT` totals record with a `RegistroCJD Mensual`) — and SOAPs
the batch to `/safe/<MKT>/<register>`; `_log_replace()` (INSERT OR
REPLACE) so a re-filed register supersedes the previous receipt.
Registers are filed **on demand**, not by the polling loop.

**B3. Admin trigger (REQ-DGOJ-5).** `app.py`: `GET /admin/periodic`
(form + filed-registers table) and `POST /admin/periodic/generate`
(market, cadence, day/month → `submit_periodic`, receipts flashed);
`templates/admin/periodic.html`; a "Periodic reports →" link on the admin
dashboard.

## As implemented — requirement → artifact trace

| Requirement | Implemented by | Proven by |
|---|---|---|
| REQ-DGOJ-1 daily register | ES `periodicReports[RUD]` + `periodicReportQuery` + `submission_rud_es` | expectation "ES RUD (daily register…)"; `test/periodic.test.js` grouping tests |
| REQ-DGOJ-2 monthly register | ES `periodicReports[RUT]` + dialect month-trunc + `submission_rut_es` | expectation "ES RUT (monthly register…)"; month-trunc test |
| REQ-DGOJ-3 monthly = Σ daily | `periodicCompletenessQuery` + `periodic_completeness_es` assertion (Dataform + offline) | negative test "inflated RUD dailies no longer sum to the RUT month"; completeness SQL tests |
| REQ-DGOJ-4 variance as data | `periodicReports` config + validator + generic builders; no market branch anywhere | `test/periodic.test.js` validator tests; `test/validate.test.js` (real config clean); emit-sql diff shows only ES files added |
| REQ-DGOJ-5 on-demand trigger | `safe.py` RECORD_TYPES, `submission.submit_periodic`, `/admin/periodic` | live E2E: registered ES player → bet → settle → trigger → XML in `dataform-safe/ES/rud/` + `/rut/` with receipts |

**Definition of done:** `npm run check` green — 135 unit tests, 68 models,
96 assertions (8 periodic rules + 1 completeness added), all expectations
and 15 negative tests passing in the offline DuckDB harness; demo loop
verified end-to-end against the running site and SAFE.
