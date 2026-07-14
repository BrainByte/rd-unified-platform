# Portugal (PT) new jurisdiction — overview

*Companion to [requirements.md](requirements.md) (the ask) and
[implementation.md](implementation.md) (the step-by-step plan). This
scenario follows [`how-to.md`](../../how-to.md) § 7 and the France
precedent ([fr-new-jurisdiction](../fr-new-jurisdiction/overview.md)),
making Portugal the ninth market. The regulator model is analysed in
[`docs/regulator/pt/`](../../docs/regulator/pt/pt-data-model.md).*

## What this adds

The **first market whose validation oracle is the regulator's own
gazette**. Portugal's Regulamento n.º 903-B/2015 prints its wire-format
XSDs inside the legal text; this repo transcribed them (with flagged
repairs) into `docs/regulator/pt/derived/`, and the PT mapping spec must
produce documents that validate against them. FR proved the XSD gate
catches spec defects; PT closes the loop tighter — the gate schemas were
extracted from the same source of truth the spec was written from.

Three architecture points PT exercises that no prior market does:

1. **Split tax bases in one market.** IEJO taxes fixed-odds betting on
   **turnover** and gaming on **GGR**. DE introduced the `turnover`
   model for betting; PT combines it with a gaming GGR rate — proving
   the tax machinery composes rather than forks.
2. **The licensing spectrum completes.** MT licenses the operator
   jackpot, ES blocks that single game, FR blocks the whole casino
   vertical; PT licenses the full portfolio but only what is
   **homologated** — so the same `block` nomenclature machinery now
   expresses "everything except the uncertified game". Four postures,
   zero new code.
3. **A batch-file regime served by the event-capable engine.** PT's
   `AJOG_`/`TRAN_`/`JGDR_` records ride the same envelope pattern as
   NL's `Root` (one enveloped file per record in the demo, hourly
   batching declared as the production difference) while reusing FR's
   ledger-derived balance triplets — the two prior engine investments
   meet in one spec with no new engine mechanism expected.

## Where it lands

| Concern | Layer | Why |
|---|---|---|
| Market identity, cadence, voids, split taxes, closed code lists, rules | `includes/jurisdictions.js` → `PT` entry | A market is a config object |
| Homologation enforcement (uncertified game blocked) | `gamingNomenclature` with `block` policy + `no_unlicensed_games` | Same machinery, fourth licensing posture |
| Turnover betting tax + GGR gaming tax | existing `taxModel: "turnover"` (DE) + `gamingTaxRate` | Proves the bases compose |
| Player-set deposit/bet limits, national register | `playerProtection` config | Existing breach detectors cover PT unchanged |
| Safe category formats (JGDR/TRAN/AJOG over the common envelope) | `regulator_formats/specs/pt_v1.py` on the mapping engine | Variance as data on the wire; no hand-written module |
| Balance triplets | FR's `_balances()` canonical fields, reused | Report what the ledger proves |
| Golden files + XSD gate against the gazette schemas | `test_pt_spec.py` + `docs/regulator/pt/derived/` | The regulator's own printed schemas as oracle |
| Demo clickability (registration, SAFE endpoint, recon) | the five demo dicts (how-to § 7 step 5) | See PT end to end without slides |

## Legacy comparison

| | Legacy (per-market stored procs) | This architecture |
|---|---|---|
| Onboard Portugal | A new fork: procs + a bespoke Captor/Safe writer + hand-read gazette | One config object + one mapping spec + seed rows |
| Split tax bases | Two hand-written tax procs, drift risk between them | Two config values on existing models, one expectation proving both |
| Homologation scope | `IF @GameId NOT IN (…)` lists in triggers | Closed code map + an existing cross-domain rule + a negative test |
| Gazette schema defects (`xs:int` datetimes, string amounts) | Discovered in production rejection loops (`rp.xml`) | Found and flagged at transcription; the spec validates before anything ships |
| Balance-bearing hourly files | Balances recomputed in the extract job | The one wallet ledger feeds recon and the trace alike |

## The key design decisions

1. **The derived schemas are the oracle, with their provenance kept
   loud.** `test_pt_spec.py` validates against
   `docs/regulator/pt/derived/*.xsd` — transcriptions of the gazette,
   not SRIJ's current Modelo de Dados. The test output and docs say so;
   swapping in the official schemas when obtained is a file replacement,
   not a redesign.
2. **One enveloped file per record in the demo.** The regulation batches
   hourly; the demo deposits per record with the real envelope
   (`cod_entexpl`, `datahr`, `id_ficheiro`, `cod_cofre`) so every SAFE
   file is shaped like a (single-record) production file. Hourly
   batching is transport-loop config in production, exactly as ES's
   Lote batching and NL's 512 ceiling are.
3. **`AJOG_` sub-records map from canonical verticals.** Bets emit the
   `sport` sub-record; SLOTS→`fortazar`, BLACKJACK→`bjack`,
   POKER→`poker`. Card-level poker detail the demo doesn't hold is
   omitted, declared — the same honesty rule as ES/GR identity blocks.
4. **`RESF_`/`SESS_`/`EXCL_` stay out of demo scope** (no canonical
   source or wrong grain), catalogued in the data-model doc for when
   the sources exist — as FR's PAHI/LOTI families were.
