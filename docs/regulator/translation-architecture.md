# Regulator Translation: Out of BigQuery, Without Hand-Crafted Code

This document explains why the translation from submission rows to
regulator-stipulated files must live **outside** BigQuery, and how to build
that layer so it honours this project's founding principle — *every market
difference is data, every piece of logic exists once* — rather than
re-creating the 17-fork legacy estate in Python.

Companion documents: the four schema analyses and
[comparison](comparison.md) in this folder (what the regulators actually
demand); the demo translation layer
`dataform-website/regulator_formats/` (a working seam, four markets); the
production skeleton `dataform-starter/submission-service/` (where the layer
runs in GCP).

---

## 1. Why translation cannot live in BigQuery

BigQuery + Dataform is the right home for every *decision*: what is
reportable, per-market variance, pseudonymisation, amounts, periods,
completeness gates. All of that is set-based logic over rows — the
warehouse's home ground — and it ends at the `submission_ready_{mkt}`
views. The remaining step, turning a decided row into the file a regulator
will accept, is a different kind of work, and each of the four sampled
regimes demonstrates a reason SQL cannot do it:

1. **XML is not a warehouse output format.** BigQuery has no XML
   generation facilities; producing a DGOJ `Lote` or a Danish Standard
   Record in SQL means hand-concatenating strings — namespaces,
   `xsi:type` polymorphism (ES), æ/ø/å element names (DK), character
   escaping — the least testable possible encoding of a regulator schema.
2. **Security operations need keys and a runtime.** The Netherlands
   requires a SHA-256 hash-chained, XML-Signature-signed,
   XML-Encryption-wrapped control manifest per batch; Greece encrypts and
   signs a manifest per file; Denmark authenticates SAFE deposits with
   TamperToken. Signing keys, certificate stores and crypto libraries do
   not belong inside SQL.
3. **Delivery is stateful and protocol-shaped.** SFTP drops to a Danish
   SAFE, SOAP endpoints, sequence numbers and file IDs (GR `FileID`, NL
   `Manifest_Sequence_Number`), batch ceilings (NL: max 512 records per
   file), retries with backoff, receipt capture, exactly-once per record
   key, supersede-on-refile for periodic registers — none of this is
   expressible as a query.
4. **Validation belongs at the boundary.** The one place the regulator's
   XSD can mechanically prove us right is immediately before transmission
   — an offline, per-file check against the schemas vendored in this
   folder. A warehouse cannot run that gate; a delivery service can run it
   on every file.

So the target architecture keeps the established division of labour:
**Dataform decides WHAT (business logic, variance as data); a thin
delivery service outside the warehouse decides HOW it is written (format)
and WHEN/WHERE it goes (transport)** — and, per the golden rules, that
service holds *no business logic*.

## 2. The trap to avoid: hand-crafted adapters are the old forks reborn

The demo's `regulator_formats/{dk,es,gr,nl}.py` modules prove the seam:
stdlib-only pure functions, canonical dict in, regulator document out.
But they are **hand-written, one imperative module per market** — fine as
a proof for four markets, and precisely the anti-pattern at seventeen:

- A new reported field means editing N market modules — the same change
  amplification the legacy stored-proc estate suffered from.
- A regulator version bump (KSA v1.11 → v1.12) means diffing prose against
  code by eye.
- Nothing mechanical stops format logic drifting into business logic.

The pipeline solved this exact problem once already: `jurisdictions.js`
holds variance as data and a generic fan-out generates the SQL. The
translation layer must be built the same way.

## 3. Three ways to avoid hand-crafting — and the recommended blend

### Option A — a mapping-driven serialisation engine (the core)

One generic engine, ever written once; per-regulator **mapping specs that
are data**, not code. A spec declares three things:

