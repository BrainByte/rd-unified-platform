# DGOJ periodic reporting — overview

*Companion to [requirements.md](requirements.md) (the ask) and
[implementation.md](implementation.md) (the step-by-step). This scenario is
the worked example behind [`how-to.md`](../../how-to.md) § 6 — it was
implemented by following that guide.*

## What this adds

A new **kind** of report: periodic registers that totalise player activity
per period, at a cadence the regulator chooses per register — Spain's DGOJ
daily RUD and monthly RUT being the driving case. Until now every
submission file was event-grained (one row per slip/activity); registers
are aggregate-grained (one row per player per period).

The existing periodicity machinery is unchanged: a slip still enters a
period via `report_date = localDate(COALESCE(settled_at, voided_at))`.
Daily registers group by that date; monthly registers group by
`DATE_TRUNC(month)` of it, through the dialect layer so the same source
runs on BigQuery and DuckDB.

## Where it lands

| Concern | Layer | Why |
|---|---|---|
| Which markets file which registers, cadence, fields, rules | `includes/jurisdictions.js` → `periodicReports` on the market | Variance is data — a future market with registers is a config entry |
| Register measure expressions (bets_settled, stake_sum, …) | `includes/fields.js` periodic registry | One SQL definition per measure, shared by every market |
| Config validation (cadence, fields, rules, pair compatibility) | `includes/validate.js` | Bad config must fail to compile, never ship wrong SQL |
| The register query (group by player + period, admissibility) | `includes/queries.js` → `periodicReportQuery` | One builder for all markets and both cadences |
| Daily↔monthly completeness check | `includes/queries.js` → `periodicCompletenessQuery` | Structural guarantee, generated per market with a daily+monthly pair |
| Table fan-out `submission_<register>_<mkt>` | `definitions/30_submissions/periodic.js` | New tables = new wiring file (the one manual definitions step) |
| Register rule assertions + completeness assertion | `definitions/90_assertions/periodic_assertions.js` | Same pattern as `assertions_from_rules.js` |
| Rule engine: assertions over tables whose date column isn't `report_date` | `includes/rules.js` (`dateColumn` option) | Small engine generalisation; registers report `period_start` |
| Offline proof | `local/run.js`, `seed/data.js`, `local/expectations.js` | Definition of done is the offline harness |
| Demo: register record types + on-demand trigger | `dataform-website/` (`submission.py`, `safe.py`, `app.py`, admin template) | See the loop end-to-end without waiting for real events |

## Legacy comparison

| | Legacy (per-market stored procs) | This architecture |
|---|---|---|
| Add DGOJ daily+monthly registers | New Spain-only procs + SSRS artifacts + submission code; monthly/daily consistency by convention | One config property, one query builder, generated assertions |
| Prove monthly = Σ daily | Manual QA / production incident | A compiled assertion that blocks the pipeline, plus a negative test |
| Next market wants registers | Copy-adapt the Spain procs | Add `periodicReports` to that market's config entry |

## The key design decision

`periodicReports` is a **market-level config list**, not Spain code:

```js
periodicReports: [
  { id: "RUD", cadence: "daily",   playerField: "player_dni_hash",
    fields: ["bets_settled", "stake_sum", "winnings_sum", "ggr_sum"], rules: [...] },
  { id: "RUT", cadence: "monthly", playerField: "player_dni_hash",
    fields: ["bets_settled", "stake_sum", "winnings_sum", "ggr_sum"], rules: [...] },
]
```

- `playerField` reuses the existing betting field registry, so the
  register identifies players exactly as the market's event file does
  (ES: SHA-256 DNI digest).
- `fields` name entries in a new **periodic field registry** — all
  additive aggregates (SUM/COUNT), which is what makes the daily→monthly
  roll-up provable.
- `rules` are ordinary declarative rules (same `RULE_TYPES`), asserted
  against the register table.
- A market with both a daily and a monthly register automatically gets the
  completeness assertion; the validator requires the pair to share its
  player identification.
