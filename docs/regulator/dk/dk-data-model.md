# Denmark (DK) — Spillemyndigheden Data Model

## Overview

This directory contains the XSD schema set for **Spillemyndigheden**, the Danish Gambling
Authority, defining the **"Standard Records"** that licensed gambling operators
(tilladelsesindehavere = licence holders) must produce and deposit on their **SAFE** — a
regulator-accessible FTP storage area — as tamper-evident XML files. Access and integrity are
tied to the **TamperToken** system: the `SpilCertifikatIdentifikation` element is the
TamperToken username, which maps to the operator's SafeId.

The schemas live in the namespace `http://skat.dk/begrebsmodel/2009/01/15/` (prefix
`fase2.1`), reflecting their origin in the concept model ("begrebsmodel") of SKAT, the Danish
tax authority, under which the gambling regulator originally operated. The current standard
records version is `v2` (`SpilFilVersionType`); the monopoly variant is `v1`
(`MonopolSpilFilVersionType`).

### Three-layer architecture

The ~110 XSD files are decomposed into three folders, all sharing the single target namespace
(so `xs:include` composition works without imports — a "chameleon include" style):

| Layer | Folder | Count | Role |
|---|---|---|---|
| Simple types | `types/` | ~47 | One reusable `xs:simpleType` per file (amounts, texts, dates, enumerations). |
| Classes | `class/` | ~51 | One conceptual entity per file, declared as a flat set of **global `xs:element`s** (leaf fields), each typed by a simple type and carrying rich Danish `xs:documentation`. No complex types here. |
| Views | `view/` | 7 | One report structure ("Struktur") per file: a `xs:complexType` that assembles the report layout inline and references (`xs:element ref=`) the global elements from the class layer it `xs:include`s. |

A view is therefore a projection: it defines the *shape* of a report (nesting, lists,
optionality, choices) while the *semantics* of every field live once in the class layer. The
class layer here covers many more report types (fixed odds, pool games, slot machines, all
the monopoly games) than the seven view files present — the views for those verticals follow
the same pattern but are not included in this snapshot.

## Language and naming conventions

Everything is in Danish — element names, type names, and documentation. Element names follow
`<ClassName><Attribute>` camel case, e.g. `KasinospilIndskudSpil` = "casino game — stake
(game portion)". Notably, **element and type names use real Danish characters** (æ, ø, å):
`SpilKøbDatoTid`, `BeløbPositivNegativ10Decimaler10Type`, `PokerSessionAntalHænder` — while
**file names are ASCII-transliterated** (`PokerKoeb.xsd`, `BeloebType.xsd`,
`PokerHaand.xsd`, `TilfaeldighedGenerator.xsd`). A few elements exist in both spellings as
duplicates (e.g. `SpilKøbDatoTid` and `SpilKoebDatoTid` in `class/Spil.xsd`).

Key vocabulary:

| Danish | English |
|---|---|
| Spil | game / bet (the unit a player buys) |
| Spiller | player |
| Indskud | stake / deposit (wager amount) |
| Gevinst | winnings / payout |
| Beløb | amount |
| Køb | purchase |
| Puljespil | pool game (pari-mutuel) |
| Række | row / line (of a pool coupon) |
| Kamp | match / event within a row |
| Nøgle | key (result key describing outcomes) |
| Væddemål | bet / wager |
| Tilladelsesindehaver (abbrev. **TillIndh**) | licence holder / operator |
| Salgskanal | sales channel |
| Annullering | cancellation |
| Lodtrækning | draw (lottery) |
| Skrab / skrabespil | scratch (card) game |
| Talspil | number game (lotto-style) |
| Hest / Hesteagtig | horse / "horse-like" |
| Spilleautomat | slot machine |
| Tilfældighedgenerator | random number generator (RNG) |
| Valuta / kurs | currency / exchange rate |
| Antal | count / number of |
| Træk | draw / spin (a single casino game round) |
| Hånd | hand (poker) |
| Spilsted | venue / place of play |
| Omsætning | turnover |

Two recurring suffixes: **`TillIndh`** = figure for this licence holder only, vs **`Total`**
= figure across the whole (possibly multi-operator) network — used throughout poker
tournaments, pool games and manager games that can run on shared liquidity networks
(`SpilProduktÅbentNetværk` flags open vs closed network).

## Key entities

**File / licence plumbing (used by every report):**

- `SpilFil` — the XML file itself: `SpilFilVersion` (`v2`), `SpilFilIdentifikation` (unique,
  e.g. UUID), `SpilFilErstatningIdentifikation` (id of an earlier faulty file this one
  replaces), `SpilFilPlacering` (FTP folder on the SAFE).
