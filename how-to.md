# How-To — Making Real Changes to This Platform

*This is the first place to go when you have been asked to change
something. It explains what every artifact in the repo is, gives the
universal workflow that every change follows, and then walks through
four worked use cases step by step: a new reported field, a new gaming
product, new periodic reporting for Spain (DGOJ), and a brand-new
jurisdiction. No prior knowledge of the codebase is assumed — only
that you have read [`README_FIRST.md`](README_FIRST.md) once.*

---

## 1. The one idea everything depends on

> **Market variance is DATA. Business logic exists exactly ONCE.**

Everything a market does *differently* (tax rate, reported columns,
void handling, regulator codes, rules) is **configuration** in one
file: `dataform-example/includes/jurisdictions.js`. Everything markets
do *the same* (the SQL that builds files, computes tax, enforces
rules) is written **once**, as small functions that read that config.

The practical consequence for you: **most changes are edits to
configuration, not new code.** The generated SQL updates itself,
because every downstream layer loops over the config. If you find
yourself writing `if (market === 'ES')` anywhere outside
`jurisdictions.js`, stop — you are doing it wrong.

---

## 2. The map — what the artifacts are

The repo has three groups of artifacts: **the pipeline** (the real
deliverable), **the live demo stack** (a fictitious operator +
regulator that proves the pipeline end to end), and **docs /
scenarios** around them.

### 2.1 The pipeline — `dataform-example/`

This is the config-driven reporting engine. It targets BigQuery
(Dataform) in production and runs identically in DuckDB on your
laptop in seconds.

| Artifact | What it is | You touch it when… |
|---|---|---|
| `includes/jurisdictions.js` | **The single source of truth.** One config object per market: tax, cadence, reported fields, regulator codes, rules, player protection. | Almost every change. |
| `includes/fields.js` | Registry of every reportable column: `name → SQL expression`. | A new field must be reported. |
| `includes/extensions.js` | Per-market bespoke attributes (a datum only one regulator wants), carried or computed — without widening any shared table. | One market needs a field nobody else has. |
| `includes/rules.js` | The rule engine: rule *types* (`not_null`, `zero_when`, `in_set` …) that compile a declarative rule into a pipeline-blocking check. | A genuinely new *kind* of check is needed (rare — rule *instances* go in `jurisdictions.js`). |
| `includes/nomenclature/` | `canonical.js` (internal taxonomy), `aliases.js` (dirty feed name → canonical), `mapping.js` (the machinery). | A feed value is unmapped, or a new sport/game type exists. |
| `includes/models.js` | The staging/core/gaming SQL builders (bet lifecycle, gaming activity union, etc.). | A genuinely new table or product vertical is needed. |
| `includes/queries.js` | Composes fields + filters + tax into the final submission/tax queries. | A new *kind* of report file is needed. |
| `includes/providers.js` | Casino feed adapter registry — one entry normalises one provider's feed. | A new game provider is onboarded. |
| `includes/player_protection.js` | Limits, exclusions, KYC and the six `rg_breach_*` detectors. | Player-protection logic changes. |
| `includes/exceptions.js` | Quarantine-first fault isolation, readiness, retry state machine. | Exception routing changes (rare). |
| `includes/validate.js` | The config pre-flight gate — invalid config **fails to compile**. | You add a new config property (teach the validator about it). |
| `includes/dialect.js` | The only engine-specific SQL (BigQuery vs DuckDB), each construct implemented twice. | You need an SQL construct the two engines spell differently. |
| `definitions/**` | Dataform wiring only — **no SQL lives here**. Each layer loops over the config, so it regenerates automatically. | Only when adding a genuinely **new table/model**. |
| `local/run.js` | The offline DuckDB runner. Its `buildPlan()` mirrors `definitions/` by hand. | Whenever you add a new table to `definitions/` — add it here too. |
| `seed/data.js` | The single source of demo/seed data for both engines. | You need rows to prove your change offline. |
| `local/expectations.js` | Integration expectations the offline run must satisfy. | You want your change *proven*, not just compiled. |
| `test/` | ~119 unit tests, one file per include area. | Every change (see the workflow below). |

