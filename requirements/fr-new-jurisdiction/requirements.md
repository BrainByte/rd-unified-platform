# Requirement: France (FR) — new jurisdiction onboarding

| | |
|---|---|
| Requirement id | **FR** (fr-new-jurisdiction) — individual items REQ-FR-1 … REQ-FR-8 |
| Scope | The reporting pipeline (`dataform-example/`), the regulator format layer (`dataform-website/regulator_formats/`), and the demo stack (BetNova site, submission engine, SAFE, reconciliation) |
| Status | **Implemented** — see [implementation.md](implementation.md) § "As implemented" and the requirement → artifact → proven-by trace |
| Companion docs | [overview.md](overview.md) (what & how) · [implementation.md](implementation.md) (the plan) · [docs/regulator/fr/fr-data-model.md](../../docs/regulator/fr/fr-data-model.md) (the analysed regulator model) |

## Background / regulatory context

France licenses online gambling under **loi n° 2010-476 du 12 mai 2010**,
supervised since 2020 by the **ANJ** (Autorité Nationale des Jeux, absorbing
the former ARJEL). Three online verticals are licensable — **sports
betting (PASP), horse-race betting (PAHI) and poker (PO)**; online casino
games (slots, roulette, blackjack…) are **not licensed in France**.

The reporting regime is unlike any market this platform serves today: not
periodic batch files but an **event log**. The operator captures **one
XML trace per player action, in real time**, into a sealed local vault
(the *coffre-fort* inside the certified *frontal*) that the regulator
**inspects rather than receives**. The schema set (sampled and analysed
under `docs/regulator/fr/`) defines a family per vertical — CJ player
account events (19 types: registration, KYC, deposits/withdrawals,
self-exclusion `AUTOINTERDICTION`, stake limits `LIMITMISE`…), bet
lifecycle events (`MISE`/`GAIN`/`ANNUL`), poker events down to per-seat
card level, plus reference families (MO virtual currency, PDV retail
points of sale). Every event carries a common header (operator id, vault
id, per-vault event counter, player id + hash, session, IP) and every
money event carries **before/movement/after balance triplets** for both
cash and bonus wallets.

As with prior onboardings, exact levy rates, the authorised-competitions
list and field-level legal pinning are production tasks flagged to
primary sources; the architectural work is captured here.

## The requirements

**REQ-FR-1 — Market as configuration.** France is one config object in
`includes/jurisdictions.js` (`FR`): EUR, `Europe/Paris`, 5-digit postcode
validation, daily submission cadence, **voids reported** (`ANNUL` traces
are first-class events, so `includeVoided: true`), player identified by
operator account id (the trace regime carries clear identifiers inside
the sealed vault — no pseudonymisation). No FR-conditional SQL anywhere.

**REQ-FR-2 — Licensed verticals only.** Sports betting and poker are
licensed (the demo has no horse-racing product); **casino games are
not**. The gaming config maps only poker game codes; every other
canonical game type is unmapped under `unmappedPolicy: "block"`, so the
existing `no_unlicensed_games` machinery blocks slots/blackjack/jackpot
activity from ever reaching an FR file — the same mechanism that blocks
ES's unlicensed Punto y Banco, proven by a negative test. Sports
nomenclature is likewise a closed list (ANJ authorises competitions and
bet types), `unmappedPolicy: "block"`.

**REQ-FR-3 — Tax model.** Betting levies are GGR-based (on the *produit
brut des jeux*) at vertical-specific rates; poker is levied on stakes
with its own basis. Configured via the existing `taxModel`/`taxRate` and
`gamingTaxRate` machinery (the DE onboarding already added the
`turnover` basis), as **effective-dated schedules** with rates flagged
illustrative pending legal pinning.

**REQ-FR-4 — Event-grained trace reporting.** FR's reportable unit is
the *event*, not the record: a settled slip produces **two traces**
(`PASPMISE` at placement, `PASPGAIN` at settlement — or `PASPANNUL` when
voided); a deposit produces a `CPTEALIM` trace; account opening/KYC
produce CJ traces; poker rounds produce PO traces. The submission layer
must therefore support **one canonical record fanning out to N regulator
documents** (the inverse of the ES periodic case, where N rows fold into
one Lote).

**REQ-FR-5 — Regulator format as a mapping spec.** FR trace XML is
produced by the mapping engine (`regulator_formats/engine.py`) from a
new spec (`specs/fr_*.py`) — no hand-written FR module. The spec adds
the FR lexical profile (12-digit two-digit-year timestamps, implicit-EUR
unconstrained decimals, empty-element boolean flags, French enumerations
ending *Autre*), the shared trace header, and the balance-triplet
pattern. Output validates against the vendored XSDs in
`docs/regulator/fr/referentiel/xsd/`, with the regulator's own example
XMLs (`docs/regulator/fr/xml/`) as golden files.

**REQ-FR-6 — Balance triplets.** Every FR money trace states the wallet
before, the movement, and the wallet after (cash and bonus separately).
Canonical records feeding FR must therefore carry ledger-derived
balances at event time — sourced from the existing unified wallet ledger,
never computed ad hoc in the serialiser.

**REQ-FR-7 — Player protection.** French law makes player-set limits
mandatory at registration (the CJ family traces them via `LIMITMISE`)
and self-exclusion is national (*interdits de jeux*): config carries
`selfExclusionSources: ["OPERATOR", "NATIONAL"]` with the mandatory
register, and the existing breach detectors (activity-while-excluded,
deposit/loss limits) cover FR with no new code.

**REQ-FR-8 — Demo end-to-end.** France is clickable in BetNova: register
a French player (postcode hint, national id), deposit, bet, settle, play
poker — and the SAFE receives FR traces (`dataform-safe/FR/…`) with
receipts, including the MISE+GAIN pair for one settled bet. The FR
reconciliation PDF reconciles to zero.

## Out of scope

- Horse racing (PAHI), lotteries (LOTI/LOJI) and fantasy (FA) — the demo
  has no such products; the trace families are analysed and the same
  spec mechanism applies when a product exists.
- Retail points of sale (PDV) and virtual currency (MO) reference events.
- Vault mechanics: sealing, signatures, the compressed tag encoding
  (`traduction.csv`) and per-vault event counters as a hard sequence —
  the demo SAFE stands in for the frontal.
- Exact levy rates, the authorised-competitions list and field-level
  legal pinning (production tasks, to primary sources).

## Acceptance criteria

1. `npm run check` green, including FR expectations and a negative test
   proving unlicensed casino activity is blocked from FR files.
2. Emitted SQL contains the FR submission/tax/assertion files and **no
   other market's files changed**; the config validator passes (and
   rejects a deliberately broken FR entry in tests).
3. `test_fr_spec.py` proves the FR mapping spec against golden files
   derived from the regulator's own examples, and generated traces
   validate against the vendored XSDs.
4. In the demo, one settled FR bet lands as **two** trace files
   (MISE + GAIN) under `dataform-safe/FR/bets/`, an FR deposit as a
   CPTEALIM trace, and the FR reconciliation PDF shows residual 0.00
   with completeness green.
5. The `cdc_source_watermarks` row for FR exists (the documented classic
   mistake — without it FR compiles fine and reports nothing).
