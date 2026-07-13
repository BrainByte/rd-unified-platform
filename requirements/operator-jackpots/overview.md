# Operator jackpots — overview: what changes, and why it's easy here

*Companion to [requirements.md](requirements.md) (the ask) and
[implementation.md](implementation.md) (the step-by-step).*

## What the feature is

Two things, one dependent on the other:

1. **Gaming sessions** — every login mints a session id that lives until
   logout or an inactivity timeout, and every gaming play (and its regulator
   record) is stamped with it. Regulators increasingly demand session-level
   traceability; it also gives the jackpot draw an auditable context.
2. **Operator jackpots** — an opt-in incentive: 1% of every cash casino
   stake from opted-in players pools together; every contributing play runs
   an RNG; a win pays the **whole pool** on the spot, with a celebration
   message and an instant balance credit.

The regulatory shape is the deliberate echo: the reporting pipeline
(`dataform-example/`) **already models this exact product** — a phantom game
so wins correlate to a licensed vertical, contribution/win records, derived
pool liability, contributions counting toward loss limits. This scenario
builds the operator side that emits that data for real: contributions and
wins are **first-class gaming rounds** under game id `operator-jackpots`,
with a **configurable magic-number game type (7077)** so any downstream
consumer can deduce jackpot activity from the gaming data alone.

## Where it lands — everything in its layer

| Concern | Layer | Why there |
|---|---|---|
| Session lifecycle | New `gaming_sessions` OLTP table + login/logout/inactivity hooks | A session is a business object with a lifecycle |
| Session on every play | One `session_id` column on `game_rounds`; one `<SessionId>` element on the SAFE record | Stamp at the write site, report at the record builder |
| Opt-in lifecycle | New `jackpot_optins` table (opted_in_at / opted_out_at) | Same lifecycle shape as player limits and the pipeline's `cdc_jackpot_optins` |
| Contribution %, win probability, seed, game id, magic number | `OPERATOR_JACKPOT` + `GAME_TYPE_CODES` **config** in `engine.py` | Product parameters are data, not code |
| The pool | **Derived**: `seed + Σ contributions − Σ wins` over recorded rounds | Same principle as the wallet; nothing to keep in sync, can't go negative |
| Contribution + draw | One engine function called after each cash casino round | The mechanics exist once, whatever game triggered them |
| The win popup | A `jackpot` flash category + a little CSS | Presentation only |
| Money integrity | **Nothing** — contributions/wins are ordinary cash rounds | The wallet, loss limits, SAFE submission and the reconciliation all pick them up untouched |

That last row is the headline: the jackpot feature required **zero changes**
to the wallet derivation, the loss-limit query, the submission engine's
delivery loop, or the financial reconciliation — because contributions and
wins were modelled as what they financially *are*: gaming rounds.

## The legacy comparison (the point of this exercise)

| Step | Legacy (per market × 17) | This architecture (once) |
|---|---|---|
| Sessions | New columns + triggers on every play table per estate; timeout logic duplicated in procs and app code | One table, one stamp on the round writer, one report element |
| Pool accounting | A `JackpotPool` balance table updated by triggers — and a reconciliation headache when a trigger misfires | Derived from the recorded rounds; provably consistent |
| Contribution mechanics | Percentage hard-coded per estate; drift between markets | One config block |
| Regulator visibility | Per-market file format changes ×17 | `SessionId` + `GameType` added to one record builder |
| "What is this 7077 game?" | Tribal knowledge | A configurable magic number, documented in config, deducible from the data |
| Month-end | Jackpot payouts explained by spreadsheet | Already inside the settlement view; residual still 0.00 |

## How you can see it work

1. Run the site, log in as `demo` — you now have a **gaming session** (visible
   on the admin player view).
2. Account page → **Operator jackpot** card → *Opt in*. The casino lobby now
   shows the live pool.
3. Play slots a few times: each spin records a 1%-of-stake
   `operator-jackpots` contribution round alongside it, and the pool ticks
   up. Somewhere around one-in-twenty plays: **🎰 the celebration flash** —
   the full pool lands in your balance, and a win round is recorded.
4. The SAFE's gaming XML for every round now carries `<SessionId>` and
   `<GameType>` — jackpot rounds show the magic number **7077**.
5. Admin → Financial reconciliation → Generate: contributions sit in
   settlement GGR, the win nets off, residual **0.00 RECONCILED** — with no
   reconciliation code changed for this feature.
