# Regulator Data Models — Cross-Jurisdiction Comparison

This document compares the four regulatory reporting data models sampled in this directory:

| Jurisdiction | Regulator | Detail document |
|---|---|---|
| Denmark (DK) | Spillemyndigheden (Danish Gambling Authority) | [dk/dk-data-model.md](dk/dk-data-model.md) |
| Spain (ES) | Dirección General de Ordenación del Juego (DGOJ) | [es/es-data-model.md](es/es-data-model.md) |
| Greece (GR) | Hellenic Gaming Commission (HGC / ΕΕΕΠ) | [gr/gr-data-model.md](gr/gr-data-model.md) |
| Netherlands (NL) | Kansspelautoriteit (KSA) | [nl/nl-data-model.md](nl/nl-data-model.md) |

All four are XML/XSD batch-file regimes in which the operator produces report files and the
regulator retrieves or receives them. Beyond that shared foundation, they diverge on almost
every design axis: schema architecture, language, typing, granularity, correction semantics,
integrity model, and domain emphasis.

## At a glance

| Dimension | DK | ES | GR | NL |
|---|---|---|---|---|
| Schema files | ~110 small XSDs | 1 monolithic XSD (~2,700 lines) | 28 XSDs (26 models + common + manifest) | 17 XSDs (11 domains + include + 2 KSA + 3 W3C) |
| Architecture | 3-layer: `types/` → `class/` (global elements) → `view/` (report structures) | Single file; abstract record hierarchy dispatched via `xsi:type` | Shared `CommonElements.xsd` + one schema per report type + manifest | Shared `include` + one schema per domain + manifest + cancellation |
| XSD version | 1.0 | 1.0 | **1.1** (uses `xs:assert` business rules) | 1.0 |
| Element language | Danish (with real æ/ø/å in names) | Spanish | English (bilingual Greek/English docs) | English |
| Version in sample | v2 (monopoly: v1) | 3.3 | 1.0 | 1.11 |
| Records per file | One report structure per file | One `Lote` batch, mixed record types | One data model per batch, unbounded | One record type per file, **max 512 records** |
| Money type | decimal, **10 fraction digits**, signed | decimal, 2 dp (4 dp for odds/jackpots), wrapped in multi-currency line list | decimal, 2 dp, signed, currency alongside | decimal, exactly 2 dp, **no currency field (EUR implicit)** |
| Timestamps | `xs:dateTime`, UTC by documentation | **Digit strings** (`AAAAMMDDHHMMSS`), optional `±HHMM` offset | `xs:dateTime`, pattern-forced `Z` suffix | `xs:dateTime`, pattern-forced `Z`, no fractional seconds |
| Booleans | 0/1 integers (`Tal1Type`) | `S`/`N` string enumeration | `xs:boolean` | `xs:boolean` |
| Country codes | **IOC-style 3-letter** (`DEN`, `GER`) + 2-letter ISO for addresses | Full ISO 3166-1 alpha-2 list inlined | ISO 3166-1 alpha-3 | (not used — pseudonymised) |
| Player identity | Pseudonymous operator ID (CPR explicitly forbidden) | **Full KYC identity** (name, DNI/NIE, address, DOB, contacts) in RUD | Full KYC (ID card/passport, VAT, AMKA) in Customer Account | **Pseudonymised**: profile ID + DOB + bank accounts only |
| Corrections | Replacement file (`SpilFilErstatningIdentifikation`); per-transaction cancellation flag | `Rectificacion` header link + record splitting (`SubregistroId/Total`) | Cancel/replace record envelope (append-only) | `Replaced_Record_ID` + separate `KSA_Cancellation` record (append-only) |
| Integrity/security | SAFE (FTP) store + TamperToken authentication | Optional enveloped XML-DSig on the batch | Manifest with XML Encryption + XML Signature per file | Manifest with **SHA-256 hash chain** to previous manifest + XML Encryption + Signature |
| Submission cadence | Daily end-of-day + event-driven lifecycle reports | Daily/monthly periodic + event-grained records in batches | Minimum **every 2 hours** for transactional data; daily EoD; monthly finalisation (16 days) | Continuous recording into the Controle Databank (CDB); daily operator totals |

