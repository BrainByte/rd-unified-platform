# Requirement: Golden Chips (promotional table-game chips)

| | |
|---|---|
| Requirement id | **GC** (golden-chips) — individual items REQ-GC-1 … REQ-GC-8 |
| Scope | The operator platform (BetNova demo site, SAFE reporting, financial reconciliation), all jurisdictions |
| Status | Implemented — see [implementation.md](implementation.md) § "As implemented" |
| Companion docs | [overview.md](overview.md) (what & how) · [implementation.md](implementation.md) (step-by-step) |

## Background / product context

Golden chips are a real casino promotion — the table-game equivalent of a
sports free bet ([What are casino golden chips?](https://outplayed.com/blog/what-are-casino-golden-chips)):

- credited to a player's account as a **promotional freebie**;
- playable on **table games / live casino** (blackjack, roulette, gameshows)
  — **not** on slots;
- the defining payout rule: **the chip itself is never returned** — a winning
  golden-chip bet pays the **winnings only** (a £1 chip winning an even-money
  bet returns £1 profit, not £2);
- a losing chip costs the player nothing (the stake was operator money);
- **winnings are cash**, not bonus funds.

Product wants this promotion live in every market. The regulatory and
financial consequence — the reason this is a worked scenario — is that
golden-chip stakes are **operator-funded**: no player cash moves when the
chip is staked, but real cash moves when it wins. That bends both the
cash↔settlement GGR bridge in the financial reconciliation AND the GGR tax
base — and jurisdictions differ on whether bonus-funded stakes may be
**deducted** from taxable GGR or count **gross**.

## The requirements

**REQ-GC-1 — Award.** Players receive golden chips as promotions: (a)
automatically, one €5 golden chip for any single deposit of €50 or more (the
site's existing advertised deal becomes real); (b) manually, by customer
services from the admin player view (goodwill / campaigns). Each chip has a
value, a reason, and an AVAILABLE → USED lifecycle.

**REQ-GC-2 — Play, table games only.** An available golden chip can fund one
round of a **table game** (blackjack, showdown poker) instead of a cash
stake. Slots must refuse golden-chip play (faithful to the product).

**REQ-GC-3 — Winnings-only payout.** When a golden-chip round wins, the
player is credited the **winnings only** — never the chip value. A €5 chip
winning blackjack (2× a cash stake) credits €5, not €10; a blackjack natural
(3:2) credits €7.50; a push credits nothing. The chip is consumed win, lose
or push. Winnings are **cash** (withdrawable, no wagering conditions).

**REQ-GC-4 — Wallet integrity.** A golden-chip stake moves **no player
cash**: no wallet debit at stake time, a cash credit only for winnings. The
derived balance and the sufficient-balance rule must hold without special
cases leaking elsewhere.

**REQ-GC-5 — Responsible gambling.** Self-exclusion blocks golden-chip play
like any wager. Stake caps (personal `STAKE_CASINO`, statutory slots bands —
see `requirements/max-stake-limits/`) apply to the chip **value**. But
golden-chip rounds must NOT count toward a player's **loss limits** — the
player risked nothing of their own.

**REQ-GC-6 — Regulator reporting.** Every gaming record delivered to the
SAFE carries its **funding** (`CASH` / `GOLDEN_CHIP`), so a regulator can
distinguish bonus-funded play. Nothing else about the record changes.

**REQ-GC-7 — Financial reconciliation & GGR.** The reconciliation must stay
exact with golden chips in play:
- the **settlement view** separates cash-funded from bonus-funded rounds;
- the GGR treatment of bonus-funded stakes is **per-market data**
  (`BONUS_STAKE_POLICY`): `deduct` markets exclude the operator-funded chip
  value from taxable GGR (a golden round contributes −winnings); `gross`
  markets count the chip value as stake (chip − winnings) — mirroring the
  pipeline's existing `jackpotPolicy` deduct/gross pattern (MT deducts,
  ES gross);
- the **cash↔settlement bridge** gains one reconciling item for `gross`
  markets: *operator-funded bonus stakes*. The residual must remain exactly
  zero; duty is computed on each market's own GGR basis.

**REQ-GC-8 — Traceability.** Every change site cites this folder
(`REQ: requirements/golden-chips`); [implementation.md](implementation.md)
traces each requirement to its artifacts. The reader must be able to follow
the whole change end to end.

## Out of scope

- Roulette / live gameshows (the demo casino has blackjack, poker, slots).
- Chip **expiry** and wagering requirements (the source article doesn't
  define them; the lifecycle column leaves room).
- Multiple chips on one round; partial chip use.
- The BigQuery pipeline fold-in: golden-chip rounds would arrive as a
  funding column on the rounds feeds and the GGR arm would read a
  per-market `bonusStakePolicy` exactly like the existing `jackpotPolicy` —
  a config + one-expression change, described (not built) in
  [implementation.md](implementation.md) § Part D.

## Acceptance criteria

1. Deposit ≥ €50 awards a €5 golden chip automatically; admin can award any
   value; chips are visible to the player and to customer services.
2. Blackjack and poker offer a "play with golden chip" option when a chip is
   available; slots refuse; a winning golden round credits winnings-only
   cash; the chip is consumed in all outcomes.
3. Golden rounds appear in the SAFE with `Funding = GOLDEN_CHIP`.
4. Reconciliation stays RECONCILED (residual 0.00) with golden activity in
   both a `deduct` and a `gross` market, with the bonus-stakes bridge item
   visible for `gross`; loss limits ignore golden rounds.
5. The demo database reseeds pristine; every artifact traces back here.
