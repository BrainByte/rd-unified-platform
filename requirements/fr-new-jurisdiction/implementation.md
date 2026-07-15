# France (FR) new jurisdiction — implementation

*Step-by-step record of how [requirements.md](requirements.md) was
implemented, following [`how-to.md`](../../how-to.md) § 7. Written ahead
as the work order and executed as planned — § "As implemented" records
where reality amended the plan. Every change site carries a grep-able
`REQ: requirements/fr-new-jurisdiction` comment. The regulator model is
analysed in
[`docs/regulator/fr/fr-data-model.md`](../../docs/regulator/fr/fr-data-model.md).*

## Part A — the pipeline (`dataform-example/`)

**A1. Config (REQ-FR-1/2/3/7).** `includes/jurisdictions.js`: add `FR`,
starting from ES (daily cadence, closed code lists) and adjusting:

- identity: `code: "FR"`, `dataset: "reporting_fr"`, `currency: "EUR"`,
  `rounding: 2`, `timezone: "Europe/Paris"`,
  `addressValidation: { postcodePattern: "^[0-9]{5}$" }`;
- reporting: `submissionCadence: "daily"`, `includeVoided: true` (ANNUL
  traces are first-class); `reportFields` on account-id identification
  (no hash — the sealed-vault regime reports clear identifiers), plus
  placement/settlement local times;
- nomenclature: closed `sportCodes` for the ANJ authorised list,
  `unmappedPolicy: "block"` (+ the enforcing `no_unmapped_fixtures`
  rule the validator insists on);
- tax: `taxModel: "ggr"` with an effective-dated `taxRate` schedule for
  betting (rates flagged illustrative pending pinning against the
  levy articles); poker basis on the gaming side (A2);
- `rules`: declarative constraints citing loi 2010-476 clause ids —
  settled/voided statuses only, zero payout on voided, stake sanity cap,
  valid sport code;
- `playerProtection`: `selfExclusionSources: ["OPERATOR", "NATIONAL"]`
  with `mandatoryRegister` (interdits de jeux),
  `withdrawalRequiresVerification: true`, statutory limit posture per
  legal review (player-set limits are mandatory at registration — the
  website already enforces offering them).

**A2. Gaming block — poker licensed, casino not (REQ-FR-2/3).**
`gamingNomenclature.gameCodes` maps **only** `POKC`/`POKT` (and no
`SLOT`/`ROUL`/`BLKJ`/`OJACK`), `unmappedPolicy: "block"` + the
`no_unlicensed_games` gaming rule — the ES precedent inverted: here the
whole casino vertical is unlicensed. `gamingTaxRate` as an
effective-dated schedule on the poker basis (stake-levied; if legal
review confirms a stakes basis, reuse the DE `turnover` mechanics for
the gaming tax arm). `gamingReportFields` as ES/MT.

**A3. Seed + watermark (REQ-FR-8, acceptance 5).** `seed/data.js`: one
FR account (French postcode, national id), address, fixtures/slips
covering settle **and** void, a deposit/withdrawal pair, poker gaming
activity, **and the `cdc_source_watermarks` row** — the documented
classic mistake; DE proved the fail-closed gate catches its absence
(`WAITING_DATA`), and the FR onboarding should re-prove it deliberately
before adding the watermark. Regenerate `seed/bigquery_setup.sql`.

**A4. Expectations + negative tests.** `local/expectations.js`: FR
submission file contents (voids present with status), tax summary on the
FR rates, and gaming file containing poker only. Negative test: seed a
French SLOTS round in a corrupt copy → `no_unlicensed_games` (or the
unmapped-queue block) must fire.

**A5. Validator + emit-sql.** No validator changes expected (all FR
config uses existing properties). `npm run check` green; the
`dataform-sql/` diff shows only added `*_fr` files.

## Part B — the regulator format (`dataform-website/regulator_formats/`)