1. **A lexical profile** — the regulator's conventions, picked from a
   small reusable catalogue. The [comparison](comparison.md) shows these
   cluster tightly; the entire lexical surface of all four regimes is
   covered by a handful of codecs:

   ```yaml
   # profiles.yaml — reusable value codecs, defined once
   es-dgoj:
     datetime: digits14            # AAAAMMDDHHMMSS
     datetimeTZ: digits14+offset   # ...±HHMM
     boolean: S/N
     money: {decimals: 2, style: importe-lines, currency: EUR}
     odds: {decimals: 4}
   nl-ksa:
     datetime: iso-z-seconds       # YYYY-MM-DDThh:mm:ssZ, no fraction
     boolean: xsd
     money: {decimals: 2, style: bare}      # EUR implicit
     id: uuid5-lowercase
   ```

2. **An envelope** — batch header, sequencing, size ceiling:

   ```yaml
   envelope:                        # ES
     root: Lote
     namespace: http://cnjuego.gob.es/sci/v3.3.xsd
     header: {OperadorId: $config.operator_id, AlmacenId: $config.almacen_id,
              LoteId: $batch.id, Version: "3.3"}
     max_records: null              # one Lote per filing
   envelope:                        # NL
     root: Root
     max_records: 512               # split batches at the schema's ceiling
     record_header: [Record_ID: "uuid5(record_key)", Extraction_Date: "$now",
                     Operator_ID: $config.operator_id, Data_Safe_ID: $config.safe_id]
   ```

