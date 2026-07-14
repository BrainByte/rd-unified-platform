# Session tracking — implementation

*Step-by-step record of how [requirements.md](requirements.md) was
implemented. Written ahead as the work order and executed as planned —
§ "As implemented" records where reality amended the plan. Every change
site carries a grep-able `REQ: requirements/session-tracking` comment.
Precedents followed: [operator-jackpots](../operator-jackpots/implementation.md)
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

## As implemented — amendments to the plan

The plan executed as written; reality added these findings:

1. **ST-204 was made enforceable, not tautological.** A naive
   GROUP BY (session, game) can never violate the single-game invariant.
   The pipeline materialises the pre-aggregation set
   (`fct_game_session_activity`, activity + a derived
   `game_session_id` = session×game key) and `fct_game_sessions` groups
   by the **derived key alone** — so a mis-stamp genuinely collides two
   games into one session, and the negative test proves ST-204 catches
   exactly that.
2. **No sessions watermark row** (plan A2 left this open): the readiness
   gate consumes watermarks only for the betting settlement source; the
   gaming domain — the direct precedent — has no watermark, and sessions
   follow it. Extending readiness gating to non-betting domains is a
   pre-existing gap shared with gaming, documented in the wiring
   comments rather than half-built here.
3. **Session stamping is a universal datum**, widening the shared feeds
   (the `date_of_birth` precedent) rather than riding the extension
   carrier; provider session echo is provider variance as config
   (`sessionRef` in `providers.js`), with NULL = unstamped legacy rows
   that never enter the derivation.
4. **The timeout close is data-driven in the demo engine**: the
   submission pass first ends stale open sessions at
   `last_activity + timeoutMinutes` as `INACTIVITY` (per-market config),
   proven by inserting a 2-hour-stale session and watching it close and
   file.
5. **INACTIVITY on the wire**: PT's `tipo_log` knows only LOGIN/LOGOUT,
   and the NL Game_Session record has no end-reason field — the reason
   is reported distinctly wherever a schema carries it and always in the
   pipeline tables/submission log (acceptance 5 as amended, honestly).
6. **NL regrain landed as designed**: per-round NL gaming deposits
   stopped (rounds logged `VIA-SESSION`), `WOK_Game_Session` records now
   carry real round counts and `Game_Transactions` lists with the same
   deterministic `Transaction_ID`s as the old per-round stream, and the
   reconciliation completeness expects sessions instead of rounds for
   `gaming_via_sessions` markets.

Verification results — pipeline (`npm run check` green): **145/145 unit
tests, 82 models, 139 rule assertions, 72 expectations, 21 negative
tests** (before: 135/76/132/66/19); genuine Dataform compile **277
actions / 82 datasets**; session tables exist only for NL and PT (pinned
by expectation). Demo suites: NL 9/9 byte-identical **+ 2/2 session
goldens valid against the vendored KSA schema** (the shadow session
validates); PT 11/11 goldens + 11/11 gazette-valid (incl. `SESS_`);
ES 10/10 and FR 12/12 + 9/9 untouched. Live: one opted-in NL login
produced `GS…-SLOTS` **and** `GS…-operator-jackpots` session files (no
per-round NL gaming files); PT produced its `SESS_` LOGIN/LOGOUT file;
a 2-hour-stale session closed as `INACTIVITY` and filed; NL and PT
reconciliations both residual 0.00 with the session-aware completeness.

## Requirement → artifact trace

| Requirement | Implemented by | Proven by |
|---|---|---|
| REQ-ST-1 platform sessions as source | `cdc_gaming_sessions` + `stg_` + `fct_platform_sessions`; demo timeout close in `submit_pending_sessions` | expectations; live INACTIVITY close + filing |
| REQ-ST-2 reporting as config | `sessionReporting` blocks (NL per_game, PT platform) + validator + `sessionSubmissionQuery` | emit-sql/expectation: session tables only for NL+PT; 10 new unit tests |
| REQ-ST-3 derived per-game sessions | `fct_game_session_activity` + `fct_game_sessions` | expectation: union of game sessions = platform activity |
| REQ-ST-4 shadow session | no special-case code — the derivation | expectation + live: opted-in login yields slots + OJACK sessions, single-game each |
| REQ-ST-5 integrity rules | RULE_TYPES `activity_within_session`, `single_open_session`, `end_reason_in_set`, `single_game_session`; ST-201..204 | two negative tests (mis-stamped OJ contribution fires ST-204; out-of-window play fires ST-201) |
| REQ-ST-6 sessions on the wire | NL `sessions` spec record (Game_Session regrain, rounds VIA-SESSION) + PT `SESS_` + demo `sessions` record type + recon regrain | NL session goldens vs KSA XSD; PT golden vs gazette XSD; live SAFE files; NL/PT recon 3/3 |
| REQ-ST-7 retrofit path | config-only enablement, two granularities live from day one | a third market = one `sessionReporting` block (+ spec record if it has a wire format) |
| REQ-ST-8 demo end-to-end | sessions in the polling loop + SAFE `sessions` type | live drive: logout and timeout sessions filed; shadow session in the SAFE |
