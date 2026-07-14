# Requirement: Session tracking — platform sessions, per-game sessions, and the operator-jackpot collision

| | |
|---|---|
| Requirement id | **ST** (session-tracking) — individual items REQ-ST-1 … REQ-ST-8 |
| Scope | The reporting pipeline (`dataform-example/`), the regulator format layer (`dataform-website/regulator_formats/`), and the demo stack (BetNova site, submission engine, SAFE) |
| Status | **Proposed — not yet implemented.** These documents are the work order; [implementation.md](implementation.md) is the step-by-step plan and gains the requirement → artifact trace as it lands |
| Companion docs | [overview.md](overview.md) (what & how) · [implementation.md](implementation.md) (the plan) · precedent: [operator-jackpots](../operator-jackpots/requirements.md) (which minted the demo's gaming sessions) |

## Background / regulatory context

A **session** exists from the moment a player logs in to the website and
ends when the player logs out **or is disconnected by an inactivity
timeout**. The demo already mints these (REQ-OJ-1: login creates a
`GS-…` id, logout ends it `LOGOUT`, inactivity ends it `INACTIVITY`, and
every gaming play is stamped with its session). What is missing is
sessions as a **first-class reported entity** with per-regulator
semantics — and one genuinely hard semantic collision.

**The collision.** The operator jackpot
([operator-jackpots](../operator-jackpots/requirements.md)) is a
**standalone game** the operator provides: players opt in, it has **no
UI of its own**, and it exists only to take contributions from players'
casino stakes so they can win a pooled prize while playing other games.
Under a *platform* notion of session (one session per login) this is
invisible. But several regulators define sessions **per game** and do
not allow two games to share one session:

- The Netherlands' CDB `WOK_Game_Session_v1.11` carries exactly **one
  `Game_ID`** per session record
  (`docs/regulator/nl/wok_game_session_v1.11.xsd`) — a session spanning
  a slots game *and* the operator-jackpot game is structurally
  inexpressible.
- The Dutch gambling-tax reporting to the tax authority (the
  **kansspelbelasting (KSB) GAT report**) likewise requires
  session-level figures on a single-game basis. *(Requirement as stated
  by the business; the GAT layout and its legal citation must be pinned
  against the Belastingdienst specification during implementation — the
  same pin-to-primary-sources discipline as tax rates.)*

So an opted-in player spinning slots generates activity in **two**
games at once (SLOTS and OJACK), and single-game-session regimes need
that reported as **two parallel game sessions** derived from the one
login. Other sampled regimes want the *platform* session itself (PT's
`SESS_` LOGIN/LOGOUT events, GR's `Online_Log_In_Sessions`, FR's
`IDSession` header field), and ES nests per-game blocks inside one
session record. Session semantics are therefore **per-market variance —
i.e. config** — and the mechanism must be retrofittable to every
jurisdiction that requires session-level reporting.

## The requirements

**REQ-ST-1 — Platform sessions are the source of truth.** One platform
session per login: minted at login, ended by logout (`LOGOUT`) or by an
inactivity timeout (`INACTIVITY`), with the timeout minutes **config,
not code**. Every gaming action is stamped with its platform session
(already the case); the session lifecycle lands in the pipeline as a
CDC source (`cdc_gaming_sessions`) like any other event stream.

**REQ-ST-2 — Session reporting as configuration.** A market opts into
session reporting via a `sessionReporting` block on its
`jurisdictions.js` entry — granularity (`platform` or `per_game`),
timeout policy, end-reason vocabulary, whether zero-activity sessions
are reported — exactly as the gaming domain opts in via
`gamingNomenclature`. Markets without the block get no session tables.
No `if (market === …)` anywhere.

**REQ-ST-3 — Per-game sessions are derived, never double-entered.**
For `per_game` granularity, game sessions are **derived** from the
platform session plus the activity stamped with it: one game session
per (platform session × game), starting at that game's first play and
ending at its last (or at platform-session end). Derivation follows the
repo's state-from-events rule — the OLTP stores platform sessions and
stamped activity only; the per-game split is a model, so a regulator
changing granularity is a config change, not a schema migration.

**REQ-ST-4 — The operator-jackpot shadow session.** Because the
operator jackpot is a distinct game, its contributions and wins form
**their own derived game session** (per platform session) under
`per_game` granularity — the "shadow session" that runs parallel to the
casino game sessions from the same login. The invariant that makes
NL/KSB-GAT expressible: **no game session ever references more than
one game.** Under `platform` granularity the jackpot activity simply
stays inside the one session.

**REQ-ST-5 — Session integrity as declarative rules.** New rules,
compiled to assertions like every other constraint: every activity
timestamp falls within its session's [start, end]; at most one open
platform session per player; no activity stamped on an ended session;
end reason within the configured vocabulary; and — the load-bearing
one — the **single-game invariant** on derived game sessions, with a
negative test proving a jackpot contribution mis-stamped into a slots
game session is caught.

**REQ-ST-6 — Sessions on the wire.** A `sessions` record type flows
through the submission engine and SAFE, serialised by the mapping
specs where the regulator defines a session record: NL's
`WOK_Game_Session_v1.11` moves from the current per-round
simplification to true per-game sessions (rounds counted, transactions
listed, one `Game_ID` each); PT emits `SESS_` LOGIN/LOGOUT records; the
KSB GAT session figures are produced from the same derived model
(format pinned per the note above).

**REQ-ST-7 — Retrofit path.** Any jurisdiction later found to require
session-level reporting is onboarded by adding its `sessionReporting`
config block and (if it has a session wire format) a mapping-spec
record — no engine, model or demo code changes. The scenario must
demonstrate this by enabling at least two markets with **different**
granularities from day one.

**REQ-ST-8 — Demo end-to-end.** In BetNova: login/logout and the
inactivity timeout visibly create and close sessions; an opted-in
player's casino play produces the parallel operator-jackpot shadow
session; the SAFE receives the session records for the enabled markets;
and the session ↔ activity linkage is inspectable (every gaming record
still carries its session id).

## Out of scope

- **Sports-betting sessions**: the sampled session regimes are
  gaming/login-scoped; bets remain linked to logins where a format
  carries it (FR `IDSession`) but no betting-session entity is derived.
- **Greece's taxation sessions** (24-hour-capped fiscal periods) — a
  related but distinct fiscal construct, catalogued in
  `docs/regulator/gr/gr-data-model.md`, worth its own scenario.
- **The exact KSB GAT layout** and its legal citation (production
  pinning; the requirement here is the single-game session semantics it
  imposes).
- Cross-device session reconciliation and concurrent-login policy
  beyond "one open platform session per player".

## Acceptance criteria

1. `npm run check` green, including new session expectations and TWO
   negative tests: the single-game invariant (a jackpot contribution
   forced into a slots game session fires the assertion) and the
   activity-outside-session-window rule.
2. Emitted SQL contains session tables **only** for markets with
   `sessionReporting`, at the configured granularity; no other market's
   files change.
3. The derived per-game sessions for an opted-in player's login show
   the casino game session(s) **plus** the operator-jackpot shadow
   session, each with exactly one game, and their union reconciling to
   the platform session's activity.
4. In the demo, NL receives `WOK_Game_Session_v1.11` records at true
   per-game-session grain (single `Game_ID`, rounds counted) and PT
   receives `SESS_` LOGIN/LOGOUT records, both proven by golden files —
   NL's against the vendored KSA XSD.
5. A timeout-ended session reports its end reason distinctly from a
   logout-ended one, in both the pipeline tables and the wire records.
