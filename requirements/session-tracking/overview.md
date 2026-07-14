# Session tracking — overview

*Companion to [requirements.md](requirements.md) (the ask) and
[implementation.md](implementation.md) (the step-by-step plan). Builds
directly on [operator-jackpots](../operator-jackpots/overview.md), which
minted the demo's platform sessions and stamped every play with one.*

## What this adds

Sessions today are demo plumbing: minted at login, ended by
logout/inactivity, stamped onto plays, echoed as `<SessionId>` on SAFE
gaming records. This scenario promotes them to a **reported regulatory
entity** — and resolves the one place where the platform's product
design and a regulator's data model genuinely fight each other.

**The fight.** The operator jackpot is a *game with no UI*: opted-in
players contribute from every casino stake and can win the pool. To the
player it's a feature of slots/blackjack; to the regulator it's what the
pipeline already says it is — a **standalone licensed game** (canonical
`OJACK`, MGA Type 1, phantom game `OJ1`). Now add the Netherlands: the
CDB's `WOK_Game_Session_v1.11` carries exactly one `Game_ID`, and the
gambling-tax KSB **GAT** report needs the same single-game session
basis. One login where an opted-in player spins slots is therefore *two*
games' activity — and must become **two parallel game sessions**, one of
them for a game the player never saw.

The resolution is the repo's standing instinct — **derive state from
events, keep variance as data**:

```
platform session (stored: login → logout/timeout, the source of truth)
  ├── activity stamped with the platform session (already the case)
  └── per-game sessions (DERIVED, only for markets configured per_game)
        ├── GS-17 × SLOTS   : first spin → last spin      (Game_ID: slots)
        ├── GS-17 × BLKJ    : first hand → last hand      (Game_ID: blackjack)
        └── GS-17 × OJACK   : first contribution → last   (the SHADOW session)
```

No game session ever holds two games (the NL/GAT invariant, enforced by
an assertion with a negative test); nothing is stored twice (a
granularity change is a config edit, not a migration); and markets that
want the *login* itself (PT `SESS_`, GR log-in sessions) read the stored
platform sessions directly.

## Where it lands

| Concern | Layer | Why |
|---|---|---|
| Which markets report sessions, at what granularity, timeout, end reasons | `includes/jurisdictions.js` → `sessionReporting` block | Variance is data; absent block = no session tables (the gaming-domain opt-in pattern) |
| Session lifecycle source | `cdc_gaming_sessions` landing + staging | The demo's `gaming_sessions` table already mirrors this shape |
| Platform-session fact + per-game derivation | `includes/models.js` (`fct_platform_sessions`, `fct_game_sessions`) | Derived from stamped activity — one derivation for all markets |
| Session field expressions | `includes/fields.js` session registry | One SQL definition per measure (rounds, staked, won, start/end, end_reason) |
| Integrity rules incl. the single-game invariant | market `rules` + `includes/rules.js` | Every constraint declarative, assertion-compiled, negative-tested |
| Fan-out `submission_sessions_{mkt}` | `definitions/30_submissions/sessions.js` | New tables = new wiring file (the one manual definitions step) |
| Shadow-session emergence | nothing new — OJ contributions are already stamped gaming activity of game `OJ1` | The derivation *discovers* the OJ session; no special-case code |
| Wire formats | `regulator_formats/specs/` (NL Game_Session regrained; PT `SESS_`) + a `sessions` record type in submission engine + SAFE | Same mapping-engine discipline, golden files + XSD gates |
| Demo visibility | BetNova account/admin pages showing sessions and their end reasons | See the timeout and the shadow session without slides |

## Legacy comparison

| | Legacy (per-market stored procs) | This architecture |
|---|---|---|
| Add session reporting for NL | A new extract proc walking the play log, hand-splitting per game; jackpot handled by special-case `IF` | One config block; the derivation treats OJACK like any other game |
| The jackpot/session collision | Discovered by regulator rejection; patched per market | An invariant assertion with a negative test, before anything ships |
| A regulator changes granularity | Rewrite the proc | Flip `granularity` in config; same stored facts |
| Retrofit to a tenth market | Copy-adapt the closest proc | Add the config block (+ a spec record if it has a wire format) |

## The key design decisions

1. **Platform sessions are stored; game sessions are views.** The OLTP
   knows only "logged in → played → logged out/timed out". Per-game
   splitting — including the shadow session — is a derivation, so the
   same events serve `platform` regimes (PT, GR, FR) and `per_game`
   regimes (NL, KSB GAT) simultaneously, and the retrofit path
   (REQ-ST-7) is pure config.
2. **The shadow session falls out of existing data.** Operator-jackpot
   contributions are already recorded as gaming rounds of the phantom
   game `OJ1`, stamped with the platform session (REQ-OJ-2/8). The
   per-game derivation groups by game — so the OJACK session *emerges*
   from the same GROUP BY that produces the slots session. The scenario
   adds an invariant and wire formats, not a parallel bookkeeping
   system.
3. **NL's gaming record moves to its true grain.** The current NL spec
   maps one `WOK_Game_Session` per *round* (a declared simplification).
   With real derived sessions it regrains to one record per game
   session — rounds counted, transactions listed, single `Game_ID` —
   which is what the KSA schema meant all along. This is the scenario's
   riskiest edit (record keys and receipts change grain for NL gaming)
   and gets its own implementation step and golden-file diff.
4. **The GAT requirement is carried as stated, flagged for pinning.**
   The business states the Dutch KSB GAT report needs single-game
   session figures; the architecture work (the invariant + derivation)
   is identical whichever way the layout pins, so implementation
   proceeds while the citation is obtained — the same posture as
   illustrative tax rates.
