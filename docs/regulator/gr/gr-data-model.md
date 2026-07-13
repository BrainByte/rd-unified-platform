# Greece (GR) — Hellenic Gaming Commission Data Model

## Overview

This directory contains the XSD schemas defining the regulatory reporting data model of the **Hellenic Gaming Commission** (HGC / Ε.Ε.Ε.Π. — Επιτροπή Εποπτείας και Ελέγχου Παιγνίων) for **online gambling licensees**. Licensees ("License Holders", identified by their Greek VAT number in the form `elXXXXXXXXX`) must continuously record gaming activity as XML data batches into a tamper-evident local store called the **SAFE**, from which the regulator can retrieve them. All schemas target the namespace `https://www.gamingcommission.gov.gr` (version 1.0, XSD 1.1 — they rely on `xs:assert` cross-field rules).

The architecture has three layers:

1. **`CommonElements.xsd`** — a shared library of simple types (identifiers, monetary amounts, UTC timestamps, strings) and the common `BatchHeader` complex type. Every report schema `xs:include`s it.
2. **Per-report-type schemas** (`Online_*.xsd`, 26 data models) — each defines a single root `Batch` element containing a `BatchHeader` plus an unbounded sequence of records of one entity type (e.g. `Online_Betting`, `Online_Customer_Account`). One XML file therefore carries exactly one data model.
3. **`Online_Manifest_Model.xsd`** — the `ControlManifest` envelope that accompanies each data file: it identifies the licensee, server, sequence number and data model, carries record-count/size/time-range metadata, and wraps the payload in W3C **XML Encryption** (`xenc:EncryptedKey`/`EncryptedData`) and **XML Digital Signature** (`dsig:Manifest`/`dsig:Signature`).

Every schema's `Batch` element carries a bilingual (Greek/English) annotation stating the **required submission frequency** (event-driven, minimum every 2 hours, daily at end of Gaming Day, or on the 1st/15th of each month).

## Naming conventions

- Element names are **English UpperCamelCase** (`BetPlacedDate`, `TotalAmountWagered`, `PlayerID`); all documentation annotations are given in Greek first, then English.
- Record container elements mirror the file name with underscores: `Online_Customer_Account`, `Online_Bet_Event`, `Online_EndOfDay_PtP_Game`, etc.
- Identifier types end in `ID`; most are licensee-assigned strings ≤ 40 chars (`GenericID`), while a few are **HGC-assigned** certification codes (`GameID`, `StudioID`, `RNGID`, `RouletteID`, `AffiliateID`, `ManufacturerLN`).
- Prefixes distinguish domains: `PtP…` (peer-to-peer games), `PT…` (poker tournaments), `Bet…` (sports betting), `Total…`/`Licensee…` (aggregates — network-wide vs. this licensee).
- Multi-level classification enumerations are suffixed with letters: `BetEventCategoryA/B/C/D`, `GameCategoryA/B`, `PtPGameCategoryA/B/C`, `BonusCategoryA/B`.
- A couple of unusual names exist: `V.A.T.Number` and `A.M.K.A.Number` contain literal dots.

## Report catalog

The manifest's `xsdnumber` element enumerates the data models (the enumeration allows 1–28, with 26 documented models):

