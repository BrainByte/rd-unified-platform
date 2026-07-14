# Session tracking — implementation plan

*Step-by-step plan for [requirements.md](requirements.md).
**Status: not yet implemented** — written ahead as the work order; as
each part lands it gains its `REQ: requirements/session-tracking`
change-site comments and the trace table moves from *planned* to
*proven*. Precedents: [operator-jackpots](../operator-jackpots/implementation.md)
(sessions minted, plays stamped), [dgoj-periodic-reporting](../dgoj-periodic-reporting/implementation.md)
(a new report *kind* as config + one builder + one wiring file), and the
FR/PT onboardings (mapping-spec + golden/XSD discipline).*

## Part A — the pipeline (`dataform-example/`)

**A1. Config (REQ-ST-2).** `includes/jurisdictions.js`: a
`sessionReporting` block on the markets that report sessions, enabling
two granularities from day one (REQ-ST-7):

```js
// NL — single-game sessions (CDB Game_Session + the KSB GAT tax report)
sessionReporting: {
  granularity: "per_game",          // platform | per_game
  timeoutMinutes: 30,               // inactivity disconnect (config, not code)
  endReasons: ["LOGOUT", "INACTIVITY"],
  reportEmptySessions: false,       // login with no play
  rules: [ /* ST-2xx declarative rules, see A4 */ ],
},
// PT — the login itself is the reported entity (SESS_ LOGIN/LOGOUT)
sessionReporting: { granularity: "platform", timeoutMinutes: 30, ... },
```

Validator additions (`includes/validate.js`): known granularity,
positive timeout, end-reason vocabulary non-empty, rules valid against
the session columns.

**A2. Source + staging (REQ-ST-1).** `cdc_gaming_sessions` declaration
(the demo's `gaming_sessions` table is already the OLTP mirror:
session_id, account_id, started_at, last_activity_ts, ended_at,
end_reason) + `stg_gaming_sessions` dedupe, plus its
`cdc_source_watermarks` coverage — the documented fail-closed trap
applies to sessions like any other source.

**A3. Models (REQ-ST-1/3/4).** `includes/models.js`:

- `fct_platform_sessions` — the stored lifecycle, with derived measures
  from the stamped activity (plays, staked, won, first/last activity).
- `fct_game_sessions` — the `per_game` derivation: activity stamped
  with a platform session, grouped by (platform_session, game); start =
  MIN(play ts), end = MAX(play ts) (platform end where the regulator
  wants wall-clock close), one row per game — **the operator-jackpot
  shadow session emerges here** because `OJ1` contributions are already
  stamped gaming activity of their own game. No OJACK-specific SQL.

**A4. Rules (REQ-ST-5).** Session rule set compiled to assertions:

- `ST-201 activity_within_session` — every stamped play inside
  [start, end] (small new rule type or `dateColumn`-style reuse);
- `ST-202 single_open_session` — at most one open platform session per
  player;
- `ST-203 end_reason_in_set` — vocabulary from config;
- `ST-204 single_game_session` — **the invariant**: no
  `fct_game_sessions` row aggregates more than one game (structurally a
  COUNT(DISTINCT game) = 1 assertion over the pre-aggregation set).

Negative tests (`local/run.js`): (1) a corrupt copy stamping an OJ1
contribution into a slots game session fires ST-204; (2) a play
timestamped after its session's end fires ST-201.

**A5. Fan-out + expectations (REQ-ST-2/3).**
`definitions/30_submissions/sessions.js`: `submission_sessions_{mkt}`
per configured market at its granularity (NL per-game rows incl. the
shadow session; PT platform rows with end reasons). Expectations pin:
the opted-in seed player's login yields slots + OJACK sessions whose
union equals the platform session's activity (acceptance 3); a
timeout-ended vs logout-ended session pair (acceptance 5). Seed
additions: an NL account with opted-in casino play and an
inactivity-ended session; PT already has session-bearing seed.

**A6. Verify.** `npm run check` green; emit-sql diff shows session
tables only for configured markets.

## Part B — the regulator formats (`dataform-website/regulator_formats/`)

