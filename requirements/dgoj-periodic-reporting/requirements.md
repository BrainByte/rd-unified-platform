# Requirement: DGOJ periodic reporting (Spain — daily & monthly registers)

| | |
|---|---|
| Requirement id | **DGOJ** (dgoj-periodic-reporting) — individual items REQ-DGOJ-1 … REQ-DGOJ-5 |
| Scope | The reporting pipeline (`dataform-example/`) and the demo stack (BetNova submission engine, SAFE, admin) — Spain (ES) initially, mechanism reusable by any market |
| Status | Implemented — see [implementation.md](implementation.md) § "As implemented" |
| Companion docs | [overview.md](overview.md) (what & how) · [implementation.md](implementation.md) (step-by-step) |

## Background / regulatory context

Spain's DGOJ (Dirección General de Ordenación del Juego) requires licensed
operators to report through its **monitoring-system data model** — the
*Modelo de datos del sistema de monitorización*, approved by the DGOJ
Resolution of 6 June 2024
([BOE-A-2024-12639](https://www.boe.es/buscar/doc.php?id=BOE-A-2024-12639))
and mandatory since March 2025. Unlike the per-event submission file, the
model defines **periodic registers** whose cadence differs by record type:
a **detailed daily register** (in the style of the RUD, *Registro de Usuario
Diario*) and a **totalized monthly register** (in the style of the RUT,
*Registro de Usuario Totalizado* — moved from daily to monthly cadence in
the version-3 model precisely to reduce operator load).

This scenario adds that capability: **per-player periodic registers at
daily and monthly cadence**, as *configuration* (so any future market with
periodic registers is a config entry, not new code), with the structural
guarantee that **the monthly totals always equal the sum of the dailies**.

The register layouts here are deliberately simplified (betting activity
per player per period); pinning the exact DGOJ field list against the
published model is a production task, not an architectural one.

## The requirements

**REQ-DGOJ-1 — Daily detailed register.** Spain files a daily register
(`RUD`) totalising each player's settled betting activity per local
calendar day: bets settled, stakes, winnings and GGR, with the player
identified by the DGOJ scheme (lowercase SHA-256 of the DNI).

**REQ-DGOJ-2 — Monthly totalized register.** Spain files a monthly
register (`RUT`) with the same measures totalised per player per calendar
month.

**REQ-DGOJ-3 — Daily↔monthly completeness.** The monthly register must be
provably consistent with the dailies: for every player and month, the RUT
totals equal the sum of that player's RUD rows. Any mismatch (or a
player-month present on one side only) blocks the pipeline before filing.

**REQ-DGOJ-4 — Variance as data.** Which markets file which registers, at
which cadence, with which fields, is **configuration** on the market entry
(`periodicReports` in `jurisdictions.js`), validated pre-compile like all
other config. No Spain-specific SQL or `if (market === 'ES')` anywhere.

**REQ-DGOJ-5 — On-demand demo trigger.** The BetNova admin can generate
and submit a jurisdiction's periodic registers for any chosen day/month on
demand (without waiting for real-world events), and the SAFE receives them
as first-class record types with receipts.

## Out of scope

- Payment/balance measures in the registers (deposits, withdrawals,
  account balances) — the demo registers cover betting activity; adding a
  measure is one line in the periodic field registry.
- The exact DGOJ record layouts, XML schemas and naming (RUD/RUT are used
  in-the-style-of; production would pin fields to the published model).
- Reconciliation PDF sections for the registers.
- Gaming-activity registers (same mechanism would apply; betting only here).

## Acceptance criteria

1. `npm run check` (tests + demo + offline DuckDB pipeline + emit-sql) is
   green, including new expectations proving RUD/RUT contents and a
   negative test proving the completeness assertion fires on corrupted
   daily data.
2. The emitted SQL contains `submission_rud_es` (daily) and
   `submission_rut_es` (monthly) and **no other market's files changed**.
3. Config validation rejects: unknown cadence, unknown fields, unknown
   player field, duplicate register ids, and daily/monthly register pairs
   with mismatched player identification.
4. In the demo, *Admin → Periodic reports* submits the ES registers for a
   chosen period to the SAFE; the XML lands under `dataform-safe/ES/rud/`
   and `dataform-safe/ES/rut/` with receipts logged.
