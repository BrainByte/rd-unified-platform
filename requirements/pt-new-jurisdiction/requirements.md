# Requirement: Portugal (PT) — new jurisdiction onboarding

| | |
|---|---|
| Requirement id | **PT** (pt-new-jurisdiction) — individual items REQ-PT-1 … REQ-PT-8 |
| Scope | The reporting pipeline (`dataform-example/`), the regulator format layer (`dataform-website/regulator_formats/`), and the demo stack (BetNova site, submission engine, SAFE, reconciliation) |
| Status | **Implemented** — see [implementation.md](implementation.md) § "As implemented" and the requirement → artifact → proven-by trace |
| Companion docs | [overview.md](overview.md) (what & how) · [implementation.md](implementation.md) (the plan) · [docs/regulator/pt/pt-data-model.md](../../docs/regulator/pt/pt-data-model.md) (the analysed regulator model) · [docs/regulator/pt/derived/](../../docs/regulator/pt/derived/) (the gazette schemas, transcribed and validated) |

## Background / regulatory context

Portugal regulates online gambling under the **RJO** (Decreto-Lei n.º
66/2015), supervised by the **SRIJ** (Serviço de Regulação e Inspeção de
Jogos, Turismo de Portugal). The technical regime — **Regulamento n.º
903-B/2015**, analysed in the data-model document — is
**infrastructure-first and pull-based**: the operator runs an in-country
gateway plus a **Safe** (data vault), fed by a **Captor** that formats
gaming data as XML, signs/zips/encrypts it, and deposits **hourly files
in six categories** (daily `RESF_` financial summary and `EXCL_`
self-exclusions; hourly `JGDR_` player registrations, `SESS_` sessions,
`AJOG_` gaming activity with balance triplets, `TRAN_` wallet ledger),
packaged daily by 01:00 for SRIJ to collect over FTPS. Identity
verification and self-exclusion run as real-time SOAP services against
SRIJ. Uniquely among the sampled jurisdictions, the gazette **prints the
wire-format XSDs in Anexo 1** — transcribed (with flagged repairs) into
`docs/regulator/pt/derived/`, which this scenario uses as its validation
oracle.

Unlike France (poker only), Portugal licenses the full demo portfolio:
fixed-odds sports betting, poker, blackjack and games of chance
(roulette/slots) — each game homologated by SRIJ before offer. As with
prior onboardings, exact IEJO tax parameters and current SRIJ "Modelo de
Dados" schema versions are production pinning tasks (see the data-model
doc's open questions); the architectural work is captured here.

## The requirements

**REQ-PT-1 — Market as configuration.** Portugal is one config object in
`includes/jurisdictions.js` (`PT`): EUR, `Europe/Lisbon`, `NNNN-NNN`
postcode validation, daily submission cadence, **voids reported**
(refund triplets and `total_reembolsos` are first-class), player
identified by clear operator account id (full-KYC regime, no
pseudonymisation). No PT-conditional SQL anywhere.

**REQ-PT-2 — Homologation as nomenclature.** Every game offered must be
SRIJ-homologated, so both code lists are **closed with `block` policy**:
sports codes for the authorised competitions, and gaming codes mapping
the demo verticals to the `AJOG_` sub-record families (`SLOT →
fortazar`, `BLKJ → bjack`, `POKC/POKT → poker`). The operator-jackpot
game (`OJACK`) is **not homologated** and must be blocked by the
existing `no_unlicensed_games` machinery — the third variant of the
licensing story (MT licenses it, ES blocks that one game, FR blocks the
whole casino vertical, PT blocks the non-homologated game).

**REQ-PT-3 — Split tax bases.** Portugal's IEJO taxes fixed-odds sports
betting on **turnover** (stakes) and casino/poker games on **GGR** —
the first market combining DE's `turnover` betting model with a gaming
GGR rate. Rates as effective-dated config, flagged illustrative pending
pinning to the IEJO articles.

**REQ-PT-4 — Safe file formats from the mapping engine.** PT records
are produced by the mapping engine (`specs/pt_v1.py` — no hand-written
module): the shared file envelope (`cod_entexpl`, `datahr`,
`id_ficheiro`, `cod_cofre`) wrapping category records — `players →
JGDR_`, `payments → TRAN_` (DEBITO/CREDITO with `saldo` triplet),
`bets → AJOG_` sport sub-records, `gaming → AJOG_` sub-records per
vertical — with the balance-triplet pattern throughout, reusing the
ledger-derived canonical balance fields built for FR.

**REQ-PT-5 — The gazette schemas are the validation oracle.** PT golden
files must **validate against `docs/regulator/pt/derived/*.xsd`** via
the `xmlschema` gate — the first market whose oracle schemas were
themselves extracted from the regulator's own gazette by this repo, and
therefore the strongest closing of the loop available without SRIJ's
current Modelo de Dados.

**REQ-PT-6 — Demo cadence simplification, declared.** The real regime
batches records into hourly files zipped daily; the demo deposits one
enveloped file per record in near-realtime (the same declared
simplification as NL's 512-record `Root`). File-level `rp.xml`
reprocessing, signing/zipping/Multicert encryption and the FTPS pull are
vault mechanics the demo SAFE stands in for.

**REQ-PT-7 — Player protection.** Player-set deposit **and bet** limits
at daily/weekly/monthly granularity (no statutory defaults), national
self-exclusion register (SRIJ's lista de autoexcluídos, consumed via
SOAP in reality): `selfExclusionSources: ["OPERATOR", "NATIONAL"]` with
the mandatory register; withdrawal requires verification (full KYC with
AT/civil-registry checks). The existing breach detectors cover PT with
no new code.

**REQ-PT-8 — Demo end-to-end.** Portugal is clickable in BetNova:
register a Portuguese player (NNNN-NNN postcode hint, NIF-style id),
deposit, bet, settle, play slots/blackjack/poker (all licensed —
contrast FR), and the SAFE receives PT category files with receipts;
the PT reconciliation PDF reconciles to zero with the split tax basis
noted.

## Out of scope

- `SESS_` session files (the demo submission engine has no login-session
  record type), `RESF_` daily financial summaries (operator-level, not
  player-grained — the periodic-register machinery is per-player) and
  `EXCL_` self-exclusion files with ID-document images: analysed, not
  demoed.
- The SRIJ SOAP services (identity verification, exclusion list
  pull/push) and AMA integration.
- Signing/ZIP/Multicert encryption, the daily packaging window, hourly
  batching and `rp.xml` reprocessing (REQ-PT-6).
- Exact IEJO rates, current Modelo de Dados versions, GameVault/operator
  code assignment (production pinning; data-model doc §Open questions).

## Acceptance criteria

1. `npm run check` green, including PT expectations and a negative test
   proving the non-homologated operator-jackpot game is blocked from PT
   gaming files.
2. Emitted SQL contains the PT submission/tax/assertion files and **no
   other market's files changed**; the tax expectation proves the
   split basis (turnover on betting, GGR on gaming).
3. `test_pt_spec.py` proves the PT mapping spec against golden files
   AND validates every golden against `docs/regulator/pt/derived/*.xsd`
   (the transcribed gazette schemas).
4. In the demo, a PT settled bet lands as an enveloped `AJOG_` file, a
   deposit as `TRAN_` (CREDITO with saldo triplet), a registration as
   `JGDR_`, casino rounds as `AJOG_` sub-records — and the PT
   reconciliation PDF shows residual 0.00 with completeness green.
5. The `cdc_source_watermarks` row for PT exists (the documented classic
   mistake).
