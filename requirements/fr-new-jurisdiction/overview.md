# France (FR) new jurisdiction — overview

*Companion to [requirements.md](requirements.md) (the ask) and
[implementation.md](implementation.md) (the step-by-step plan). This
scenario follows [`how-to.md`](../../how-to.md) § 7 — "adding a
completely new jurisdiction" — and would make France the eighth market.
The regulator's schemas are sampled and analysed in
[`docs/regulator/fr/`](../../docs/regulator/fr/fr-data-model.md).*

## What this adds

The **first event-log jurisdiction**. Every market served today files
batch records — per-slip rows in a daily file (MT/ES/DK/BG/GR/NL/DE),
periodic registers (ES RUD/RUT). France inverts the shape: the regulator
defines an **event catalogue** (bet placed, bet settled, bet voided,
deposit made, limit set, self-exclusion requested…) and the operator
captures **one small French-language XML per event, in real time**, into
a sealed vault the regulator inspects.

That stresses the architecture in three new ways, all of which existing
mechanisms absorb:

1. **One canonical record → N regulator documents.** A settled slip is
   *two* FR traces (`PASPMISE` + `PASPGAIN`). The ES periodic case
   already proved the reverse (N rows → one Lote); FR needs the
   translation layer's output to be a *list* of documents per record —
   a transport-loop generalisation, not a per-market fork.
2. **Balances inside the report.** FR money traces carry
   before/movement/after wallet triplets. The unified wallet ledger
   (built for reconciliation and the overspend detector) already derives
   exactly these numbers; FR is the first market to *report* them.
3. **An unlicensed-vertical market with a licensed P2P game.** France
   licenses poker but no casino games — the mirror image of ES (which
   blocks one game). The existing nomenclature machinery
   (`unmappedPolicy: "block"` + `no_unlicensed_games`) expresses this as
   config; slots and blackjack activity by French players simply never
   reaches an FR file, provably.

Meanwhile the parts that made DE "the hardest test" are routine here:
FR is one `jurisdictions.js` object, its rules cite loi 2010-476
clauses, its taxes are effective-dated schedules, and the demo edits are
the usual five small dicts.

## Where it lands

| Concern | Layer | Why |
|---|---|---|
| Market identity, cadence, voids, tax, closed code lists, rules | `includes/jurisdictions.js` → `FR` entry | A market is a config object |
| Licensed-verticals enforcement (poker yes, casino no) | `nomenclature`/`gamingNomenclature` with `block` policy | Same machinery that blocks ES's unlicensed game |
| Sports authorised-competitions list | `nomenclature.sportCodes` (closed, `block`) | ANJ authorises competitions; unmapped must never ship |
| Player-set limits mandatory, national self-exclusion register | `playerProtection` config | Existing breach detectors cover FR unchanged |
| Trace XML formats (CJ/PASP/PO families) | `regulator_formats/specs/fr_*.py` on the mapping engine | Variance as data on the wire, like NL/ES specs |
| FR lexical profile (yy-timestamps, balance triplets, flag elements) | `regulator_formats/engine.py` codecs | Named once, shared by any future spec |
| One record → N trace documents | engine/registry return shape + submission delivery loop | The single genuinely new mechanism |
| Balance triplets on canonical records | submission queries reading the wallet ledger | Report what the ledger proves, never recompute |
| Demo clickability (registration, SAFE endpoint, recon) | the five demo dicts + template (how-to § 7 step 5) | See FR end to end without slides |
| Golden files + XSD validation | `test_fr_spec.py` + `docs/regulator/fr/` | The regulator's own examples are the oracle |

## Legacy comparison

| | Legacy (per-market stored procs) | This architecture |
|---|---|---|
| Onboard France | A new fork: procs, triggers, SSRS, a bespoke trace writer, months of divergence | One config object + one mapping spec + seed rows |
| Event-log vs batch shape | A structurally different codebase per shape | The near-realtime engine already submits per record; FR fans records into event traces in the translation layer |
| Poker licensed, casino not | `IF @Market = 'FR' AND GameType IN (…)` scattered | Config-driven `block` policy + an existing cross-domain rule, with a negative test |
| Balance-bearing reports | Balances recomputed in the trace writer, drift risk | The one wallet ledger feeds both reconciliation and the trace |
| Regulator schema drift (the FR change log shows surgical in-place edits) | Diff prose against procs | Spec + golden files + XSD gate turn drift into a red build |

## The key design decisions

1. **The trace catalogue maps from canonical record types, not the other
   way round.** The pipeline stays event-*record* shaped (players,
   payments, bets, gaming); the FR spec declares which trace(s) each
   record type emits (`bets → [MISE, GAIN|ANNUL]`, `payments →
   [CPTEALIM|CPTERETRAIT]`, `players → [CJ open/KYC]`, `gaming(poker) →
   [PO…]`). CJ account events with no canonical source today (address
   change, preferences) are out of scope until the source exists.
2. **Multi-document output is a registry-level capability.** A formatter
   may return a list of documents; the submission engine deposits each
   with its own record key suffix (`S1001-MISE`, `S1001-GAIN`) and one
   receipt per deposit. No other market changes behaviour (a
   single-document list is the degenerate case).
3. **Poker maps to the PO family, not to a casino trace.** The demo's
   POKER rounds are the licensed vertical; SLOTS/BLACKJACK stay
   canonical game types with no FR mapping, so the block policy — not
   code — keeps them out.
4. **The demo SAFE plays the frontal.** Sealing, compression and the
   per-vault counter are vault mechanics out of demo scope; what the
   demo proves is the data: schema-true traces, in order, with receipts.