3. **Record shapes** — the element tree with field bindings from the
   canonical row, declared not coded:

   ```yaml
   records:
     bets:                          # NL WOK_Bet_v1.11
       element: WOK_Bet_v1.11
       fields:
         Bet_ID:             {value: "uuid5('bet', slip_id)"}
         Bet_Start_Datetime: {from: placed_at, as: datetime}
         Bet_Type:           {const: SINGLE}
         Bet_Status:         {const: BET_SETTLED}
         Bet_Parts.Part:
           Part_Event:       {from: event, truncate: 256}
           Part_Odds:        {from: odds, as: money}
           Part_Prognosis_Value: {from: selection}
           Part_Stake:       {from: stake, as: money}
         Bet_Total_Stake:    {from: stake, as: money}
   ```

   Conditionals stay declarative (`when: status == VOIDED` emits the DK
   `SpilAnnullering` block), lists bind to canonical row-lists (the ES
   periodic filing's `Jugador` blocks), and constants/config fill licence
   ids. The engine is a single tree-walker: spec node + canonical dict →
   element. The demo's `generic.py` — a field list plus a name map driving
   one loop — is already the embryo of exactly this engine.

**This is `jurisdictions.js` for the wire format.** A new market becomes a
new spec file; a new reported field is usually one mapping line per
affected market; code changes only when a genuinely new *mechanism*
appears (a new codec, a new envelope behaviour) — and then it exists once.

### Option B — derive from the XSDs themselves (the validity guarantee)

The regulator's XSD is itself machine-readable configuration — and this
repo already vendors the schemas under `docs/regulator/`. Two mechanical
uses:

- **Generated bindings**: tools like `xsdata` generate Python
  dataclasses + serialisers from an XSD at build time. Element order,
  types, namespaces and enumerations come from the regulator verbatim;
  a schema version bump is re-run codegen plus a reviewable diff. The
  mapping spec then shrinks to pure field bindings (canonical field →
  generated class attribute) with zero element-name spelling anywhere.
- **A validation gate**: whether or not bindings are generated, every
  produced file is validated against the vendored XSD (`xmlschema` /
  `lxml`) — in CI against golden seed data, and at runtime before
  transmission. This is the delivery-side twin of the pipeline's
  assertion rule: *a file that fails its regulator's schema never leaves
  the building*, and a regulator schema update announces itself as a red
  build, not a rejection letter.

### Option C — templates as the escape hatch (used sparingly)

Some corners resist clean mapping (Denmark's generated-artifact quirks,
duplicate ASCII/Danish element spellings). For those, a Jinja2 XML
template per report is still declarative-ish and diffable against the
regulator's examples. This is the delivery-layer analogue of the
pipeline's `30_submissions/overrides/` + `customSubmission: true`: an
explicit, per-market opt-out that keeps the generic path clean — and like
overrides, it should carry a justification comment and stay rare.

### Recommended blend

**A is the engine, B is the guarantee, C is the exception.** Mapping
specs drive one generic serialiser; XSD validation gates every file (with
generated bindings where they pay for themselves — NL and GR's regular
schemas are ideal; ES's monolith works; DK's 110-file chameleon set may
justify a template or two); overrides exist but demand justification.
That is the same 90/10 shape the SQL side already has.

## 4. The configurable Python service, end to end

```
BigQuery submission_ready_{mkt}      rows (the canonical contract)
        │
   batcher            config: max_records, file/sequence id policy, period grouping
        │
   serialiser (ONE)   per-market mapping spec + lexical profile  ← Option A
        │
   validator          vendored XSDs, fail-closed                 ← Option B
        │
   security stage     pluggable per market: none | sign | encrypt+sign | hash-chain
        │
   transport          pluggable per market: SFTP-safe | SOAP | REST
        │
   receipts           → BigQuery submission_receipts (feeds recon in Dataform)
```

Every stage is one implementation parameterised by market config; the
per-market artefacts are **a spec file, the vendored XSDs, and
credentials** — no per-market code on the happy path.

**Why this scales:**

- *Operationally* — the service is stateless (Cloud Run), triggered per
  market/report-date by Workflows after the Dataform run; markets fan out
  in parallel; batch ceilings (NL 512, ES subregistro splitting) are
  envelope config; large registers stream from the BigQuery Storage API
  rather than loading into memory. Idempotency lives where it does today:
  a delivery log keyed by record/filing key, receipts superseding on
  refile.
- *Organisationally* — onboarding market 18 is: drop in the XSDs, write a
  spec, add golden-file tests, wire credentials. No engine change, no
  review of imperative XML code. The effort mirrors adding a market to
  `jurisdictions.js`.
- *Over time* — specs are versioned alongside the schema they target
  (`nl/v1.11.yaml` → `nl/v1.12.yaml`, effective-dated like tax rates), so
  a regulator upgrade is a new spec version running in parallel until
  cutover, with the CI validation gate proving both.
- *For testing* — the layer stays a pure function (row → bytes): golden
  files from seed data per market, XSD validation in CI, and the same
  specs exercised end-to-end by the local demo
  (`dataform-website/`) and by production — the demo becomes a rehearsal
  of the real seam, not parallel code.

## 5. Migration path from what exists today

1. Keep `regulator_formats/` as the reference implementation and test
   oracle — its outputs are the golden files.
2. Extract the lexical codecs (already isolated in `_util.py` and the
   per-module helpers) into the profile catalogue.
3. Rewrite one market as a spec (NL first: smallest, most regular) and
   diff engine output against the golden files until byte-identical.
   **Done** — `regulator_formats/engine.py` (the generic tree-walker) +
   `regulator_formats/specs/nl_v1_11.py` (the spec, pure data) now serve
   NL in the registry; `dataform-website/test_nl_spec.py` proves the pair
   byte-identical to the retained hand-written oracle `nl.py` across all
   four record types and their branches.
4. Add the XSD validation gate to CI using the schemas in this folder.
5. Convert ES/GR; decide DK case-by-case (spec vs template) given its
   quirks. **ES done** — `specs/es_v3_3.py` covers all six record types
   including the two-registro periodic Lotes; the conversion required
   only spec-vocabulary additions to the engine (element attributes for
   `xsi:type`, per-record envelope values, list iteration for register
   rows, element variants for the Depositos/Retiradas split, string
   templates, and the ES lexical codecs), proven by `test_es_spec.py`
   (10/10 byte-identical to `es.py`) with the NL suite still green.
6. Lift specs + engine into `dataform-starter/submission-service/` as the
   adapter layer; the demo website imports the same engine thereafter.

The end state honours the project's principle on both sides of the
warehouse boundary: in BigQuery, market variance is rows in a config; on
the wire, market variance is a mapping spec — and in neither place is it
a fork.
