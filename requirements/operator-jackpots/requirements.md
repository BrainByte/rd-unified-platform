# Requirement: Operator jackpots (opt-in play incentive) + gaming sessions

| | |
|---|---|
| Requirement id | **OJ** (operator-jackpots) — individual items REQ-OJ-1 … REQ-OJ-9 |
| Scope | The operator platform (BetNova demo site, SAFE reporting, financial reconciliation), all jurisdictions |
| Status | Implemented — see [implementation.md](implementation.md) § "As implemented" |
| Companion docs | [overview.md](overview.md) (what & how) · [implementation.md](implementation.md) (step-by-step) |

## Background / product context

Product wants an **operator-run jackpot** as a play incentive: players who
**opt in** contribute a small percentage of every casino stake into a shared
pool, and every opted-in play triggers an RNG draw — win, and the pool is
yours, instantly, with a celebration message and the amount credited to your
balance.

This is precisely the product the reporting pipeline already anticipated:
`dataform-example/` models an operator opt-in jackpot end to end (the phantom
game `OJ1` / canonical `OJACK`, `cdc_jackpot_optins`,
`cdc_operator_jackpot_contributions` / `_wins`, pool liability, loss-limit
counting, void cascade — see `ARCHITECTURE.md` § "Operator-driven products").
This scenario builds the **operator side** that generates that OLTP for real,
and adds the enhancement it depends on: **gaming sessions**.

## The requirements

### Gaming sessions (the enabling enhancement)

**REQ-OJ-1 — Session lifecycle.** Whenever a player logs in they receive a
**gaming session id**. The session continues until they log out or are
disconnected through inactivity (a configurable timeout; continued activity
after a timeout starts a *new* session). Sessions are persisted with start,
end and end-reason (`LOGOUT` / `INACTIVITY`).

**REQ-OJ-2 — Sessions on every gaming play.** Every gaming round records the
session id it was played under, and the session id is **reported on every
gaming record** delivered to the regulator SAFE.

### Operator jackpots

**REQ-OJ-3 — Opt-in.** A player can opt in to (and out of) operator jackpots
at any time; the opt-in lifecycle is persisted. Only opted-in players
contribute and only they can win.

**REQ-OJ-4 — Contribution.** On every **cash-funded** casino round played by
an opted-in player, a configurable **percentage of the stake** (default 1%)
is taken alongside the stake from their balance and pooled. (Golden-chip
rounds are operator money already — they neither contribute nor draw.)

**REQ-OJ-5 — The draw.** Each contributing play runs an RNG with a
configurable win probability. A win pays the **entire current pool** to the
player: a celebration message shows the amount, and it is credited to their
cash balance immediately.

**REQ-OJ-6 — The pool is derived, never stored.** Pool balance =
`seed + Σ contributions − Σ wins` — computed from the recorded rounds,
exactly like the wallet and the pipeline's `fct_operator_jackpot_liability`.
It can never go negative because a win pays exactly the derived balance.

**REQ-OJ-7 — Recorded as a jackpot game.** Contributions and wins are
**gaming rounds in their own right**, running alongside the triggering game:
game id **`operator-jackpots`**, one round per contribution
(stake = contribution, payout = 0) and one per win (stake = 0, payout = pool)
— the same shape as the pipeline's `OJC`/`OJW` records.

**REQ-OJ-8 — Game-type magic number.** Every gaming record reported to the
SAFE carries a **game type code**; the codes are **configurable data**
(`GAME_TYPE_CODES`), and operator-jackpot rounds carry a distinctive magic
number (default **7077**) so downstream systems can deduce jackpot activity
from the gaming data alone — mirroring how the pipeline's nomenclature maps
`OJACK` to a licensed vertical.

**REQ-OJ-9 — Money integrity for free.** Contributions are real cash wagers:
they must flow through the existing wallet derivation, count toward **loss
limits** (the pipeline made the same call), appear in the financial
reconciliation's settlement view, and leave the cash↔settlement **residual at
exactly zero** with no reconciliation code changes.

## Out of scope

- Sports-bet-triggered contributions (the pipeline models both triggers; the
  demo contributes on casino play only — the sports trigger is the same
  pattern on the bet route).
- Multiple concurrent jackpot pools / tiered jackpots.
- The void/refund cascade for contributions on voided triggers (modelled in
  the pipeline; the demo's casino rounds are never voided).
- Sessions on sports bets (the requirement covers gaming plays; the same
  one-line stamp would extend to bets).

## Acceptance criteria

1. Login creates a session; logout ends it (`LOGOUT`); activity after the
   inactivity timeout ends the old session (`INACTIVITY`) and starts a new
   one. Every gaming round and every SAFE gaming record carries the session.
2. Opt-in/out from the Account page; the casino lobby shows the live pool.
3. Playing while opted in records `operator-jackpots` contribution rounds
   (1% of stake) alongside each cash casino round; golden-chip rounds don't
   contribute; a win pops the celebration message, credits the full pool,
   and records the win round.
4. SAFE gaming records carry `SessionId` and `GameType` (jackpot rounds =
   the configurable magic number 7077).
5. Financial reconciliation stays RECONCILED (residual 0.00) with jackpot
   activity present, with contributions visible in settlement GGR.
6. The demo database reseeds pristine; every artifact traces back here.