**B1. NL regrain (REQ-ST-6; the risky step).** The NL spec's gaming
mapping moves from one `WOK_Game_Session_v1.11` per *round* to one per
**derived game session**: `Game_ID` = the game (uuid5, as today),
`Game_Session_ID` = the derived session, `Game_Session_Rounds` /
`Rounds_Won` = real counts, `Game_Transactions` = the session's rounds.
Consequences handled explicitly: the canonical `gaming` record for NL
becomes session-grained (a new `sessions`-fed canonical stream rather
than the per-round one), record keys and receipts change grain for NL
gaming, and the golden suite is regenerated with a reviewed diff.
`test_nl_spec.py` byte-identity for the *other* record types must stay
green; the gaming golden is versioned as the new grain against the
vendored KSA XSD.

**B2. PT `SESS_` (REQ-ST-6).** `specs/pt_v1.py` gains the `sessions`
record type: the `ficheiro` envelope wrapping `registos_sessao` with
LOGIN and LOGOUT rows (player code, `id_sessao`, action timestamp,
`tipo_log`, `dispositivo` — device defaults declared). Golden +
gazette-XSD validation via the existing `test_pt_spec.py` harness
(`SESS.xsd` is already transcribed and validated in
`docs/regulator/pt/derived/`).

**B3. KSB GAT placeholder (REQ-ST-6).** A `gat` mapping is **not**
built until the Belastingdienst layout is pinned; the derivation feeding
it (per-game sessions with staked/won figures) is proven by A5's
expectations, so the spec becomes a pure addition later — the point of
the architecture.

## Part C — the demo stack (`dataform-website/`)

- `submission.py`: a `sessions` record type — pending = ended sessions
  not yet submitted (key `session_id`; sessions never re-open, so no
  state-suffixed re-reporting is needed); canonical dict carries
  start/end/reason/device and, for per-game markets, the derived
  per-game rows (the demo derives them with one SQL over `game_rounds`
  grouped by session × game — the same shape as A3).
- `safe.py`: `"sessions"` appended to `RECORD_TYPES` (endpoints and
  folders fan out automatically).
- `engine.py`: session minting/timeout already exists (REQ-OJ-1);
  surface end reasons on the account/admin pages if not already
  visible.
- `MARKETS`: `sessions` enabled per market mirroring `sessionReporting`
  (NL per_game, PT platform); other markets log nothing.
- Reconciliation: sessions are not money — no recon arm; the
  completeness check gains the sessions record type only for enabled
  markets (the FR gaming-scope precedent).

## Part D — verification (acceptance criteria)

1. `npm run check` with the new expectations and both negative tests.
2. `test_nl_spec.py` (regrained gaming golden vs the KSA XSD) and
   `test_pt_spec.py` (SESS_ golden vs the gazette schema) green; ES/FR
   suites untouched.
3. Live demo: log in as an opted-in NL player, spin slots, let the
   session time out (simulated clock, as the max-stake-limits scenario
   did) — the SAFE shows the slots game session AND the OJACK shadow
   session, each single-game, end reason `INACTIVITY`; a PT login/logout
   produces the `SESS_` pair.
4. `reset_db.py` before the final commit.

## Planned requirement → artifact trace

| Requirement | Planned artifact | To be proven by |
|---|---|---|
| REQ-ST-1 platform sessions as source | `cdc_gaming_sessions` + `fct_platform_sessions` | expectations; watermark coverage |
| REQ-ST-2 reporting as config | `sessionReporting` blocks + validator | emit-sql: session tables only for configured markets |
| REQ-ST-3 derived per-game sessions | `fct_game_sessions` | expectation: union of game sessions = platform activity |
| REQ-ST-4 shadow session | no special-case code — the derivation | expectation: opted-in login yields slots + OJACK sessions |
| REQ-ST-5 integrity rules | ST-201..204 assertions | two negative tests (ST-204 mis-stamped contribution; ST-201 out-of-window play) |
| REQ-ST-6 sessions on the wire | NL Game_Session regrain + PT `SESS_` + demo `sessions` record type | goldens incl. NL vs KSA XSD, PT vs gazette XSD; live SAFE files |
| REQ-ST-7 retrofit path | config-only enablement, two granularities live | adding a third market in review = one config block |
| REQ-ST-8 demo end-to-end | session pages + live drive | timeout vs logout visible; shadow session in the SAFE |