**B1. FR lexical codecs (REQ-FR-5).** `engine.py` `CODECS` gains the FR
profile: `digits12-yy` (two-digit-year `AAMMJJHHMMSS`, no timezone) and
whatever the XSD analysis pins for decimals (unconstrained, implicit
EUR — plain `money`-style works). Empty-element boolean flags need no
codec — `{"children": {}}` already emits an empty element conditionally
via `when`.

**B2. The FR spec (REQ-FR-4/5/6).** `specs/fr_v1.py`, pure data:

- a shared **trace header** constructor (operator id + vault id from
  `config`, per-record event identifiers via `uid`/`format`, player id,
  session, IP placeholders declared as such);
- record-type mappings that emit **document lists**:
  `bets → [PASPMISE, PASPGAIN]` for settled, `[PASPMISE, PASPANNUL]`
  for voided (variants on status); `payments → CPTEALIM|CPTERETRAIT`
  (variants on direction); `players → CJ` account traces; `gaming →` PO
  events for poker records only;
- **balance triplets** (avant/mouvement/après, cash and bonus) bound
  from new canonical fields (B4).

**B3. Multi-document capability (REQ-FR-4).** The one mechanism change:
a spec record type may declare `"documents": [...]`; `engine.bind`
returns the list and `submission.py`'s `_submit` deposits each document
with a suffixed record key (`S1001-MISE`, `S1001-GAIN`) and logs one
receipt per deposit. Single-document specs (NL/ES) are the degenerate
case — their behaviour is proven unchanged by the existing byte-identity
suites.

**B4. Canonical balance fields (REQ-FR-6).** The submission queries
already have `db.balance()`-style ledger access in the demo (and the
wallet ledger in the pipeline); FR bets/payments canonical dicts gain
`balance_before`/`balance_after` derived from the ledger at event time.
Demo simplification (current balance, not as-of) is declared in the
module, as the ES/GR placeholders are.

**B5. Proof.** `test_fr_spec.py`: golden files seeded from the
regulator's own examples (`docs/regulator/fr/xml/…` — adapted to demo
identifiers), plus XSD validation of generated traces against
`docs/regulator/fr/referentiel/xsd/` (the first market to exercise the
Option-B gate locally). No hand-written oracle module exists for FR —
the goldens and the XSDs *are* the oracle, as the architecture doc
prescribes for new markets.

## Part C — the demo stack (`dataform-website/`)

Per how-to § 7 step 5, all data edits:

- `engine.py` — `JURISDICTIONS["FR"]` (name "France (ANJ)", postcode
  hint `75001`); no `SLOTS_STAKE_LIMITS` entry;
- `submission.py` — `MARKETS["FR"] = {include_voided: True,
  hashed_ref: False}`;
- `safe.py` — append `"FR"` to `JURISDICTIONS` (endpoints, WSDL, folders
  and the status page expand automatically);
- `reconciliation.py` — `TAX_RATES`/`TAX_BASIS`/`BONUS_STAKE_POLICY`
  entries for FR;
- registration template — only if markets are listed there (they come
  from `engine.JURISDICTIONS`).

Demo casino note: the website offers slots/blackjack to every market;
the *pipeline* blocks them from FR files (A2). The demo submission
engine mirrors that by mapping only POKER rounds to FR traces and
logging other FR rounds as suppressed — the same pattern as
`SUPPRESSED-VOID`.

## Part D — verification (acceptance criteria)

1. `npm run check` — unit tests, demo compile, offline pipeline with the
   new FR expectations and the unlicensed-game negative test, emit-sql.
2. `python test_fr_spec.py` (goldens + XSD validation), plus
   `test_nl_spec.py` / `test_es_spec.py` unchanged-behaviour proof.
3. Live demo: reset, run, register a French player, deposit, bet,
   settle, void one slip, play poker — then confirm
   `dataform-safe/FR/bets/` holds the MISE **and** GAIN traces (and a
   MISE+ANNUL pair for the void), `FR/payments/` the CPTEALIM,
   `FR/players/` the CJ trace, `FR/gaming/` the PO trace; slots rounds
   produce no FR trace.
