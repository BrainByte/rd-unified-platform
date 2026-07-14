# Portugal (PT) new jurisdiction — implementation plan

*Step-by-step plan for [requirements.md](requirements.md), following
[`how-to.md`](../../how-to.md) § 7 and the France precedent
([fr-new-jurisdiction/implementation.md](../fr-new-jurisdiction/implementation.md)).
**Status: not yet implemented** — written ahead as the work order; as
each part lands it gains its `REQ: requirements/pt-new-jurisdiction`
change-site comments and the trace table moves from *planned* to
*proven*. Sources: [pt-data-model.md](../../docs/regulator/pt/pt-data-model.md)
(gazette citations) and [docs/regulator/pt/derived/](../../docs/regulator/pt/derived/)
(the transcribed schemas).*

## Part A — the pipeline (`dataform-example/`)

**A1. Config (REQ-PT-1/3/7).** `includes/jurisdictions.js`: add `PT`
after `FR`:

- identity: `code: "PT"`, `dataset: "reporting_pt"`, EUR, rounding 2,
  `timezone: "Europe/Lisbon"`,
  `addressValidation: { postcodePattern: "^[0-9]{4}-[0-9]{3}$" }`;
- reporting: `submissionCadence: "daily"` (the daily package window),
  `includeVoided: true` (refund triplets / `total_reembolsos` are
  first-class); `reportFields` on clear account-id identification
  (full-KYC regime), stake/payout/ggr, sport code, event name, local
  times, `slip_status`;
- nomenclature: closed `sportCodes` (authorised competitions),
  `unmappedPolicy: "block"` + the enforcing rule;
- tax: `taxModel: "turnover"` (IEJO on fixed-odds stakes — the DE
  mechanics) with an illustrative effective-dated schedule (e.g. 8%),
  commented pin-to-primary-sources;
- rules PT-1xx citing RJO/Regulamento sections: `in_set` slip_status,
  `zero_when` payout on VOIDED, valid sport code, stake sanity cap;
- `playerProtection`: `defaultDepositLimits: null` (player-set deposit
  AND bet limits, daily/weekly/monthly — secção 5.3.2),
  `selfExclusionSources: ["OPERATOR", "NATIONAL"]` +
  `mandatoryRegister` (SRIJ lista de autoexcluídos),
  `withdrawalRequiresVerification: true`.

**A2. Gaming block — homologation (REQ-PT-2/3).**
`gamingNomenclature.gameCodes` maps the homologated portfolio to the
`AJOG_` sub-record families — `SLOT: "fortazar"`, `ROUL: "fortazar"`,
`BLKJ: "bjack"`, `POKC: "poker"`, `POKT: "poker"` — and **not** `OJACK`
(never homologated), `unmappedPolicy: "block"` + `no_unlicensed_games`
(PT-2xx). `gamingTaxRate` 0.25 on GGR (illustrative — the IEJO online-
games rate), proving the split-basis market: turnover betting + GGR
gaming in one entry. `jackpotPolicy` per validator requirement,
commented moot (OJACK blocked).

**A3. Seed + watermark (REQ-PT-8).** `seed/data.js`: one PT account
(NNNN-NNN postcode, NIF-style id), settled + voided slips, a completed
deposit, gaming rounds spanning at least two sub-record families
(slots→fortazar and poker), and the `cdc_source_watermarks` row.
Regenerate `seed/bigquery_setup.sql`.

**A4. Expectations + negative test (REQ-PT-2/3).** PT submission file
(settled + voided with status), tax summary proving **turnover basis**
on betting (stakes × rate, not GGR × rate) alongside the **GGR-based**
gaming tax, gaming file with the sub-record family codes. Negative
test: an OJACK contribution round in a corrupt PT copy must be blocked.
Update any global-count expectations the PT seed rows break.

**A5. Verify.** `npm test` → `npm run local` → full `npm run check`
green; emit-sql diff additive only.

## Part B — the regulator format (`dataform-website/regulator_formats/`)

**B1. Codecs.** Expected: **no new engine mechanism** (the overview's
point 3). PT timestamps are digit strings — `digits14` (file `datahr`,
`YYYYMMDDHH24MISS`) and `digits8` already exist; event timestamps with
fractional seconds/timezone (`.FF TZH:TZM`) may need one codec if the
derived schemas demand it; otherwise reuse.