## Schema architecture

The four models represent four distinct philosophies:

- **DK — maximal decomposition.** ~47 single-type files, ~51 entity files declaring flat
  global elements (semantics defined once, in Danish, with rich documentation), and 7 view
  files that compose those elements into report structures via `ref=`. Chameleon includes,
  single namespace inherited from the Danish tax authority (SKAT). Clearly tool-generated.
- **ES — maximal consolidation.** Everything (all simple types, all code lists including the
  full ISO country table, all 18 record classes) lives in one self-contained file. Only one
  global element exists (`Lote`); the concrete class of every record is asserted by the
  *instance* via `xsi:type`, so consumers dispatch on type attributes, not element names.
- **GR — per-report schemas over a common library.** 26 report models, each a homogeneous
  `Batch` of one record type, sharing `CommonElements.xsd`. The only XSD 1.1 model in the
  set — substantial business logic (conditional mandatory fields, date ordering,
  bonus/jackpot field coupling) is enforced by `xs:assert` in the schema itself.
- **NL — small, uniform, versioned.** Eleven domain schemas so regular they share an
  identical four-field record header and an identical `Root`-of-max-512-records envelope.
  The schema version is baked into every record element name (`WOK_Bet_v1.11`).

## Granularity of reporting

| Level | DK | ES | GR | NL |
|---|---|---|---|---|
| Per bet/transaction | ✔ (fixed odds, purchases) | ✔ (settled bets, wallet operations) | ✔ (bets, wallet ledger) | ✔ (bets with 1–64 legs, transaction ledger) |
| Per player session | ✔ (casino, poker cash) | ✔ (casino/bingo/poker-cash sessions) | ✔ (game and P2P sessions, login sessions) | ✔ (game sessions — rounds only, no per-spin) |
| Lifecycle (start/txn/end) | ✔ (poker tournaments, pool games) | — (tournaments are single records) | ✔ (poker tournaments, 3 phases) | — |
| Daily aggregates | ✔ (EndOfDayRapport) | ✔ (CJT daily option) | ✔ (4 EndOfDay reports) | ✔ (operator day + rolling 365-day totals) |
| Monthly aggregates | — | ✔ (RUT, OPT, ORT, BOT, RUR, RUG, JUA) | ✔ (monthly finalisation of EoD) | — |
| Player register/KYC | Pseudonymous ID only | ✔ (RUD — the most detailed of the four) | ✔ (Customer Account) | Profile snapshot (pseudonymised) |

Spain is unique in mixing all cadences (monthly, daily-or-monthly, and event-grained records)
inside the same batch envelope. Denmark is unique in stitching event-driven verticals together
through a product-keyed start → transactions → end lifecycle. Greece has the highest-frequency
floor (2-hourly minimum for transactional data). The Netherlands is closer to a continuous
ledger with daily control totals.

## Financial modelling

- **DK** routes nearly every amount through one signed type with 10 decimal places (to
  survive currency conversion), always splits stake/winnings into *game* vs *jackpot*
  components, reports winnings *including* stake, and distinguishes licensee-level
  (`TillIndh`) from network-wide (`Total`) figures for shared-liquidity games. Monopoly
  amounts are net of Danish prize tax.
- **ES** models money as a repeating `Linea` list of `(Cantidad, Unidad)` — multi-currency
  by construction — and leans on a ubiquitous `Total` + `Desglose` (breakdown) pattern keyed
  by operator, game type, concept, payment method or jackpot. Liabilities (open bets,
  jackpot balances) get their own monthly record (BOT). GGR is a first-class reported figure.
- **GR** carries an ISO currency code beside every monetary block, tracks redeemable vs
  non-redeemable bonus money in nearly every report, and models jackpots with per-level
  profit-distribution parameters. Tax withholding appears per bet (sports) or per taxation
  session (casino/P2P).