**The layer flow** (config flows down, never up):

```
jurisdictions.js ──► fields / filters / rules / extensions / queries
                          │
                          ▼
     definitions/00_sources → 10_staging → 15_reference → 20_core
        → 25_gaming → 30_submissions → 35_player_protection
        → 40_exceptions → 90_assertions
```

Because layers 15/25/30/35/40/90 **loop over the jurisdictions and
their `reportFields`/`rules`**, adding a market, field, rule or
extension in `includes/` regenerates everything with **zero edits to
`definitions/`**.

### 2.2 The live demo stack (repo root)

A complete, fictitious, single-user world that lets you *click* a bet
and watch it arrive at a regulator. See [`readme-web.md`](readme-web.md).

| Artifact | What it is | You touch it when… |
|---|---|---|
| `dataform-website/` | **BetNova** — a Flask + DuckDB gaming site playing the role of the operator OLTP. `engine.py` holds the market config dicts; `db.py` the schema (tables mirror the pipeline's CDC landing tables). | You want the demo to exercise your change. |
| `dataform-website/submission.py` | The near-realtime submission engine: polls the DB every 3 s and SOAPs each newly-reportable record to the SAFE. One `PENDING_*_SQL` + `submit_pending_*` per record type. | A new record type or market must be *submitted*. |
| `dataform-website/safe.py` | The fictitious regulator **SAFE** — one SOAP endpoint per jurisdiction per record type (`POST /safe/<MKT>/<type>`), storing each accepted record as XML. | A new jurisdiction or record type must be *received*. |
| `dataform-safe/` | Where the SAFE writes accepted records (XML, gitignored). | Never edited — you *read* it to verify submissions. |
| `dataform-website/reconciliation.py` → `dataform-reconciliation/` | Daily/monthly financial reconciliation PDFs per jurisdiction (cash vs settlement GGR, three-way completeness, GGR duty). | Your change affects money or reported completeness. |

### 2.3 Docs, scenarios and generated output

| Artifact | What it is |
|---|---|
| `README_FIRST.md` → `OVERVIEW.md` → `dataform-example/ARCHITECTURE.md` → `dataform-example/CLAUDE.md` | The reading path: map → why → how → maintainer contract. |
| `requirements/<name>/` | **Worked change scenarios with full traceability** — the pattern *your* change should follow (see §3, step 1). Existing: `max-stake-limits`, `golden-chips`, `operator-jackpots`. |
| `dataform-sql/` | Generated SQL written out to *read* (`npm run emit-sql`). Never edit it; never treat it as source. |
| `dataform-starter/` | The scaffold/plan for the full 17-market production migration (CDC, parallel-run, cutover). Not part of day-to-day changes. |

---

## 3. The universal workflow — every change, same seven steps

Whatever the change, the loop is identical. Run all commands from
`dataform-example/` unless stated otherwise.

1. **Write it down first.** Create `requirements/<change-name>/` at
   the repo root with three files, copying the shape of
   `requirements/golden-chips/`:
   - `requirements.md` — numbered requirements `REQ-<PREFIX>-1…n`
     with acceptance criteria and out-of-scope;
   - `overview.md` — a "where it lands" table (which layer each
     concern belongs to, and why);
   - `implementation.md` — the step-by-step you are about to do,
     ending with a *requirement → artifact → proven-by* trace table.

   Tag every code change site with a grep-able comment:
   `REQ: requirements/<change-name> (REQ-XX-n)`.

2. **Edit config first, code second.** Try to express the change as
   data in `jurisdictions.js` (or `fields.js` / `extensions.js` /
   `aliases.js`). Only write new SQL-building code if no existing
   mechanism fits.

3. **Seed the proof.** Add rows to `seed/data.js` that exercise the
   change, and expected outcomes to `local/expectations.js`. Adding rows
   often changes counts that *existing* expectations pin (e.g. "N slips")
   — update those in the same commit. After any `seed/data.js` change run
   `npm run seed:generate` (it regenerates `seed/bigquery_setup.sql` and
   is **not** part of `npm run check`).
   ⚠️ *A new market needs a `cdc_source_watermarks` row — without it, the
   market sits in `WAITING_DATA` and reports nothing. Likewise, a new
   settlement on a **later day** needs the watermark moved past that day,
   or readiness (fail-closed) quietly excludes the row.*

4. **`npm test`** — unit tests over every generator (~2 s). The
   validator test fails immediately if your config is malformed.

5. **`npm run local`** — the *entire* pipeline in DuckDB: every
   model, every rule assertion, integration expectations, and
   negative tests that corrupt data on purpose to prove the
   guardrails bite. **Green here is the definition of done.**
   (`npm run check` = test + demo + local + emit-sql in one go.)

6. **See the blast radius.** `npm run emit-sql` and diff
   `dataform-sql/` — you can see exactly which generated files your
   change moved. (`npm run dataform:compile` does the same check with
   the genuine Dataform CLI; needs network.)

7. **Demo it (when relevant).** From the repo root:
   `.venv\Scripts\python dataform-website\app.py`, click through the
   flow, and check the record lands as XML under `dataform-safe/`.
   Then commit — one commit per requirement where practical, with the
   REQ id in the message.

---

## 4. Use case 1 — a regulator wants a new field reported

*Example: the Maltese regulator now wants each bet record to carry
the settlement channel (web / mobile / retail).*

**First, answer one question:** is the field…

- **(A) derivable from data every market already has** (a column on
  the lifecycle, account or fixture)? → it's a **field registry**
  change; or
- **(B) a datum only this market has/wants** (e.g. a national
  registration number)? → it's an **extension**, so the shared model
  is never widened for one market's quirk.

### Path A — a normal field (2 files)

1. **Define the expression once** in
   `dataform-example/includes/fields.js`: add one entry to the
   registry, `settlement_channel: (j) => "b.channel"` (aliases:
   `b` = bet lifecycle, `a` = account, `f` = fixture). If the SQL
   differs by engine, put the construct in `dialect.js`, not here.
2. **Opt the market in** — add `"settlement_channel"` to the MT
   `reportFields` array in `includes/jurisdictions.js`, in the
   position the regulator's file spec requires (order = file column
   order).