- `SpilCertifikat` — the licence: `SpilCertifikatIdentifikation` (TamperToken username /
  SafeId), permit type (`Væddemål`, `OnlineKasino`, `VæddemålOgOnlineKasino`,
  `KasinoSpilleautomater`, `Monopol`), validity dates.
- `SpilKategori` — regulator-defined game category (`SpilKategoriNavnType` enumeration, 18
  values: `Fastoddsspil`, `FastoddsspilBetexchange`, `Puljespil`, `PokerTurnering`,
  `PokerCashGame`, `KasinospilSinglePlayer/MultiPlayer`, `Managerspil`, `Bingospil`,
  `HestDK`, `Hesteagtig`, `SpreadBetting`, `PuljeRNG`, etc.).
- `SpilProdukt` — the operator's own product naming beneath the category:
  `SpilProduktNavn` (e.g. "Tips13") and `SpilProduktIdentifikation` (e.g. "Tips13-uge10"),
  which is the key that binds start / transaction / end structures together for poker
  tournaments, pool games and manager games.
- `SpillerInformation` — a single pseudonymous `SpillerInformationIdentifikation` (operator's
  own unique player id; explicitly must **not** be the Danish CPR number).

**Transaction core (`Spil`):** one purchase by one player — `SpilTransaktionIdentifikation`
(unique per purchase; reused only to report a cancellation of that purchase),
purchase/settlement timestamps (all documented as UTC), `SpilSalgskanal`, place of play as a
choice of `SpilTerminalIdentifikation` (land-based) or `SpilHjemmeside` (URL, online), stake
split into `SpilIndskudSpil` + `SpilIndskudJackpot`, winnings split into `SpilGevinstSpil` +
`SpilGevinstJackpot` (winnings are reported **including** the stake), `SpilKommission`, and a
cancellation flag `SpilAnnullering` (0/1) with `SpilAnnulleringDatoTid`.

**Per-vertical classes:**

| Entity | File(s) | Content |
|---|---|---|
| Casino games | `Kasinospil.xsd`, `KasinoTraek.xsd` | Player-vs-house RNG games, reported per player session: sub-category (`roulette`, `blackjack`, `spilleautomat`, …), stake/winnings split game vs jackpot, number of spins (`AntalTræk`), commission. A "træk" is the atomic spin. |
| Poker cash game | `PokerSession.xsd`, `PokerHaand.xsd` | One session = one player at one table: total stakes, rake (excl. jackpot contribution), winnings, number of hands. |
| Poker tournament | `Poker.xsd`, `PokerKoeb.xsd` | Tournament aggregates: player counts, buy-in/rebuy/add-on amounts and counts (each as TillIndh + Total), fees, guaranteed prize-pool top-up (`PokerTilføjetPrizepool`), payouts; individual purchases typed `buyin`/`rebuy`/`addon` with amount and fee. `PokerKvalifikation` (1–4) encodes satellite relationships. |
| Pool games | `Puljespil.xsd`, `Raekke.xsd`, `PuljespilNoegle.xsd`, `GevinstPulje.xsd`, `Andele.xsd`, `KunToppulje.xsd` | Pari-mutuel: payout percentage, number of result pools, row price, rows played (TillIndh/Total), end-of-game close time, winning row (comma list), prize pools with carry-over (primo/ultimo), per-player share (`Andel`, decimal 0–1). |
| Manager games | `Managerspil.xsd`, `ManagerspilKoeb.xsd` | Fantasy-manager pool variant: enrolment + in-game purchases (`Tilmelding`, `TilkøbTilPulje`), fees, prize pool. |
| Fixed odds support | `Begivenhedsinformation.xsd`, `OddsAngivelse.xsd`, `Sportsgren.xsd`, `Land.xsd` | Event name/id, outcome name/id, odds, sport code (large Danish enumeration: `Fodbold`, `Håndbold`, …), country codes. |
| Jackpots | `Jackpot.xsd` | Cross-game progressive jackpots: identification, trigger date/time, total win, per-player win, commission/rake share. Fed by the `IndskudJackpot` fields of every vertical. |
| Slot machines | `Spilleautomat.xsd`, `SpilleautomatJackpot.xsd`, `Kasino.xsd`, `SpilstedEndOfDayRapport.xsd` | Land-based gaming machines: manufacturer, machine number/name, program version and checksum, payout percentage, credits played/won, meter-reading timestamps; venue-level (`Spilsted`) daily aggregates; `KasinoIdentifikationType` enumerates the seven licensed land casinos (København, Aalborg, Aarhus, Odense, Vejle, Helsingør, Pearl Seaways). |
| Horse racing | `HestDK*.xsd`, `Hesteagtig*.xsd`, `HestPuljespil.xsd` | Pool betting on races: event/race numbers, reserve and withdrawn horses, turnover before/after cancellations, bet types as enums (`Vinder`, `Plads`, `Trio`, `V65`, `V75`, …). `HestDK` = races on Danish tracks; `Hesteagtig` ("horse-like") is the same generic model reused for anything *other than* Danish horse racing. |
| Number games / draws | `TalSpil.xsd`, `Lodtraekning.xsd` | Lotto-style games: number keys, valid numbers, row price, pools, winning row; draw sequence and responsible party. |
| End-of-day | `EndOfDayRapport.xsd` | Daily aggregates per game category: count of games, stakes (game/jackpot/total), winnings (game/jackpot, count, gross vs net of prize tax for monopoly), commission/rake, total turnover net of cancellations. |
| RNG | `TilfaeldighedGenerator.xsd` | Certified RNG identification + software id with validity dates. |
| Currency | `ValutaOplysning.xsd` | ISO currency code, exchange rate (6 decimals), rate date. |