- **NL** makes the player-account **transaction ledger the financial spine**: bets and game
  sessions do not carry authoritative money, they cross-reference `{Transaction_ID,
  Player_Profile_ID}` pairs into the ledger. Currency is implicitly EUR; some limit amounts
  are whole-euro integers.

## Player protection and identity

The jurisdictions sit at opposite ends of the privacy spectrum: Spain and Greece require full
identity (Spain's RUD even carries verification-method detail, sign-up IP/device, and
suspension history; Greece adds risk categories and affiliate attribution), while Denmark and
the Netherlands are strictly pseudonymous (Denmark explicitly forbids the CPR number; the
Dutch model carries no name or address at all).

Responsible gambling is present everywhere but deepest in the Netherlands, where five of
eleven record types exist solely for player protection (mandatory deposit/duration/balance
limits, RG classification flags, net-deposit-threshold events, duty-of-care interventions,
complaints). Spain embeds limits, self-exclusion, session planning and risk profiles inside
its player and session records; Greece has dedicated limits / limits-exceeded / exclusions
models with daily counters; Denmark's sample is the lightest on RG (its focus is financial
and game-integrity reporting: certified RNGs, machine checksums).

## Jurisdiction-specific constructs

Each model contains entities that simply do not exist elsewhere:

- **DK**: a parallel `Monopol*` schema family for Danske Spil's monopoly products (scratch
  cards to block level, Dantoto totalisator, EuroJackpot country pools); `Hesteagtig`
  ("horse-like") — the horse-racing model deliberately reused for any non-Danish-track pool
  betting; IOC country codes.
- **ES**: RUR shared-liquidity player mapping across network operators; RUG winners register
  with tax withholding for SELAE/ONCE retail winners; premium-rate phone/SMS contest
  metrics; fiscal-region codes; payment-instrument surveillance (last-4 digits, ownership
  verification, operation outcome).
- **GR**: **taxation sessions** (24-hour-capped fiscal play periods over which session-game
  winnings are taxed); first-class affiliate registration and payment reporting; roaming
  accounts for visitors; certification IDs for games, RNGs, roulette wheels and live
  studios; Bad Beat pools modelled as jackpots.
- **NL**: SHA-256 manifest hash chain making the whole submission history a tamper-evident
  ledger; net-deposit-threshold crossing events; `SUSPENDED_DEATH` player status; the Wwft
  (anti-money-laundering) transaction variant; an ASCII-art watermark in every schema.

## Implications for a unified platform

1. **No common export shape exists.** The intersection of the four models is roughly
   "players, bets, sessions, transactions, daily aggregates" — everything else
   (record envelopes, typing, keys, cadence) is jurisdiction-specific. A unified internal
   model needs a per-jurisdiction mapping/serialisation layer, not a shared schema.
2. **Internal amounts need high precision and explicit currency.** DK demands 10 decimal
   places; ES wants multi-currency line items; NL forbids a currency field. Store amounts
   with currency and full precision internally and round/format per target.
3. **Timestamps should be stored as instants (UTC).** Three targets require UTC (two by
   regex); ES needs reformatting to digit strings with optional local offsets.
4. **Corrections must be modelled generically.** Every regime supports corrections but the
   mechanics differ (file replacement, rectification links, cancel/replace records,
   replaced-record chains). The platform needs a generic "amend/void a previously reported
   fact" capability that each serialiser translates.
5. **Identity handling differs legally, not just technically.** The same player record must
   be exportable as full KYC (ES, GR) and as a pseudonym (DK, NL) — identity data should be
   separable from activity data.
6. **Integrity plumbing is per-target.** TamperToken/SAFE (DK), XML-DSig (ES), encrypt+sign
   manifests (GR), hash-chained signed manifests (NL) — submission packaging is a distinct
   concern from record generation.
7. **Network/shared-liquidity attribution is a recurring theme** (DK `TillIndh`/`Total`,
   ES `DesgloseOperador`/RUR, GR licensee vs network aggregates) and should be captured at
   source for poker and pool verticals.
