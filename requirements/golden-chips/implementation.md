# Golden chips — implementation guide (step by step)

*Companion to [requirements.md](requirements.md) and [overview.md](overview.md).
Each step names the file it touches and the requirement it satisfies; the
final section traces every requirement to its artifacts. All changes carry a
`REQ: requirements/golden-chips` comment.*

---

## Part A — the business object and the wallet (`dataform-website/`)

### Step 1 · The `golden_chips` table *(REQ-GC-1)*

In `db.py`, one new OLTP table — a chip is a first-class business object with
an award and a consumption:

```sql
CREATE TABLE IF NOT EXISTS golden_chips (
  chip_id    VARCHAR PRIMARY KEY,
  account_id VARCHAR NOT NULL,
  value      DECIMAL(12,2) NOT NULL,
  reason     VARCHAR,               -- 'deposit promotion' / 'customer services award'
  status     VARCHAR NOT NULL,      -- AVAILABLE / USED
  awarded_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  used_round_id VARCHAR             -- the game round it funded
);
```

### Step 2 · Funding on the round, and the wallet arm *(REQ-GC-4)*

`game_rounds` gains one column: `funding` (`CASH` default / `GOLDEN_CHIP`).
The derived-balance ledger (`BALANCE_SQL`) splits its casino arm: cash rounds
contribute `payout − stake` as before; golden rounds contribute **`payout`
only** — no player cash ever left the wallet for the stake. That single arm
is the whole wallet story; nothing else special-cases golden chips.

### Step 3 · Award and consume *(REQ-GC-1, REQ-GC-3)* — `engine.py`

- `award_golden_chip(cur, account_id, value, reason)` — insert AVAILABLE.
- `available_golden_chip(cur, account_id)` — the oldest AVAILABLE chip.
- `consume_golden_chip(cur, chip_id, round_id)` — mark USED at resolution.
- `golden_winnings(stake, payout)` — the winnings-only rule in ONE place:
  `max(payout − stake, 0)`. A €5 chip winning 2× pays €5; a natural (2.5×)
  pays €7.50; a push (payout == stake) pays 0.
- `DEPOSIT_PROMO = {"min_deposit": 50.0, "chip_value": 5.0}` — the deposit
  deal as data; the deposit route awards after a qualifying COMPLETED
  deposit.

### Step 4 · Play it — table games only *(REQ-GC-2, REQ-GC-3, REQ-GC-5)*

In `app.py`, blackjack and poker accept `use_chip=1`:
- the stake becomes the chip's value; the **existing** stake gate still runs
  for exclusion and stake caps (chip value = the stake), but the
  balance check is skipped (no cash is being staked);
- on resolution the round is recorded with `funding='GOLDEN_CHIP'`,
  `stake=chip value`, `payout=golden_winnings(...)`, and the chip is
  consumed. Slots has no chip option (and the engine refuses non-table
  games).
- Loss limits: the existing loss query gains `AND funding = 'CASH'` — golden
  rounds never count against a player's loss limit *(REQ-GC-5)*.

### Step 5 · Surfaces *(REQ-GC-1)*

- Account page: a *Golden chips* card (available chips + how to earn one).
- Blackjack / poker pages: a *Play with golden chip* control when available.
- Admin player view: chips listed + an award form (customer services).
- The homepage deal card ("€10 free bet…") becomes the real, working
  golden-chip promotion.

## Part B — regulator reporting *(REQ-GC-6)* — `submission.py`

The gaming SubmitRecord gains one element: `<Funding>CASH|GOLDEN_CHIP</Funding>`
(and the SAFE stores it like any other record content — no SAFE change
needed). Regulators can now separate bonus-funded play.

## Part C — financial reconciliation *(REQ-GC-7)* — `reconciliation.py`

1. **Split the settlement view**: cash-funded rounds vs bonus-funded rounds
   (count, stakes, payouts each).
2. **Policy as data**: `BONUS_STAKE_POLICY = {"MT": "deduct", "ES": "gross", …}`
   — mirrors the pipeline's `jackpotPolicy` (MT deducts, ES gross).
   - `deduct`: golden rounds contribute **−winnings** to taxable GGR;
   - `gross`: they contribute **chip value − winnings**.
3. **The bridge**: cash GGR − open-bets movement **+ bonus stakes (gross
   markets only)** = settlement GGR. The bonus-stakes reconciling item is
   printed whenever golden activity exists; the residual stays an exact-zero
   check.
4. The PDF's settlement section shows the golden lines and the applied
   policy; duty uses each market's own GGR basis.

## Part D — the production pipeline fold-in (described, not built)

In `dataform-example/`, golden chips would arrive exactly like every other
variance: the rounds feeds carry `funding`; `jurisdictions.js` gains a
per-market `bonusStakePolicy: "deduct" | "gross"` next to the existing
`jackpotPolicy`; and the one `gaming_ggr` expression grows one arm reading
it. No new tables, no per-market SQL — the same shape as the operator
jackpot and max-stake-limits changes before it.

---

## As implemented — requirement → artifact trace

| Requirement | Implemented by | Proven by |
|---|---|---|
| REQ-GC-1 award + lifecycle | `db.py` (`golden_chips` table), `engine.py` (`award_golden_chip`, `DEPOSIT_PROMO`), deposit route + admin award route in `app.py`, account/admin templates | Smoke: €50 deposit auto-awards a €5 chip; admin awards €10; both visible |
| REQ-GC-2 table games only | `use_chip` handling in blackjack/poker routes only; `engine.play_golden_allowed` guard | Smoke: slots has no chip path; engine refuses `SLOTS` |
| REQ-GC-3 winnings-only, chip consumed | `engine.golden_winnings` (one place), `consume_golden_chip` at resolution | Smoke: winning golden blackjack credited winnings-only; chip USED after win, loss and push alike |
| REQ-GC-4 wallet integrity | `game_rounds.funding` + the split casino arm in `BALANCE_SQL` | Smoke: balance unchanged on golden loss; +winnings only on win; recon residual 0.00 |
| REQ-GC-5 RG rules | Existing stake gate reused (chip value); `funding='CASH'` filter in `loss_limit_block` | Smoke: excluded player refused; golden losses don't move the loss base |
| REQ-GC-6 regulator visibility | `<Funding>` element in `submission.py` gaming records | SAFE XML inspected: `GOLDEN_CHIP` present |
| REQ-GC-7 recon + GGR policy | `BONUS_STAKE_POLICY` + split settlement view + bonus-stakes bridge item in `reconciliation.py` | Recon run with golden activity in MT (deduct) and ES (gross): different taxable GGR, bridge item shown, residual 0.00 both |
| REQ-GC-8 traceability | `REQ: requirements/golden-chips` comments at every change site; this table | — |

**Verification**: scripted end-to-end smoke (award → play → wallet → SAFE →
reconciliation) recorded in the feature commit; demo database reseeded
pristine.