3. If the regulator constrains the value, **add a rule instance** to
   MT's `rules` array in the same file, quoting the clause:
   `{ id: "MT-1xx", type: "in_set", column: "settlement_channel",
   values: [...], description: "Directive …" }`.
4. If the source column is new, add it to the CDC seed rows in
   `seed/data.js` and to the staging builder in `models.js`.
5. Run the workflow (§3, steps 4–6). An unknown field name **throws
   at compile time**, so a typo cannot ship.

### Path B — a market-specific field (extension)

1. **Register the attribute** in `includes/extensions.js` — either
   *carrier-sourced* (`{ entity: 'SLIP', carrier: true }`, the value
   rides in on `cdc_reg_attributes`) or *computed*
   (`{ sql: (j) => "<expression>" }`). Bulgaria's
   `nra_registration_id` (carrier) and Greece's
   `winnings_withholding_tax` (computed) are the two worked templates.
2. **Opt the market in**: add the name to that market's
   `extensions: [...]` in `jurisdictions.js`.
3. If carrier-sourced, add `cdc_reg_attributes` rows to
   `seed/data.js` so the offline run proves it.
4. Rules can target the extension column exactly like any file
   column — add one to the market's `rules` if the regulator
   constrains it.

### Don't forget the demo (optional but recommended)