**B2. The PT spec (REQ-PT-4/6).** `specs/pt_v1.py`, pure data:

- envelope: the common file header from `pt-common.xsd`
  (`cod_entexpl` operator code, `datahr` production datetime,
  `id_ficheiro` file id, `cod_cofre` GameVault code — config fixtures);
  one enveloped file per canonical record (declared demo simplification
  of the hourly batch);
- `players → JGDR_`: registration fields from the demo's canonical
  player dict (login, alias, NIF-style id, birth date, postcode);
  full-KYC fields the demo does not capture carry declared placeholders
  (the FR OUVINFOPERSO precedent);
- `payments → TRAN_`: `cod_optct` DEBITO/CREDITO by direction,
  operation timestamp, `saldo_ini`/`saldo_mov`/`saldo_fim` from the
  FR-built ledger balance fields;
- `bets → AJOG_` sport sub-record: event/odds/selection data plus the
  stake (`a_*`), winnings (`g_*`) and refund (`r_*`) balance triplets
  mapped from `_balances()`;
- `gaming → AJOG_` sub-record chosen by vertical (fortazar/bjack/poker);
  card-level and table-level detail the demo does not hold is omitted,
  declared.

**B3. Proof (REQ-PT-5).** `test_pt_spec.py`, the FR harness shape:
branch-covering canonical records → golden files (reviewed, frozen) →
**phase 2 validates every golden against
`docs/regulator/pt/derived/*.xsd`** — the transcribed gazette schemas as
oracle, with their derived-not-official status stated in the test
output. NL/ES/FR suites must stay green (engine unchanged or
regression-free).

## Part C — the demo stack (`dataform-website/`)

Per how-to § 7 step 5, all data:

- `engine.py` — `JURISDICTIONS["PT"]` (name "Portugal (SRIJ)", postcode
  hint `1000-001`);
- `submission.py` — `MARKETS["PT"] = {include_voided: True,
  hashed_ref: False}` (all demo verticals licensed — no
  `gaming_verticals` restriction, contrast FR);
- `safe.py` — append `"PT"` to `JURISDICTIONS`;
- `reconciliation.py` — `TAX_RATES` (illustrative IEJO), `TAX_BASIS`
  `"turnover"` for PT betting duty, `BONUS_STAKE_POLICY` "gross"
  (turnover regimes tax operator-funded stakes too — the DE precedent);
  note in the PDF that gaming duty at the GGR rate is a pipeline-side
  computation (the demo recon models one basis per market — declared
  simplification);
- registration template: automatic from `engine.JURISDICTIONS`.

## Part D — verification (acceptance criteria)

1. `npm run check` — with the PT expectations and the OJACK negative
   test.
2. `python test_pt_spec.py` (goldens + gazette-schema validation);
   NL/ES/FR suites unchanged-behaviour proof.
3. Live demo: reset, run, register a Portuguese player, deposit, bet,
   settle, void one slip, play slots + blackjack + poker — confirm
   `dataform-safe/PT/` holds enveloped `JGDR_`/`TRAN_`/`AJOG_` files
   for every branch.
4. PT reconciliation PDF: residual 0.00, completeness green.
5. `reset_db.py` before the final commit.

## Planned requirement → artifact trace

| Requirement | Planned artifact | To be proven by |
|---|---|---|
| REQ-PT-1 market as config | `jurisdictions.js` `PT` entry | validator + emit-sql additive diff |
| REQ-PT-2 homologation as nomenclature | closed maps, `block`, no OJACK | negative test: OJACK round blocked from PT |
| REQ-PT-3 split tax bases | `taxModel: "turnover"` + `gamingTaxRate` GGR | tax expectation proving stakes-based betting duty + GGR gaming duty |
| REQ-PT-4 Safe formats from the engine | `specs/pt_v1.py` (envelope + JGDR/TRAN/AJOG) | golden files per record family |
| REQ-PT-5 gazette schemas as oracle | `test_pt_spec.py` phase-2 XSD gate | goldens validate against `derived/*.xsd` |
| REQ-PT-6 cadence simplification declared | envelope-per-record + module comments | doc + code comments; SAFE files carry the real envelope |
| REQ-PT-7 player protection | `playerProtection` config | breach-detector fan-out includes PT |
| REQ-PT-8 demo end-to-end | demo dict edits + PT SAFE folder | live e2e + PT reconciliation residual 0.00 |
