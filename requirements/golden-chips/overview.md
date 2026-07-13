# Golden chips — overview: what changes, and why it's easy here

*Companion to [requirements.md](requirements.md) (the ask) and
[implementation.md](implementation.md) (the step-by-step). What the feature
is, where it lands, and the legacy comparison.*

## What the feature is

A promotional **golden chip** is operator money a player can stake once on a
table game. Three rules define it (see the sourced product description in
requirements.md): it plays like a stake, **only the winnings come back**
(never the chip), and those winnings are **cash**. Product wants it in every
market: a €5 chip for any €50+ deposit, plus manual awards by customer
services.

The interesting part is not the game mechanics — it's what operator-funded
stakes do to **money integrity**:

- **The wallet**: staking a chip moves no player cash; winning moves real
  cash *into* the wallet with no matching outflow anywhere in the player's
  history.
- **The reconciliation**: the cash view (deposits − withdrawals − balance
  movement) and the settlement view (stakes − payouts) no longer bridge by
  open bets alone — bonus-funded stakes are a new, *explainable* reconciling
  item.
- **The tax base**: is the operator's €5 chip "stake" really revenue?
  Jurisdictions disagree — some let bonus costs be **deducted** from taxable
  GGR, others tax **gross**. That's per-market variance, and in this
  architecture per-market variance is *data*.

## Where it lands — everything in its layer

| Concern | Layer | Why there |
|---|---|---|
| Chip lifecycle (award → use) | New `golden_chips` OLTP table | It's a new business object; one table, market-agnostic |
| Deposit promotion (€50 → €5 chip) | The deposit route, after completion | Operational behaviour of the site |
| Winnings-only payout, table-games-only | `engine.py` game resolution | Product mechanics, written once |
| No cash at stake / cash winnings | One `funding` column on `game_rounds` + one arm in the derived-balance ledger | The wallet stays a pure derivation |
| Loss limits ignore golden rounds | One `funding = 'CASH'` filter in the existing loss query | The player risked nothing |
| Stake caps still apply to chip value | Nothing — the existing gate already runs | Reuse, not exception |
| Regulator visibility | One `<Funding>` element on the SAFE gaming record | The record schema is ours; regulators see bonus play |
| GGR treatment per market | `BONUS_STAKE_POLICY` **data** in the reconciliation (deduct vs gross — mirroring the pipeline's `jackpotPolicy`) | Market variance is data, rule #1 |
| The bridge stays exact | One reconciling item ("operator-funded bonus stakes") for gross markets | The residual check keeps meaning zero-means-clean |

## The legacy comparison (the point of this exercise)

| Step | Legacy (per market × 17) | This architecture (once) |
|---|---|---|
| Chip mechanics | New procs + triggers per estate; payout logic copy-pasted and drifting (is a push a refund? per fork, who knows) | One resolution function; winnings-only rule in one place |
| Wallet correctness | Balance-update triggers patched per estate; a missed case = phantom money | Balance is derived; one new arm in one ledger query |
| Bonus in the tax number | Each market's GGR proc edited by hand; deduct-vs-gross encoded as scattered `IF @Market` | One policy table (data); the recon computes both views and proves the bridge |
| Regulator files | Per-market file format edits | One element on one record builder |
| Month-end explains | "Why is cash GGR £312 off settlement?" — a spreadsheet archaeology exercise | The bridge itemises it: open bets + bonus stakes, residual 0.00 or flagged |
| Verifying it | Regression cycles on 17 estates | Scripted smoke of the site + one reconciliation run |

## How you can see it work

1. Run the site (`python dataform-website/app.py`), log in as `demo`,
   deposit **€50** — a €5 golden chip appears on your Account page (the
   homepage deal is now real).
2. Open **Blackjack** or **Poker** and choose *Play with golden chip*: win
   and the winnings-only cash lands in your balance; lose and your balance
   is untouched. Slots won't accept it.
3. Admin → player view shows and awards chips; the SAFE's gaming XML for the
   round carries `<Funding>GOLDEN_CHIP</Funding>`.
4. Admin → Financial reconciliation → Generate: the settlement view now
   splits cash-funded from bonus-funded rounds; MT (deduct) and ES (gross)
   compute different taxable GGR from identical activity; the bridge shows
   the bonus-stakes item and the residual is still **0.00 RECONCILED**.