To see the field on the wire: add the field to the canonical dict in
the relevant `dataform-website/submission.py` builder (e.g.
`submit_pending_bets`), map it in `dataform-website/regulator_formats/`
(the generic `<Record>` shape for MT/BG/DE picks up listed fields;
DK/ES/GR/NL each need the element the regulator's schema names for it),
restart the app, place a bet, and read the XML in
`dataform-safe/MT/bets/`.

**Done when:** `npm run check` is green, the emitted
`submission_ready_mt` SQL shows the new column, and (if demoed) the
SAFE XML carries it. Precedent to copy:
[`requirements/max-stake-limits/`](requirements/max-stake-limits/overview.md).

---

## 5. Use case 2 — a new gaming product is launched

*Example: the business launches **bingo** in Malta and Spain.*

A product is a **vertical**: one arm of the `UNION ALL` in
`fctGamingActivity` (`includes/models.js`), normalised to the common
shape `(activity_id, account_id, game_id, vertical, stake, payout,
rake_or_fee, jackpot_contribution, …)`. The worked precedents are
`requirements/golden-chips/` and `requirements/operator-jackpots/`
(read both before starting — the operator-jackpots "phantom game"
pattern is the template for anything that must correlate to a
licensed vertical).

**Steps, in dependency order:**

1. **Taxonomy** — add the canonical game type in
   `includes/nomenclature/canonical.js` (e.g. `BING: "Bingo"`).
2. **Feed names** — add the provider labels that mean bingo to
   `gameTypeAliases` in `includes/nomenclature/aliases.js`.
3. **Regulator codes** — in `includes/jurisdictions.js`, add the
   regulator's bingo code to `gamingNomenclature.gameCodes` for MT
   and ES. (In a `block`-policy market like ES, a game type without a
   code is *unlicensed* and the `no_unlicensed_games` rule blocks it —
   that is the licensing control working as designed.)
4. **The data lane** — in `includes/models.js`: a staging builder for
   the new feed (if it isn't just rounds from an existing provider in
   `providers.js` — a new provider is one registry entry there), and
   a new `UNION ALL` arm in `fctGamingActivity` setting
   stake/payout/rake correctly. Respect the vertical invariants
   asserted in `definitions/25_gaming/gaming.js` (e.g.
   `rake_or_fee = 0` unless the vertical genuinely charges rake).
5. **Revenue mechanics** — add the vertical's GGR arm to the
   `gaming_ggr` CASE in `includes/fields.js` **and** mirror it in
   `gamingTaxSummaryQuery` in `includes/queries.js` (the CASE is
   intentionally duplicated in both places — change both).
6. **Wiring (new tables only)** — declare any new CDC feed in
   `definitions/00_sources/sources.js`, publish new staging in
   `definitions/10_staging/staging.js`, and add both to
   `local/run.js` `buildPlan()`. (The per-market gaming submission
   files regenerate automatically — no edits in `25_gaming`.)
7. **Rules** — add any bingo-specific regulatory rules to each
   market's `gamingRules` in `jurisdictions.js`.
8. **Proof** — seed rounds in `seed/data.js`, expectations in
   `local/expectations.js`, unit tests in `test/gaming.test.js`, then
   the §3 workflow.
9. **Demo site (optional)** — add the game to `GAME_TYPE_CODES` and a
   game module in `dataform-website/engine.py`, a route + template in
   `app.py`; it is then reported automatically via
   `submit_pending_gaming` and received by the SAFE's existing
   `gaming` endpoint.

**Done when:** `npm run check` is green including the negative tests,
`gaming_submission_ready_mt`/`_es` contain bingo rows with correct
GGR, and a betting-only market (e.g. DK) is provably unaffected
(its emitted SQL did not change).

---

## 6. Use case 3 — new periodic reporting for Spain (DGOJ daily + monthly)

*Scenario: Spain's DGOJ requires reporting under its monitoring-system
data model, where record types have different periodicities — e.g. a
detailed daily register (like the RUD) and a totalized monthly
register (like the RUT). See the DGOJ Resolution of 6 June 2024
approving the Modelo de datos del sistema de monitorización
([BOE-A-2024-12639](https://www.boe.es/buscar/doc.php?id=BOE-A-2024-12639)),
mandatory since March 2025.*

This is the most involved use case because it introduces a **new kind
of report file**, not just new content — and that is the one change
where you write a new query builder and new wiring.

> **This use case has been implemented** — the mechanism below now
> exists in the codebase, and
> [`requirements/dgoj-periodic-reporting/`](requirements/dgoj-periodic-reporting/requirements.md)
> is the worked precedent (its `implementation.md` records every file
> touched). Read these steps as "how it was done and how you extend it":
> adding a register to another market is now **config only** (step 2);
> the code steps (3–7) only apply when you build a further new report
> *kind*.

**First, understand how periodicity works here.** Reporting is
*terminal-state driven*: a slip enters a period's file via
`report_date = localDate(COALESCE(settled_at, voided_at))`
(`includes/filters.js`). The existing `submissionCadence:
"daily"|"monthly"` on each market is currently a *scheduling tag*,
not different SQL. A daily register is therefore "group by
`report_date`"; a monthly register is "group by
`dateTrunc('month', report_date)`" — with `dateTrunc` coming from
`includes/dialect.js` so it runs on both engines.

**Steps:**

1. **Requirements first** — `requirements/dgoj-periodic-reporting/`
   with e.g. `REQ-DGOJ-1` (daily detailed register), `REQ-DGOJ-2`
   (monthly totalized register), `REQ-DGOJ-3` (completeness:
   monthly totals must equal the sum of the dailies), each citing the
   DGOJ model / BOE resolution.
2. **Make it config, not Spain-code.** Add a new property to the ES
   entry in `includes/jurisdictions.js` — for example:

   ```js
   periodicReports: [
     { id: "RUD", cadence: "daily",   fields: [ ... ] },
     { id: "RUT", cadence: "monthly", fields: [ ... ] },
   ],
   ```

   This keeps the platform rule intact: any future market with
   periodic registers is *config*, not new code. (Names above are
   illustrative — take the real record layouts from the DGOJ model.)
3. **Teach the validator** — extend `includes/validate.js` to check
   the new property (cadence ∈ {daily, monthly}, every field name
   known, ids unique). Invalid config must fail to compile, like
   everything else.
4. **Field expressions** — registers are **aggregate-grained** (one row
   per player per period), so their measures live in their own registry
   in `includes/fields.js` (`periodicRegistry`: `bets_settled`,
   `stake_sum`, `winnings_sum`, `ggr_sum`, …), separate from the
   row-level betting/gaming registries. Keep every entry **additive**
   (SUM/COUNT) — that is what makes the daily→monthly roll-up provable.
   `playerField`, by contrast, reuses the ordinary betting registry so a
   register identifies players exactly as the market's event file does.
5. **One new builder** — `periodicReportQuery(ctx, j, report)` in
   `includes/queries.js`: select the report's fields, apply the
   standard admissibility filter (from `exceptions.js` — quarantined
   entities must stay excluded), and group by player + `report_date`
   (daily) or `dateTrunc('month', …)` (monthly). Its companion
   `periodicCompletenessQuery` FULL-OUTER-JOINs the monthly register
   against the SUM-rolled dailies — any mismatch is a violation.
6. **New wiring** — `definitions/30_submissions/periodic.js` loops
   **all** markets and publishes `submission_<reportid>_<mkt>` for each
   entry in `periodicReports` — today that yields `submission_rud_es`
   (daily) and `submission_rut_es` (monthly), tagged with their cadence
   for the scheduler. `definitions/90_assertions/periodic_assertions.js`
   generates the per-register rule assertions (the engine's
   `violationQuery` takes `{table, keyColumn, dateColumn}` — registers
   pass `period_start` as the date column) plus the completeness
   assertion for any market filing both cadences.
7. **Mirror offline** — add the new models to `local/run.js`
   `buildPlan()` (new tables are the one case where this manual step
   exists), seed ES rows in `seed/data.js` **on more than one day of
   the same month** (or the monthly roll-up proves nothing), and add
   expectations. Re-read the §3 seed warnings: watermark coverage for
   any new settlement day, existing expectation counts, and
   `npm run seed:generate`.
8. **Rules** — add DGOJ constraints on the register columns as
   declarative rules on each register entry in the ES config, ids =
   the regulator's clause references, so every constraint is a named,
   testable object (`ES-RUD-101` etc.).
9. **Demo the loop (optional)** — in `dataform-website/`: append the
   new record types to `RECORD_TYPES` in `safe.py` (the SAFE's
   endpoints, folders and status page expand automatically) and add a
   `PERIODIC_REPORTS` entry + `submit_periodic()` in `submission.py`.
   Periodic registers are filed **on demand** from *Admin → Periodic
   reports* (pick market, cadence, day/month — receipts are flashed and
   listed), so a demo never waits for a period to close. Daily/monthly
   PDF sections can be added in `reconciliation.py` if finance needs to
   reconcile the registers.

**Done when:** `npm run check` is green; the emitted SQL contains the
daily and monthly ES register models and *no other market changed*;
the completeness assertion fails when you deliberately corrupt a
daily row (negative test) and passes otherwise.

---

## 7. Use case 4 — adding a completely new jurisdiction

*Example: the business enters **Sweden** (Spelinspektionen).*

This is the headline capability: in the pipeline, **a new market is
one configuration object**. Everything — its submission files, tax
summary, reference maps, rule assertions, player-protection coverage,
exception isolation — fans out from that entry automatically.

**Steps:**

1. **Research → requirements.** Create `requirements/market-se/`
   capturing, with citations: tax model and rate, filing cadence,
   void treatment, player identifier scheme (and whether it must be
   hashed), sport/game code lists (closed or open), national
   self-exclusion register, deposit/stake limit law, and any bespoke
   data the regulator wants. (This research *is* the work; the
   implementation is minutes.)
2. **Write the config object.** Add `SE` to
   `includes/jurisdictions.js`, copying the closest existing market
   as a starting point (DK for a monthly betting-only market; ES for
   daily + closed code lists; MT/ES if it runs gaming). Fill in:
   - identity: `code`, `dataset`, `currency`, `rounding`, `timezone`,
     `addressValidation` (postcode pattern);
   - reporting: `submissionCadence`, `includeVoided`, `reportFields`
     (every name must exist in `fields.js`), `extensions` (register
     any genuinely new bespoke attribute in `extensions.js` first);
   - tax: `taxModel` (`"ggr"` or `"turnover"`) and `taxRate`
     (a constant, or an effective-dated schedule if a rate change is
     coming);
   - codes: `nomenclature.sportCodes` mapping each canonical sport to
     the regulator's code, with `unmappedPolicy` `"default"` or
     `"block"` (+ the enforcing rule if `"block"` — the validator
     insists);
   - `rules`: the market's regulatory constraints, one declarative
     entry per legal clause, `id` = the clause reference;
   - `playerProtection`: statutory deposit-limit defaults (or null),
     `selfExclusionSources` (+ `mandatoryRegister` if national),
     `withdrawalRequiresVerification`, any `slotsStakeLimits`;
   - gaming block (`gamingNomenclature`, `gamingTaxRate`,
     `gamingReportFields`, `gamingRules`) **only if** the market runs
     gaming — betting-only markets simply omit it and no gaming
     tables materialise.
3. **Seed the proof.** In `seed/data.js`: at least one SE account,
   address, fixtures/slips/events, payments — and the
   `cdc_source_watermarks` row. ⚠️ **Forgetting the watermark is the
   classic mistake: the market compiles fine but sits in
   `WAITING_DATA` and reports nothing** (this bit the DE onboarding).
   Add carrier rows in `cdc_reg_attributes` for any carrier
   extensions. Add SE expectations to `local/expectations.js`.
4. **Run the workflow** (§3). `test/validate.test.js` gates the
   config; `npm run local` proves `submission_ready_se`,
   `tax_summary_se` and every `rule_se_*` assertion; the emit-sql
   diff should show *only added* files — nothing existing changed.
5. **Extend the demo stack** so SE is clickable end to end
   (the demo intentionally keeps its config in a few small dicts —
   this is five small edits, all data):
   - `dataform-website/engine.py` — `JURISDICTIONS` entry (name +
     postcode hint), plus `SLOTS_STAKE_LIMITS` if applicable;
   - `dataform-website/submission.py` — `MARKETS` entry
     (`include_voided`, `hashed_ref`);
   - `dataform-website/safe.py` — append `"SE"` to `JURISDICTIONS`
     (endpoints, WSDL, folders and status page expand automatically);
   - `dataform-website/reconciliation.py` — `TAX_RATES`, `TAX_BASIS`,
     `BONUS_STAKE_POLICY` entries;
   - the registration template, if market options are listed there.
6. **Verify end to end.** Reset and run the site
   (`python dataform-website\reset_db.py`, then run `app.py`),
   register a Swedish player, deposit, bet, settle — then confirm the
   XML lands under `dataform-safe/SE/` and the reconciliation PDF for
   SE reconciles to zero.

**Done when:** validator clean, `npm run check` green, emitted SQL
shows only additions, the demo round-trips a Swedish bet into
`dataform-safe/SE/bets/`, and `requirements/market-se/implementation.md`
ends with the filled-in requirement → artifact → proven-by table.

---

## 8. Quick reference — "I need to change X, where do I go?"

| Change | Where it lands | Anything else? |
|---|---|---|
| New reported field (shared) | `fields.js` + market's `reportFields` | seed/staging if the source column is new |
| Field only one market wants | `extensions.js` + market's `extensions` | carrier seed rows |
| New regulatory rule (instance) | one entry in the market's `rules`/`gamingRules` | negative test |
| New *kind* of rule check | `rules.js` `RULE_TYPES` + `test/rules.test.js` | — |
| Regulator code / tax rate change | the value in `jurisdictions.js` (effective-dated schedule if dated) | — |
| Unmapped feed value | one line in `nomenclature/aliases.js` | — |
| New game provider feed | one entry in `providers.js` | source decl + seed |
| New product / vertical | §5 — canonical + aliases + codes + `models.js` arm + GGR arms | sources/staging + `local/run.js` |
| Periodic register for a market (mechanism exists) | `periodicReports` on the market in `jurisdictions.js` | seed + expectations |
| New *kind* of report file | §6 — config property + `queries.js` builder + new definitions loop | validator + `local/run.js` |
| New jurisdiction | §7 — one `jurisdictions.js` object | seed + watermark + demo dicts |
| Engine-specific SQL | `dialect.js` only (both engines + test) | — |

**Golden rules (the maintainer contract — full version in
`dataform-example/CLAUDE.md`):**

- No `if (market === …)` outside `jurisdictions.js`. Ever.
- `definitions/` and `local/run.js` change **only** for genuinely new
  tables — and always both together.
- Every regulatory constraint is a declarative rule with an `id`
  quoting the legal clause. Rules block the pipeline; that is the
  point.
- Generated output (`dataform-sql/`, `seed/bigquery_setup.sql`) is
  never edited by hand.
- Where a code comment and a README disagree with the code, **the
  code and its tests are authoritative** — fix the doc in the same
  commit.
- Green `npm run check` is the definition of done. No exceptions
  under deadline — it takes seconds.

**Where to go deeper:** `dataform-example/ARCHITECTURE.md` (design),
`dataform-example/CLAUDE.md` (contract),
[`readme-web.md`](readme-web.md) (demo stack),
[`financial-reconciliations.md`](financial-reconciliations.md)
(reconciliation methodology), and the three worked scenarios under
[`requirements/`](requirements/max-stake-limits/overview.md).