| # | Data model | Schema file | Contents |
|---|------------|-------------|----------|
| 1 | Bet Events | `Online_Bet_Events.xsd` | Catalog of bet events and their markets, 4-level categorisation, event/creation/result dates, cancellation data. |
| 2 | Bettings | `Online_Bettings.xsd` | Individual bets placed: player, platform, selections with odds, stake (incl. non-redeemable bonus portion), IP, session, domain. |
| 3 | Bet Winnings | `Online_Betting_Winnings.xsd` | Bet settlement: per-selection and per-bet outcome, gross/net amounts won, withholding tax, bonus amounts, resettlement indicator. |
| 4 | EndOfDay Bettings | `Online_EndOfDay_Bettings.xsd` | Daily betting aggregates per bet-event category and bet type: wager/settled counts, players, amounts, tax, bonuses. |
| 5 | Games | `Online_Games.xsd` | Casino (house) game sessions per player: stakes, winnings, jackpot rake, bonus amounts, RNG vs. live-studio certification data. |
| 6 | EndOfDay Games | `Online_EndOfDay_Games.xsd` | Daily casino-game aggregates per game category: sessions, players, amounts, jackpots, incomplete sessions. |
| 7 | Peer to Peer Games | `Online_Peer_to_Peer_Games.xsd` | P2P game sessions (e.g. poker cash games): buy-ins, licensee rake, jackpot rake, rake-back, poker-hand counts, open/closed network flag. |
| 8 | EndOfDay PtP Games | `Online_EndOfDay_PtP_Games.xsd` | Daily P2P aggregates: sessions, hands, players, amounts, rake, rake-back bonuses, jackpots. |
| 9 | Poker Tournament Start | `Online_Poker_Tournament_Start.xsd` | Tournament registration: game variant, type, network common ID, start/estimated end dates. |
| 10 | Poker Tournament Transactions | `Online_Poker_Tournament_Transactions.xsd` | Per-player tournament transactions (entry stake/fee, buy-in, add-on, rebuy, rakes, prizes, jackpot, bonuses) with withholding tax. |
| 11 | Poker Tournament End | `Online_Poker_Tournament_End.xsd` | Tournament settlement: participants (total and per country/operator), stakes/fees, prize pools, jackpots, net winnings and tax — network-wide and licensee-level figures side by side. |
| 12 | EndOfDay Poker Tournaments | `Online_EndOfDay_PokerTournaments.xsd` | Daily aggregates for tournaments taxed in the reporting day. |
| 13 | Jackpot Parameters | `Online_Jackpot_Parameters.xsd` | Jackpot configuration: type, status, per-level profit-distribution parameters (increase rate, floor/ceiling, accumulated amounts), linked paytables, jackpot-to-jackpot transfers. |
| 14 | Jackpot Winnings | `Online_Jackpot_Winnings.xsd` | Jackpot payouts: won amount and rake per jackpot level, plus per-player breakdown linked to the winning session/tournament. |
| 15 | Log In Sessions | `Online_Log_In_Sessions.xsd` | Player login sessions: start/end, end reason, IP, geo-location (Greek postcode), channel (PC/mobile), roaming indicator. |
| 16 | Bonus Schemas | `Online_Bonus_Schemas.xsd` | Bonus catalogue: redeemable vs. non-redeemable classification, cumulative given/used counts and amounts, wagering requirements. |
| 17 | Exclusions | `Online_Exclusions.xsd` | Player exclusions/self-exclusions: initiator channel, duration category, request/start/end dates, reason. |
| 18 | Limits | `Online_Limits.xsd` | Responsible-gambling limits set by players (or licensee/HGC): time/deposit/loss × daily/weekly/monthly, old vs. new values. |
| 19 | Limits Exceeded | `Online_Limits_Exceeded.xsd` | Attempts to exceed limits: exceeded duration/amount, linked session/tournament/transaction. |
| 20 | EndOfDay Other | `Online_EndOfDay_Other.xsd` | Daily "everything else": total player account balances, players' bank account balance, net game-session winnings, withholding tax, taxation-session count, bonus/exclusion/limit counters. |
| 21 | Customer Account | `Online_Customer_Account.xsd` | Player registry: username, account type (Greek/roaming), status and status reason, KYC data, identity (ID card or passport, VAT, AMKA), address, risk category, exclusion flag, affiliate links. |
| 22 | Customer Account Transactions | `Online_Customer_Account_Transactions.xsd` | Player wallet ledger: debit/credit, amount, resulting balance, link to bet/game/poker/bonus, payment-provider details for deposits/withdrawals. |
| 23 | Affiliate Account | `Online_Affiliate_Account.xsd` | Affiliate registry: HGC and licensee affiliate IDs, status, collaboration agreement number. |
| 24 | Affiliate Account Transactions | `Online_Affiliate_Account_Transactions.xsd` | Payments made to affiliates: amount, date, currency, payment means/provider/BIC. |
| 25 | Contests Draws | `Online_Contests_Draws.xsd` | Promotional contests and draws: prize type, prize names, cumulative prizes given, participation requirements. |
| 26 | Taxation Sessions | `Online_Taxation_Sessions.xsd` | Per-player taxation sessions (casino/P2P games): opening balance, deposits, redeemable bonus, taxed amount, net winnings, withholding tax, aggregated game-session stakes/wins and jackpot amounts, linked login sessions. |

## Record envelope: cancellation and replacement

Every record in every report shares the same envelope:

- `RecordID` — a UUID assigned by the licensee, unique within the file (enforced by `xs:unique` on each `Batch`).
- A `xs:choice` between:
  - **`CancelledRecordData`** (`CancelledRecordID` + `CancelledRecordDate` + `CancelledRecordReason`) — voids a previously submitted record; or
  - the actual payload, optionally preceded by **`ReplacedRecordID`** — a correction that supersedes an earlier record.

This gives the regulator a full append-only audit trail: records are never edited in place, only cancelled or replaced.