4. FR reconciliation PDF: residual 0.00, completeness green.
5. `reset_db.py` before the final commit (the committed DuckDB stays the
   pristine seed).

## As implemented — amendments to the plan

The plan executed as written; reality added five findings:

1. **The XSD gate found real defects in the first pass** — exactly its
   job: `Renc`/`Part` are the uppercase-only `canonique` type (fixed
   with a `fr-canonique` sanitising codec), `TypeRes` has a 5-char
   minimum (`RES1X2`), `Motif` is a closed enumeration (demo void
   reasons degrade to `Autre`), and `OUVINFOPERSO` requires the full
   identity block in sequence (mandatory fields now carry declared
   `NonRenseigne`-style placeholders — the demo captures no identity at
   registration). After fixes: **9/9 validated goldens** (`xmlschema`,
   added to `requirements.txt`).
2. **The regulator's own PO draft schema does not compile** —
   `cercle.xsd` references an undeclared `poker` namespace prefix — so
   the PO family is excluded from the validation gate with that
   documented reason. A vendored-schema defect a validation gate exists
   to surface.
3. **The watermark WAITING_DATA trap was re-proven deliberately**: with
   everything except the `cdc_source_watermarks` row, config validated
   and assertions passed but the FR betting file and tax summary shipped
   empty, with A10001 held `COMPLETENESS / WAITING_DATA` — the DE
   onboarding's fail-closed behaviour, reproduced before adding the row.
4. **Decisions the docs left open** (all commented in config):
   `jackpotPolicy: "gross"` (validator-required, moot — OJACK is
   blocked); `mandatoryRegister: "NATIONAL"` (the ANJ *fichier des
   interdits de jeux*); `gamingTaxRate` kept a GGR-basis constant with
   the stakes-basis pinning flagged; sport/game code labels illustrative.
5. **Demo simplifications, declared in code**: balance triplets derive
   from the current ledger balance (no as-of view); a re-reported void
   deposits a second MISE alongside its ANNUL; golden-chip rounds move
   the cash triplet by winnings only.

Verification results: `npm run check` green — **135/135 unit tests, 72
models, 114 rule assertions, 60 expectations, 17 negative tests**;
emit-sql diff additive only (4 FR tables + 18 FR assertions, no other
market's files changed). Demo suites: FR **12/12 goldens + 9/9 XSD**,
NL 9/9 and ES 10/10 byte-identical (engine changes regression-free).
Live: registered `amelie_fr`, deposited, one bet won (MISE+GAIN), one
voided (MISE+ANNUL re-report), poker round (ACHAT), slots round
suppressed as unlicensed; FR reconciliation residual 0.00, reported 5/5.

## REQ-FR-9 — session attribution (added 2026-07-15)

[requirements.md](requirements.md) REQ-FR-9 arrived after the original
onboarding: player-instigated traces carry the player's current session
in `IDSession`; operator actions carry `0-sys`. The regulator's own
examples already behave this way (`PASPMISE7.xml` carries
`<IDSession>638604</IDSession>`) — the first implementation had
hard-coded `0-sys` on every header, a deviation this removes.

**E1. OLTP session stamps.** `db.py` gains `bet_slips.session_id` and
`payments.session_id` (the session the player placed/requested in) and
`accounts.signup_session_id`; `app.py` stamps them from the live
request's `g.session_id` (blocked/held attempts included), and
registration now mints its session *before* the account row is written
so the signup is stamped, never inferred. `game_rounds.session_id`
already existed (REQ-OJ-2). Stamp-at-write is the state-from-events
rule on the wire: the serialiser never reconstructs a session.

**E2. Canonical dicts.** `submission.py`'s bets/payments/players
queries and record dicts gain `session_id` (players: the signup
session).

**E3. The spec.** `specs/fr_v1.py`: MISE/ALIM/RETRAIT/OUV drop the
`0-sys` override and take the header default
(`{"from": "session_id", "fallback": "0-sys"}` — the fallback keeps
unstamped legacy rows serialisable); GAIN/ANNUL keep pinned `0-sys`
(paired with `Supervision`, as the samples do); IDENT pins `0-sys`
explicitly so it ignores the session the canonical record now carries.

**E4. Proof.** `test_fr_spec.py`: the player-instigated cases carry
sessions; the VERIFIED (IDENT) case carries one **to prove it is
ignored**; R7002's `None` session proves the fallback. Golden diff: 6
files, exactly one `IDSession` line each (12/12 match, 9/9 XSD-valid).
Live: one FR login (`GS1001`) produced 13 traces — every
player-instigated trace (3× MISE incl. the void's re-reported MISE,
POACHAT+POGAIN, ALIM, RETRAIT, OUV) carries `GS1001`; every operator
trace (2× GAIN, ANNUL, IDENT) carries `0-sys`. Acceptance criterion 6
satisfied.

**Ripple, intended.** PT's `AJOG_` bet sub-records bind `id_sessao`
from the same canonical field: previously the `"0"` fallback, now the
real session — so `id_sessao` joins the `SESS_` platform-session
records, matching the gazette's own `AJOG.sample.xml` (which carries a
real session id; the type is `xs:string`). PT bets fixtures + goldens
updated (11/11 goldens, 11/11 gazette-valid); NL and ES suites
byte-identical, no other market's goldens changed. The pipeline
(`dataform-example/`) is untouched — no FR reporting *file* carries a
session column; the session entity itself is
[session-tracking](../session-tracking/requirements.md) scope.

