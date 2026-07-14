# Portugal (PT) new jurisdiction — implementation

*Step-by-step record of how [requirements.md](requirements.md) was
implemented, following [`how-to.md`](../../how-to.md) § 7 and the France
precedent
([fr-new-jurisdiction/implementation.md](../fr-new-jurisdiction/implementation.md)).
Written ahead as the work order and executed as planned — § "As
implemented" records where reality amended the plan. Every change site
carries a grep-able `REQ: requirements/pt-new-jurisdiction` comment.
Sources: [pt-data-model.md](../../docs/regulator/pt/pt-data-model.md)
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

## As implemented — amendments to the plan

The plan executed as written; reality added these findings:

1. **The gazette-schema gate passed first time** — 10/10 goldens valid
   against `derived/*.xsd` on the first run, because the spec and the
   oracle were both built from the same gazette transcription (with its
   defects already repaired at transcription time). The FR experience
   (defects caught at gate time) and the PT experience (defects caught
   at transcription time) are the two orderings of the same discipline.
2. **Sub-record element order held two traps**: the poker family appends
   a `pinscr_*` prize triplet after the refund triplet, and `fortazar`
   carries **no** `resultado` element — both caught by reading the
   schemas before freezing goldens, either would have failed the gate.
3. **Two generic engine additions only**: the `digits14-fftz` codec
   (Oracle-style `.FF TZH:TZM` timestamps, UTC-normalised) and a `mod`
   modifier on the `crc` binding so numeric ids fit the gazette's
   `xs:short` file id. No PT-specific engine code.
4. **A live-wire cosmetic catch**: the account-movement figure could
   render `-0.00` (negative float zero); normalised at source in
   `_balances()`.
5. **Decisions the docs left open** (agent-reported, commented in
   config): illustrative Portuguese-flavoured sport codes
   (FUTB/TENI/BASQ) pending the Modelo de Dados; `pbanca`/BACC kept
   unmapped ("never type-approved for this operator") giving PT the
   ES-style single-game block as well; flat 0.08 tax constant (the
   schedule shape is proven elsewhere); the seeded NetEnt daily
   statement uplifted so provider revenue-share recon stays at zero
   breaks with the new PT slots round.
6. **Demo simplifications, declared in code**: one enveloped `ficheiro`
   per record (hourly batching is the production difference), cash-only
   wallet (bonus/`pinscr` triplets zero), placeholder KYC/table/card
   fields, and the current-balance-derived triplets shared with FR.

Verification results: `npm run check` green — **135/135 unit tests, 76
models, 132 rule assertions, 66 expectations, 19 negative tests**
(before PT: 72/114/62/18); emit-sql diff additive only. Demo suites:
PT **10/10 goldens + 10/10 gazette-schema-valid**; NL 9/9, ES 10/10,
FR 12/12 + 9/9 all unchanged. Live: registered `joana_pt`, deposited,
one bet settled and one voided (the `r_*` refund triplet restoring the
balance exactly), slots and poker rounds both reported (full portfolio
licensed — contrast FR), PT reconciliation residual 0.00, reported 6/6.

## Requirement → artifact trace

| Requirement | Implemented by | Proven by |
|---|---|---|
| REQ-PT-1 market as config | `jurisdictions.js` `PT` entry | validator clean; emit-sql diff additive only |
| REQ-PT-2 homologation as nomenclature | closed maps, `block`, no OJACK/BACC; full `gaming_verticals` in the demo `MARKETS` | negative test `ptUnlicensedGameTest` (PT-201 fires); live slots AND poker both reported |
| REQ-PT-3 split tax bases | `taxModel: "turnover"` 0.08 + `gamingTaxRate` 0.25 | expectations: 25 × 0.08 = 2.00 (stakes, not GGR's 1.20) and 6.40 × 0.25 = 1.60 |
| REQ-PT-4 Safe formats from the engine | `specs/pt_v1.py` (ficheiro envelope + JGDR/TRAN/AJOG with triplets) | 10/10 golden files across every branch |
| REQ-PT-5 gazette schemas as oracle | `test_pt_spec.py` phase-2 XSD gate | 10/10 goldens valid against `derived/*.xsd` |
| REQ-PT-6 cadence simplification declared | envelope-per-record + module comments | SAFE files carry the real envelope (live `id_ficheiro`/`cod_cofre` verified) |
| REQ-PT-7 player protection | `playerProtection` config (NATIONAL register, verification-gated withdrawal) | breach-detector fan-out includes PT (assertion count +18) |
| REQ-PT-8 demo end-to-end | demo dict edits + PT SAFE folder | live e2e + PT reconciliation residual 0.00, reported 6/6 |