## Key entities and relationships

- **Player (`PlayerID`)** — the central entity. Registered in *Customer Account* (with KYC, identity documents, risk category, affiliate attribution) and referenced from nearly every other model: wallet transactions, bets, game sessions, sessions, limits, exclusions, taxation sessions, jackpot wins.
- **Login session (`LogInSessionID`)** — a play session (login → logout). Bets, game sessions and poker transactions all reference the login session in which they occurred.
- **Taxation session (`TaxationSessionID`)** — a fiscal construct (art. 60, law 2961/2001): the period from platform login until logout, capped at 24 hours. Winnings from **session-based games** (live casino, RNG casino, live P2P, P2P cash games — *not* sports betting) are taxed at taxation-session close. Game and P2P game session records carry the `TaxationSessionID`, and a session is reported in the end-of-day figures of the day its taxation session is processed.
- **Bet (`BetID`) → Bet events/markets** — a bet references one or more `BetEventData` items (`BetEventID` + `MarketID` + `PlayerSelection` + odds). Bet events and their markets are catalogued separately in *Bet Events* (with optional HGC-assigned `HGCMarketID`); settlement and resettlement flow through *Betting Winnings*.
- **Game session (`GameSessionID`) / P2P game session (`PtPGameSessionID`)** — one player's participation in one game. House games split into RNG games (certified `GameID`, `PaytableID`, `RNGID`) and live-studio games (`StudioID`, `TableID`, `RouletteID` for roulette) via a mandatory choice enforced by asserts on `GameCategoryA`. P2P sessions additionally carry licensee rake and rake-back, an open/closed **network indicator**, and hand counts for poker cash games.
- **Poker tournament (`PokerTournamentID`)** — a lifecycle of three reports: *Start* (definition, optional network-wide `PTCommonID`), *Transactions* (typed per-player money movements), *End* (final network-wide vs. licensee aggregates, prize pools, jackpot/Bad-Beat figures, per-country/per-operator participant breakdown).
- **Jackpot (`JackpotID`)** — configured in *Jackpot Parameters* with one or more **profit distribution levels** (each with increase rate, start-up amount, floor/ceiling limits, accumulated amount and rake) and linked paytables; payouts recorded in *Jackpot Winnings* down to player/session level. Game sessions that contribute report a `JackpotRake`, and asserts tie the presence of `JackpotID` to the presence of the rake amount. Poker **Bad Beat** pools are modelled as jackpots.
- **Bonus (`BonusID`)** — defined in *Bonus Schemas* as redeemable (cash-back, rake-back) or non-redeemable (free bets, free spins) with wagering requirements. Bets, game sessions, and poker transactions reference bonuses; asserts require the corresponding bonus amount fields whenever a `BonusID` is present (and forbid them otherwise).
- **Responsible gambling** — *Limits* (9 categories: time/deposit/loss × daily/weekly/monthly, per license type, initiated by player/licensee/HGC), *Limits Exceeded* (violations, linked to the session or transaction involved), and *Exclusions* (exclusion vs. self-exclusion, indefinite / fixed / 24-hour). Daily counters for all of these roll up into *EndOfDay Other*.
- **Affiliate (`AffiliateID`, HGC-assigned)** — registered with status and agreement number; payments to affiliates are reported; players record their affiliate relationships (ID + relation date) in the customer account.

## Data typing approach

Shared simple types from `CommonElements.xsd`:

| Type | Definition | Notes |
|------|-----------|-------|
| `dateTimeUTC` | `xs:dateTime` with pattern `(19\|2).+Z` | All timestamps are UTC, `Z`-suffixed. |
| `MonetaryAmount` | decimal, 2 fraction digits, 13 total, ±9 999 999 999.99 | The universal money type (signed). |
| `PositiveMonetaryAmount` | decimal ≥ 0.00, 12 total digits | Used for limit amounts. |
| `Currency` | `[A-Z]{3}` | ISO 4217; every monetary block carries its currency. |
| `CountryCode` | `[A-Z]{3}` | ISO 3166-1 alpha-3. |
| `RecordID` | UUID pattern, length 36 | Record identity. |
| `FileID` | positive integer ≤ 40 digits | Batch/manifest sequence number. |
| `LicenseeID` | `el` + 9 digits | Licensee's Greek VAT number. |
| `GenericID` / `CollapsedGenericID` | string 1–40 chars | Base for most entity IDs (`BetID`, `PlayerID`, `JackpotID`, …, derived by restriction). |
| `LongString` / `LongStringPreserve` / `ExtraLongString` / `ExtraSmallString` | strings 200 / 255 / 1000 / 40 chars | Names and descriptions. |
| `DomainName` | lowercase domain pattern, 8–40 chars | The licensee website the activity occurred on. |
| `NumberOfPlayers` | integer 0–9 999 999 | Player counts in aggregates. |
| `BetEventCategoryA` | enum 1–4 | Sports / fantasy / virtual / other events. |

