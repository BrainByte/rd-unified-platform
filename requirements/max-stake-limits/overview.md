# Max stake limits — overview: what changes, and why it's easy here

*Companion to [requirements.md](requirements.md) (the ask) and
[implementation.md](implementation.md) (the step-by-step). This page explains
**what** the change is, **where** it lands in the architecture, and **why the
same change is a fraction of the legacy cost**.*

## What the change is

Two related capabilities, across all six markets:

1. **Statutory online-slots stake caps** — UKGC-style: age-banded (adult /
   18–24), effective-dated (each band arms on its own date), slots-only,
   values differing per market, some markets having none at all.
2. **Player-set casino stake limits** — a new personal limit type
   (`STAKE_CASINO`) applying to every casino vertical, effective immediately.

Enforcement happens twice, deliberately: the **operator front door refuses**
an over-cap stake at bet time (the demo site), and the **reporting pipeline
proves** after the fact that no stake ever exceeded the cap in force at the
moment it was staked (a breach detector that must be empty).

## Where it lands — everything in its layer

| Concern | Layer | Why there |
|---|---|---|
| Per-market bands, ages, dates, values | `jurisdictions.js` config (**data**) | Market variance is data — rule #1 |
| Player's personal cap | A new `limit_type` **value** flowing through the existing `cdc_player_limits` machinery | The limits model was built shape-generic; a new limit type is a row, not a schema |
| Player age | `date_of_birth` on the shared account model | A **universal** datum → shared model; the extension carrier is only for data *some* markets need |
| Cap resolution & breach detection | One new detector in `player_protection.js`, written **once** for all markets | Same pattern as the five existing detectors |
| "Which caps were in force when?" | `ref_stake_limits`, an effective-dated reference table generated from config | Same pattern as the regulator code maps |
| Breach consequence | One line in the exception flow's COMPLIANCE union | Quarantine-first: the entity is held; the run never aborts |
| Front-door refusal | The demo site's stake gate + limits UI | The same invariant, enforced then proven |

Notice what is **not** on the list: no new per-market SQL, no fork, no trigger,
no schema change beyond one universal column, no change to any existing
submission file.

## The legacy comparison (the point of this exercise)

The same requirement against the 17-fork stored-procedure estate:

| Step | Legacy (per market × 17) | This architecture (once) |
|---|---|---|
| Store the caps | New config table *or* hard-coded constants in each market's procs | 5 config entries (data) |
| Age bands + dates | `IF @Age >= 25 AND @Date >= '2025-04-09'` branches sprinkled through each fork's bet-acceptance proc — and each fork's copy drifts | One generated `CASE`, written once, driven by config |
| Player limit type | `ALTER TABLE` / new columns or a new table per estate, plus proc changes to read it | A new `limit_type` **value** — zero DDL |
| Prove compliance | A per-market report written by hand, per fork | One detector + negative tests, runs for every market |
| Historical correctness | "What was the cap last March?" = archaeology through deploy history | Effective-dated config + `ref_stake_limits`: the caps for any date are a query |
| Verify the change | Regression-test 17 estates on shared SQL Server environments | `npm run check` — whole pipeline offline, seconds |
| Blast radius | Unknown until production | The diff is 1 config file + 1 detector + tests; `dataform compile` lists affected tables |

Rough effort: legacy ≈ 17 × (proc changes + testing + deployment windows);
here ≈ one config edit, one ~60-line detector, tests — a day, not a quarter.

## How you can see it work

- **Pipeline**: `cd dataform-example && npm run check` — the new
  `ref_stake_limits` table materialises the bands; `rg_breach_stake_limits`
  is empty on clean data; negative tests inject an over-cap adult stake, an
  over-band young-adult stake, an over-personal-cap poker stake (each fires)
  and a pre-go-live stake (correctly exempt — effective-dating at work).
- **Demo site**: log in to BetNova, set *Stake — casino* to €2 in Account →
  limits, then try a €5 slots spin: refused with the reason. The statutory
  bands ship date-armed and start refusing automatically on their effective
  dates.
