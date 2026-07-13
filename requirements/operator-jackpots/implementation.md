# Operator jackpots — implementation guide (step by step)

*Companion to [requirements.md](requirements.md) and [overview.md](overview.md).
Each step names the file it touches and the requirement it satisfies; every
change site carries a `REQ: requirements/operator-jackpots` comment.*

---

## Part A — gaming sessions (`dataform-website/`)

### Step 1 · The `gaming_sessions` table *(REQ-OJ-1)* — `db.py`

```sql
CREATE TABLE IF NOT EXISTS gaming_sessions (
  session_id VARCHAR PRIMARY KEY,      -- GS1001...
  account_id VARCHAR NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  last_activity_ts TIMESTAMPTZ NOT NULL,
  ended_at   TIMESTAMPTZ,
  end_reason VARCHAR                   -- LOGOUT / INACTIVITY
);
```

`game_rounds` gains a `session_id` column — every play is stamped
*(REQ-OJ-2)*.

### Step 2 · Lifecycle hooks *(REQ-OJ-1)* — `engine.py` + `app.py`

- `SESSION_TIMEOUT_MINUTES` (config, default 30).
- `start_gaming_session / end_gaming_session` in the engine; login starts
  one, logout ends it (`LOGOUT`).
- `ensure_gaming_session(cur, account_id)` runs on every authenticated
  request: it touches `last_activity_ts`; if the gap exceeded the timeout it
  ends the stale session (`INACTIVITY`) and mints a new one — "disconnected
  through inactivity, reconnected on return".
- The round recorder receives the current session id.

## Part B — the operator jackpot

### Step 3 · Config as data *(REQ-OJ-4/5/8)* — `engine.py`

```python
OPERATOR_JACKPOT = {
    "game_id": "operator-jackpots",   # REQ-OJ-7: the jackpot's own game id
    "contribution_rate": 0.01,        # 1% of every cash casino stake
    "win_probability": 0.05,          # RNG per contributing play (demo-friendly)
    "seed": 100.00,                   # operator-funded starting pool
}
GAME_TYPE_CODES = {"SLOTS": 1, "BLACKJACK": 2, "POKER": 3,
                   "operator-jackpots": 7077}   # REQ-OJ-8: the magic number
```

### Step 4 · Opt-in lifecycle *(REQ-OJ-3)* — `db.py` + `engine.py` + Account UI

`jackpot_optins` (optin_id, account_id, opted_in_at, opted_out_at) — the same
open-interval lifecycle as player limits and the pipeline's
`cdc_jackpot_optins`. `opt_in / opt_out / is_opted_in` helpers; an Account
card with the toggle, the rate, and the live pool.

### Step 5 · The pool, derived *(REQ-OJ-6)* — `engine.py`

```
pool = seed + Σ stake(game_id rounds)  −  Σ payout(game_id rounds)
```

One query over `game_rounds WHERE game = 'operator-jackpots'`. No stored
balance, no trigger, nothing to drift.

### Step 6 · Contribute + draw *(REQ-OJ-4/5/7)* — `engine.py` + `app.py`

`operator_jackpot_play(cur, account_id, session_id, stake, funding)` runs
after **every** casino round, whatever the game:
- not opted in, or a golden-chip round → nothing;
- otherwise record a contribution round (`operator-jackpots`,
  stake = 1% of the triggering stake, payout = 0, same session);
- run the RNG; on a win, record a win round (stake = 0, payout = the entire
  derived pool) and return the amount — the route flashes the **celebration
  message** (a dedicated `jackpot` flash style) and the wallet, being
  derived, already shows the credit.

The stake gate reserves stake + contribution for opted-in players so the
contribution can never overdraw the wallet.

### Step 7 · Regulator reporting *(REQ-OJ-2/8)* — `submission.py`

The gaming SubmitRecord gains two elements: `<SessionId>` and `<GameType>`
(from `GAME_TYPE_CODES`). Jackpot rounds are ordinary gaming rounds, so they
are delivered to the SAFE by the existing loop with **no further changes** —
carrying game id `operator-jackpots` and game type **7077**.

### Step 8 · Money integrity — deliberately nothing *(REQ-OJ-9)*

Contributions and wins are cash gaming rounds, so with **zero further code**:
the derived wallet debits/credits them; they count toward loss limits (the
pipeline made the same call for this product); the reconciliation's
settlement view includes them (contributions − wins), the cash view moves
identically, and the residual stays exactly zero. Verify by generating a
reconciliation with jackpot activity present.

## Part C — the production pipeline (already there)

`dataform-example/` has modelled this product since before the operator built
it: the phantom game `OJ1`/`OJACK` (MT licenses it, ES blocks it via
`no_unlicensed_games`), `fct_operator_jackpot_contributions` with the
void/refund cascade, the derived pool liability, loss-limit counting and the
wallet debits. The website's `operator-jackpots` rounds (deducible by game
type 7077) are exactly the OLTP those `cdc_operator_jackpot_*` feeds capture.

---

## As implemented — requirement → artifact trace

| Requirement | Implemented by | Proven by |
|---|---|---|
| REQ-OJ-1 session lifecycle | `gaming_sessions` table (`db.py`); `start/end/ensure_gaming_session` (`engine.py`); login/logout/before-request hooks (`app.py`); `SESSION_TIMEOUT_MINUTES` | Smoke: login mints GS-id; logout ends LOGOUT; a stale session ends INACTIVITY and a new id is minted (offline guard test) |
| REQ-OJ-2 session on every play | `game_rounds.session_id` + `_record_round`; `<SessionId>` in `submission.py` | SAFE XML inspected: every gaming record carries the session |
| REQ-OJ-3 opt-in | `jackpot_optins` table; `opt_in/opt_out/is_opted_in`; Account card + routes | Smoke: toggle both ways; contributions only while opted in |
| REQ-OJ-4 contribution | `OPERATOR_JACKPOT.contribution_rate`; `operator_jackpot_play` after every casino round; golden rounds excluded; gate reserves stake+contribution | Smoke: each cash spin records a 1% `operator-jackpots` round in the same session; golden round records none |
| REQ-OJ-5 the draw + popup | RNG in `operator_jackpot_play`; `jackpot` flash category + CSS | Smoke: win observed — celebration flash with the amount; balance credited by exactly the pool |
| REQ-OJ-6 derived pool | `jackpot_pool(cur)` = seed + Σ contributions − Σ wins | Pool ticks up per spin; after the win it equals seed again (wins pay the derived balance) |
| REQ-OJ-7 jackpot as a game | Contribution/win rounds under game id `operator-jackpots` | Rounds visible in admin player view and the SAFE |
| REQ-OJ-8 magic-number game type | `GAME_TYPE_CODES` config; `<GameType>` on every gaming record | SAFE XML: jackpot rounds carry 7077, slots 1, blackjack 2, poker 3 |
| REQ-OJ-9 money integrity untouched | — (no wallet/loss/recon changes) | Reconciliation with jackpot activity: residual 0.00 RECONCILED; contributions in settlement GGR |

**Verification**: scripted end-to-end smoke (session → opt-in → contributions
→ win → SAFE → reconciliation) recorded in the feature commit; demo database
reseeded pristine.
