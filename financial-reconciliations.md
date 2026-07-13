# Financial reconciliations — process and method

*How the operator proves, every day and every month, that the money moving
through the gaming platform, the gross gaming revenue (GGR) it computes tax
from, and the records it reported to each regulator all agree. Implemented for
the demo stack in `dataform-website/reconciliation.py`, producing **one PDF
per jurisdiction per period** in [`dataform-reconciliation/`](dataform-reconciliation/README.md).*

---

## Why this exists

An operator runs (at least) two very different data worlds:

| World | In this repo | Nature |
|---|---|---|
| **Transactional OLTP** | the demo site's DuckDB (`dataform-website/data/betnova.duckdb`) | Player-facing truth: deposits, withdrawals, bets, game rounds, balances — money moving in real time |
| **Regulatory reporting** | the submission records delivered to the SAFE (`safe_submissions` log + `dataform-safe/` XML; in production, the pipeline's `submission_ready_*` tables) | What the regulator was told: settlements, payments, players — the basis for GGR tax |

Finance must be able to sign off that these worlds agree — and when they
don't, see *exactly which items* differ and why. That's this process. The
reports are also the working papers for the **GGR duty payment**, so the
numbers must be defensible line by line.

## The core complexity: two GGR bases that never trivially match

The OLTP naturally measures money on a **player-transaction (cash) basis**;
the regulator is reported **bet settlements**. Both are "GGR", and they
legitimately differ every single day:

**Cash basis** — what left players' pockets this period:

```
cash GGR = deposits − withdrawals − (closing player balance − opening player balance)
```

Money a player deposits either gets withdrawn again, sits in their balance,
or is lost to the operator. Removing the first two leaves cash GGR.

**Settlement basis** — the tax base the regulator sees:

```
settlement GGR = Σ over bets SETTLED in the period (stake − payout)
               − Σ void reversals in the period
               + Σ casino rounds in the period (stake − payout)
```

**Why they differ**: a stake leaves the player's balance the moment the bet
is *placed* (cash view), but only enters the tax base when the bet
*settles* — possibly hours, days, or a month-end boundary later. Voids refund
across periods; a bet voided *after* settlement claws back both the payout
and the previously-booked GGR.

**The bridge** — the difference is exactly one number, the movement in the
**unsettled-stakes (open bets) liability**:

```
cash GGR − (open bets at close − open bets at open) = settlement GGR
```

Every reconciliation computes both sides independently, applies the bridge,
and flags any residual as **UNRECONCILED**. A residual means a defect —
money that moved without a matching settlement record or vice versa — and it
is never explained away, only investigated.

### Worked example (one day)

A player starts at balance 0, deposits **100**, bets **40** on match A
(settles today, wins a **60** payout), bets **30** on match B (still open at
midnight), and loses **10** on slots.

**Cash view.** The balance timeline: +100 −40 +60 −30 −10 → closing balance
**80**. So

```
cash GGR = 100 (deposits) − 0 (withdrawals) − (80 − 0) (balance movement) = 20
```

**Settlement view.** Only match A settled: 40 − 60 = **−20**; slots add
10 − 0 = **+10**:

```
settlement GGR = −20 + 10 = −10
```

Cash says the operator kept 20; the tax base says the operator *lost* 10.
Both are right — the 30 on match B has left the player's balance (so cash
counts it) but is not yet revenue (so settlement must not). It sits in the
**open-bets liability**, which moved 0 → 30 today:

```
cash GGR − open-bets movement = 20 − 30 = −10 = settlement GGR   ✓ RECONCILED
```

Tomorrow, when match B settles, the movement reverses and the 30 flows into
whichever side of GGR the result dictates. Intuition about these numbers is
treacherous — a payout bigger than the day's deposits, a void straddling
midnight, a clawback after settlement all bend them in surprising ways —
which is exactly why the identity is computed, checked and flagged
mechanically rather than argued about at month-end.

## Daily vs monthly

- **Daily** — the operational control: catches breaks within 24h (a
  settlement that never reached the SAFE, a payout with no settlement, a
  clawback missed). One PDF per jurisdiction per day, RECONCILED /
  UNRECONCILED status on page one.
- **Monthly** — the fiscal document: the month's bridge plus a per-day GGR
  and duty appendix. Duty accrues **per day at that day's effective-dated
  rate** — a mid-month rate change (Bulgaria and the Netherlands both changed
  on 2026-01-01) is applied to each day's own GGR, never averaged.

## The three-way completeness check

Financial totals agreeing is necessary, not sufficient — the regulator must
also have received *every record*. Section 4 of each report walks every
reportable item in the period (settled/voided bets per that market's rules,
casino rounds, completed payments) and demands:

1. a **receipt** in the submission log (`safe_submissions`), and
2. the **stored XML** in the SAFE's record store (`dataform-safe/<MKT>/…`).

Anything failing either check is itemised as a **break** (`NOT SUBMITTED` /
`XML missing`) and the report — and the process exit code — fails, so this
can gate a finance close the same way `npm run check` gates a code change.

## Market variance is data here too

Per-market reporting rules come from the same config the submission engine
uses (`submission.py MARKETS`): MT/DK report voids so voids are *expected*
records there; ES/BG/GR/NL suppress voids so the same void is correctly *not*
expected. Duty rates (with their effective dates) are a data table
(`TAX_RATES`). No `if market == …` logic anywhere in the reconciliation.

**Bonus-funded stakes (golden chips)** are the worked example of a *third*
bridge dimension (see [`requirements/golden-chips/`](requirements/golden-chips/requirements.md)):
an operator-funded chip stakes with no player cash moving, and pays cash
winnings only. The settlement view splits cash-funded from bonus-funded
rounds; whether the chip value counts in taxable GGR is per-market **data**
(`BONUS_STAKE_POLICY`: `deduct` vs `gross`, mirroring the pipeline's
`jackpotPolicy`), and `gross` markets get one more fully-explained bridge
item — *operator-funded bonus stakes* — with the residual still exactly zero.

## Running it

Two ways to the same reports:

**From the admin back office** (while the site runs): *Admin → Financial
reconciliation* — pick a market (or all with activity), daily or monthly, the
day/month, and Generate. RECONCILED / BREAKS status is flashed per report and
the PDFs are listed for download on the same page.

**From the command line** (site stopped — the OLTP is opened read-only;
production would use a replica):

```bash
.venv/Scripts/python dataform-website/reconciliation.py                  # today + this month
.venv/Scripts/python dataform-website/reconciliation.py --date 2026-07-12
.venv/Scripts/python dataform-website/reconciliation.py --month 2026-07 --jurisdiction MT
```

Console output is a one-line-per-report summary (cash GGR, settlement GGR,
residual, reported completeness, status); the PDFs land in
`dataform-reconciliation/<MKT>/`. Exit code 0 = everything reconciled and
fully reported — so the CLI run can gate a scheduled finance close.

## Relation to the production pipeline

This demo reconciliation runs *operator-side* against the OLTP and the
submission log. The reporting pipeline (`dataform-example/`) carries the same
discipline in two more places: `recon_provider_ggr` reconciles internal
gaming GGR against provider revenue-share statements, and open item #3 (the
legacy parallel-run layer) applies three-level diffs — totals → rows →
fields — during market cutover. Same principle throughout: **never trust one
source of a financial number; compute it two ways and make the difference
explain itself.**