**Monopoly (`Monopol*`) classes** mirror the above for the state monopoly operator (Danske
Spil): `MonopolSpilKategoriNavnType` enumerates the monopoly portfolio (`MonopolLoerdagsLotto`,
`MonopolVikingLotto`, `MonopolEuroJackpot`, `MonopolKeno`, `MonopolDantoto`, `MonopolBingo`,
`MonopolNetskrab`, `MonopolFysiskSkrab`, `MonopolKlasseLotteri`, …). They add
monopoly-specific detail: Dantoto horse-race totalisator (track name/number, coupon types
`Normal`/`Lyn`/`SmartLyn`), physical scratch cards down to module/block/ticket level including
stolen-and-returned blocks, prize master data (`MonopolGevinstStamdata`), and international
pool data per country (`MonopolLandeData`, e.g. EuroJackpot). Monopoly amounts are reported
**net of prize tax (gevinstafgift)**, a rule repeated in field documentation via
"Monopol:" prefixed notes inside otherwise shared elements.

## Data typing approach

All leaf fields resolve to a small set of heavily reused simple types:

| Type | Base | Constraints | Notes |
|---|---|---|---|
| `BeløbPositivNegativ10Decimaler10Type` | `xs:decimal` | ±9,999,999,999; totalDigits 20, **10 fraction digits** | The workhorse money type — used for virtually every stake, winning, fee, rake, commission and pool amount. The generous 10-decimal precision exists to survive currency conversion without rounding loss. |
| `BeløbType` | `xs:decimal` | 13 digits, 2 decimals | Classic money format; used for exchange-rate amounts (`ValutaOplysningKurs`). |
| `BeløbPositiv18UdenDecimalerType` | `xs:integer` | 0 … 10^18−1 | Positive whole-number amount. |
| `DatoTidType` | `xs:dateTime` | — | Timestamps; documentation consistently mandates **UTC**. |
| `DatoType` / `SlutdatoType` | `xs:date` | — | Calendar dates. |
| `Tekst30/45/300Type`, `Tekst45minLength1Type` | `xs:string` | maxLength 30/45/300 | Fixed-width free text; `TekstKortType` = 100 chars, `TekstLangType` = 500. |
| `TalHelType` / `AntalType` | `xs:integer` | 0 … 10^18−1 / 12 digits | Counts. |
| `Tal1Type` / `Tal2Type` | `xs:integer` | 1 / 2 digits | `Tal1Type` doubles as a **boolean** (0/1) — e.g. `SpilAnnullering`, `SpilProduktÅbentNetværk`. |
| `ProcentType` | `xs:decimal` | 6 digits | Percentages. |
| `ValutaType` | `xs:string` | `[A-Z]{2,3}` | ISO currency code (`ValutaOplysningKode` appears in every money-bearing structure). |
| `ValutaKursType` | `xs:decimal` | 11 digits, 6 decimals | Exchange rate. |

Enumerations are the second pillar: sales channel (`Forhandler`, `Internet`, `Mobil`,
`Selvbetjening`, `Andet`), game category, casino sub-category (lower-case values), poker
purchase type (`buyin`/`addon`/`rebuy`), permit type, sport codes, horse bet types, and
country codes. Curiously, `LandeKodeType` uses **IOC-style three-letter codes** (`DEN`,
`GER`, `SUI`, plus pseudo-codes like `EUR`, `WOR`) rather than ISO 3166, while
`AdresseLandKodeType` is a two-letter ISO pattern.

