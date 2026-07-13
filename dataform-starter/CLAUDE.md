# Regulatory Reporting Pipeline — Maintainer Guide

This repo generates regulatory reporting tables in BigQuery for multiple
gaming jurisdictions from CDC-replicated OLTP data, and feeds per-market
SOAP submission services.

## Architecture rules (non-negotiable)

1. **All jurisdiction variance lives in `includes/jurisdictions.js`.**
   Never hard-code a market name, tax rate, cutoff time, or field list
   inside a SQLX file or shared function.
2. **Staging (`10_staging`) and core (`20_core`) layers are
   jurisdiction-agnostic.** They may carry a `jurisdiction` column but
   must never branch on its value.
3. **The submissions layer (`30_submissions`) contains no business
   logic** — only config-driven selection/shaping via functions in
   `includes/common.js`.
4. **Genuine divergence goes in `30_submissions/overrides/`** as a
   small SQLX per market, and the market's config entry sets
   `customSubmission: true` so the fan-out loop skips it.
5. **Every submission table has assertions.** A change that breaks a
   totals or completeness assertion is wrong until proven otherwise.
6. **Timezones:** all timestamps stored UTC. Conversion to local market
   time happens only via `settlementWindow()` in `includes/common.js`.
   Never write inline timezone conversions.

## Making a typical change

"Market X regulator requires new field Y in the daily file":
1. Add Y to `reportFields` in that market's entry in `jurisdictions.js`.
2. If Y needs new derivation, add it to the relevant core model
   (jurisdiction-agnostically) or to `fieldExpressions` in `common.js`.
3. Run `dataform compile` — confirm only `submission_ready_x` changed.
4. Assertions must pass. Update the market's expected-schema assertion.

## Layout

- `includes/jurisdictions.js` — single source of truth for market config
- `includes/common.js` — shared SQL generators
- `includes/recon.js` — reconciliation SQL generators
- `definitions/00_sources` — CDC landing table declarations
- `definitions/10_staging` — dedupe, cast, one row per business event
- `definitions/20_core` — jurisdiction-agnostic facts
- `definitions/30_submissions` — fan-out: one table per market
- `definitions/40_recon` — internal recon + legacy parallel-run diffs
- `definitions/90_assertions` — cross-cutting assertions
- `submission-service/` — Cloud Run SOAP engine + per-market adapters