Enumerations are the dominant pattern for coded values: integer-based (`xs:positiveInteger`/`xs:nonNegativeInteger` restrictions), defined **inline** in each report schema with bilingual value lists in the annotation; `0` conventionally means "Other". Booleans are used for indicator flags (adjustment, resettlement, roaming, network, cancellation, bonus restriction).

**XSD 1.1 asserts** encode substantial business logic, e.g.: KYC date must exist for active/inactive accounts but not temporary ones; payment-provider fields must appear together with the payment means; date ordering (`start ≤ end`, creation < result); limit category determines whether duration or amount fields apply; profit-distribution level counts must match the number of level entries; bet-event category C drives whether category D and country codes are required.

## Reporting / submission structure

- **Data files**: each XML file is a `Batch` = `BatchHeader` (`FileID` sequence number + `LicenseeID`) + N records of a single data model. Files are written to the licensee's SAFE.
- **Manifest**: each data file is described by a `ControlManifest` containing `licenseholderId`, `serverId` (SAFE file server, `[-_a-z0-9]{1,10}`), `generationDate`, `manifestSequenceNumber`, the `xsdnumber` model code, and `metadata` (`numberOfRecords`, first/last record timestamps, compressed and uncompressed sizes). The payload is compressed, encrypted (XML-Enc, with one or more `EncryptedKey`s) and signed (XML-DSig).
- **Frequencies** (from batch annotations): reference/master data (customer accounts, bet events, poker tournament starts, exclusions, jackpot parameters, bonus schemas, contests, affiliates) is event-driven ("whenever added/changed") with periodic minimums (2-hourly, monthly, or 1st and 15th of the month); transactional data (bets, winnings, wallet transactions, game and P2P sessions, login sessions, poker transactions) at minimum **every 2 hours**; limits, limits-exceeded and the four **EndOfDay** reports **daily at the end of the Gaming Day**; taxation sessions whenever processed; poker tournament end on completion.
- **Finalisation**: end-of-day records are provisional until finalised **within 16 days of the end of the calendar month**; corrections use the cancel/replace envelope.

## Notable characteristics and quirks

- **Bilingual schema**: every element is documented in Greek and English; the English is occasionally rough ("The toal number of Poker Hands") but authoritative value lists appear in both languages.
- **Taxation sessions** are a Greece-specific fiscal entity: player winnings tax for session-based games is computed per taxation session (24-hour-capped login period spanning multiple games/platforms), not per game round; sports-betting tax is instead reported per bet in *Betting Winnings* (`WithholdingTax`). Daily tax totals roll up in *EndOfDay Other*.
- **Affiliate reporting** is unusually first-class: affiliates are HGC-registered entities, their payments are reported, and player-affiliate attribution (with relation date) is part of the customer account record.
- **Redeemable vs. non-redeemable bonuses** are tracked pervasively — separate wagered/won amount fields appear in bets, winnings, game sessions, P2P sessions, tournaments and all end-of-day reports, with asserts binding these fields to `BonusID` references.
- **Certification-heavy game model**: games, RNGs, roulette wheels, studios, platform manufacturers all carry HGC certification numbers; the schema forces RNG-specific vs. live-studio-specific blocks depending on the game category.
- **Poker networks**: P2P games and tournaments may run on open (multi-jurisdiction) networks — the `NetworkIndicator` flag, network-wide vs. licensee-level aggregate pairs in *Poker Tournament End*, and per-country/per-operator participant breakdowns exist to support shared liquidity. Bad Beat pools are reported as jackpots.
- **Roaming accounts**: visitors to Greece may play on temporary "roaming" accounts, flagged in the account type and in each login session.
- **Incomplete sessions/transactions** carry an 8-value reason code (communication loss, platform reboot, device malfunction, etc.) and are counted in end-of-day reports.
- **Uniqueness only per file**: `xs:unique` guarantees `RecordID` uniqueness within a batch; global uniqueness and cross-file referential integrity (e.g. that a `BetID` in winnings was previously reported in bettings) are the licensee's responsibility.
- The manifest's `xsdnumber` enumeration permits values 27 and 28 that have no documented model name — presumably reserved for future report types.