## Reporting structure

Every submission is one XML file on the SAFE whose root corresponds to one view "Struktur".
All seven views share the same skeleton:

1. **`FilInformation`** — `SpilFilVersion` + `SpilFilIdentifikation` (+ optional
   `SpilFilErstatningIdentifikation` to replace a previously submitted faulty file).
2. **`Tilladelsesindehaver[OgSpil]`** — `SpilCertifikatIdentifikation` + `SpilKategoriNavn`
   (+ `SpilProduktNavn` / `SpilProduktIdentifikation` for product-scoped reports).
3. **Payload** — a report-specific list.

The views in this snapshot:

| View | Cadence / trigger | Payload |
|---|---|---|
| `EndOfDayRapportStrukturType` | Daily | `SpilOpgørelseListe`: per game category — games count, stakes (game/jackpot), winnings, commission/rake, plus report date and currency. |
| `KasinospilPrSessionStrukturType` | Per batch of sessions | `KasinospilSession` list: product, player, transaction id, timestamps, channel, casino sub-category, stakes/winnings, spin count, place of play (terminal ⊕ website choice), RNG list, optional cancellation, jackpot contribution list. |
| `PokerCashGamePrSessionStrukturType` | Per batch of sessions | Same skeleton with `PokerSession*` fields (stakes, rake, winnings, hand count). |
| `PokerTurneringStartStrukturType` | Tournament start | Product identification, open/closed network flag, associated jackpot ids. |
| `PokerTurneringTransaktionStrukturType` | During tournament | Player purchases: type (buyin/rebuy/addon), amount, fee, channel, place of play, cancellation, jackpot contributions. |
| `PokerTurneringSlutStrukturType` | Tournament end | Full aggregates (players, buy-ins/rebuys/add-ons ×{amount,count}×{TillIndh,Total}, fees, added prize pool, payouts), RNG list, and a winner list (player id, transaction id, game/jackpot winnings). |
| `JackpotUdloesningStrukturType` | Jackpot hit | Jackpot id, trigger time, total win, commission, currency, and per-player winner list. |

Event-driven verticals thus follow a **start → transaction(s) → end** lifecycle stitched
together by `SpilProduktIdentifikation` (tournaments, pool games, manager games) or by
`SpilTransaktionIdentifikation` (purchase ↔ cancellation, transaction ↔ settlement), with a
daily `EndOfDayRapport` as the aggregate control total.

## Notable characteristics and quirks

- **Tax-authority heritage**: the namespace and several types (`ValutaType` documentation
  mentions SKAT can only receive DKK declarations) come straight from SKAT's 2009 concept
  model; the schemas embed regulatory guidance, worked examples (with kroner amounts) and
  edge-case rules directly in `xs:documentation`.
- **Monopoly parallel universe**: ~14 `Monopol*` class schemas replicate the general model
  for Danske Spil's exclusive products, with net-of-prize-tax amounts, `v1` file version and
  extra stamdata — while shared elements carry inline "Monopol:" annotations changing their
  meaning in monopoly context.
- **Horse-racing oddities**: `HestDK` (Danish tracks) vs `Hesteagtig` ("horse-like") — the
  latter explicitly reuses the horse model for *any* non-Danish-track pool betting, its own
  documentation warning not to take the word "horse" literally.
- **Danish characters in XML names** but ASCII file names, plus duplicate ASCII-spelled
  element variants (`SpilKoebDatoTid`, `SpilleautomatUdtraekDatoTid`) coexisting with the
  æ/ø/å originals.
- **Per-player, per-session granularity**: casino and poker cash games are reported per
  player session, not per spin/hand — but only sessions of **Danish players** are reported
  (betting-exchange sides are separate transactions; only matched bets are reported).
- **Booleans as digits/strings**: 0/1 integers (`Tal1Type`) or even string enums of "0"/"1"
  (`KunToppuljeType`), rather than `xs:boolean` (which exists as `MarkeringType` but is
  little used).
- **Generated-artifact noise**: the files are clearly tool-generated — erratic indentation,
  blocks of blank lines inside complex types, leftover `<!--Sequence removed-->` comments,
  empty `xs:documentation` elements and an `r7165` revision marker in every view.
- **Compliance details built in**: replacement-file mechanism, certified RNG identification
  attached to every RNG-based session, machine program checksums for slots, and explicit
  prohibition on using CPR numbers as player identifiers.