## Requirement → artifact trace

| Requirement | Implemented by | Proven by |
|---|---|---|
| REQ-FR-1 market as config | `jurisdictions.js` `FR` entry | validator clean; emit-sql diff additive only |
| REQ-FR-2 licensed verticals only | closed `sportCodes` / poker-only `gameCodes`, `block` policy; `gaming_verticals` in the demo `MARKETS` | negative test `frUnlicensedGameTest` (FR-201 fires); live slots round suppressed, absent from SAFE and recon |
| REQ-FR-3 tax model | effective-dated `taxRate` 0.549→0.593 (2025-07-01); recon `TAX_RATES` mirror | FR tax expectation (20 × 0.593 = 11.86 exact) |
| REQ-FR-4 event-grained traces | `documents` lists in `specs/fr_v1.py`; multi-deposit `_submit` with suffixed keys; suffix-tolerant recon match | live MISE+GAIN pair and MISE+ANNUL pair in `dataform-safe/FR/bets/`; NL/ES suites prove single-document behaviour unchanged |
| REQ-FR-5 format as mapping spec | `specs/fr_v1.py` + FR codecs (`digits12-yy`, `sha1-upper`, `fr-canonique`, `crc`) | `test_fr_spec.py`: 12/12 goldens, 9/9 XSD-valid (PO excluded, documented) |
| REQ-FR-6 balance triplets | `_balances()` in `submission.py` from the wallet ledger | goldens and live traces carry consistent avant/mouvement/après |
| REQ-FR-7 player protection | `playerProtection` config (NATIONAL register, verification-gated withdrawal) | existing breach-detector fan-out includes FR (assertion count +18) |
| REQ-FR-8 demo end-to-end | demo dict edits (engine/submission/safe/recon) + FR SAFE folder | live e2e; FR reconciliation residual 0.00, reported 5/5 |
| REQ-FR-9 session attribution | session stamps in `db.py`/`app.py` (E1); `session_id` on bets/payments/players canonical dicts (E2); `IDSession` bindings in `specs/fr_v1.py` (E3) | goldens 12/12 + 9/9 XSD (IDENT proven to ignore the record's session; `None` proves the 0-sys fallback); live: 13 traces from one login — player traces `GS1001`, operator traces `0-sys` |
