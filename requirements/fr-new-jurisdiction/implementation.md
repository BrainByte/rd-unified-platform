# France (FR) new jurisdiction — implementation plan

*Step-by-step plan for [requirements.md](requirements.md), following
[`how-to.md`](../../how-to.md) § 7. **Status: not yet implemented** —
this document is written ahead as the work order; as each part lands it
gains its `REQ: requirements/fr-new-jurisdiction` change-site comments
and the trace table at the end moves from *planned* to *proven*. The
regulator model is analysed in
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

## Planned requirement → artifact trace

| Requirement | Planned artifact | To be proven by |
|---|---|---|
| REQ-FR-1 market as config | `jurisdictions.js` `FR` entry | validator + emit-sql additive diff |
| REQ-FR-2 licensed verticals only | closed `sportCodes` / poker-only `gameCodes`, `block` policy | negative test: FR slots round blocked |
| REQ-FR-3 tax model | effective-dated `taxRate`/`gamingTaxRate` schedules | tax-summary expectation |
| REQ-FR-4 event-grained traces | `documents` lists in `specs/fr_v1.py` + multi-deposit `_submit` | live MISE+GAIN pair in `dataform-safe/FR/bets/` |
| REQ-FR-5 format as mapping spec | `specs/fr_v1.py` + FR codecs | `test_fr_spec.py` goldens + XSD validation |
| REQ-FR-6 balance triplets | ledger-derived canonical balance fields | golden files carry avant/mouvement/après |
| REQ-FR-7 player protection | `playerProtection` config | existing breach detectors' FR coverage in expectations |
| REQ-FR-8 demo end-to-end | five demo dict edits + FR SAFE folder | live e2e + FR reconciliation residual 0.00 |
