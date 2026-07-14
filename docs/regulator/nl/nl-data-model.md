# Netherlands (NL) — Kansspelautoriteit (KSA) Data Model

## Overview

The **Kansspelautoriteit (KSA)** is the Dutch gambling regulator. Under the **Wet op de kansspelen (WOK)** — the Dutch Betting and Gaming Act, as amended by the Remote Gambling Act (Wet kansspelen op afstand, KOA) — licensed online operators must continuously record gameplay, financial, and player-protection data in a **Controle Databank (CDB)**, a "control database" (data safe) to which the regulator has access. The schemas in this directory define **version 1.11** of that data model ("Version 1.11 Authorized for public release").

The architecture is a small, highly regular family of XSDs:

| Layer | File(s) | Purpose |
|---|---|---|
| Shared types | `include_v1.11.xsd` | Common simple types (UTC timestamps, UID, monetary amount, bounded strings, enumerations) included by every other schema |
| Data models | `wok_*_v1.11.xsd` (11 files) | One schema per reporting domain (operator, game, game session, bet, player profile, transactions, limits, flags, net deposit threshold, intervention, complaint) |
| Corrections | `ksa_cancellation_v1.11.xsd` | Record-level cancellation of previously submitted records of any WOK type |
| Batch control | `ksa_control_manifest_v1.11.xsd` | Manifest describing each submitted batch: metadata, SHA-256 hash chain, encryption keys, and digital signature |
| Security (W3C) | `xmldsig-core-schema.xsd`, `xenc-schema.xsd`, `xenc-schema-11.xsd` | Standard W3C XML Signature and XML Encryption schemas used by the manifest to sign and encrypt submissions |

Every data-model schema follows the same shape: a `Root` element containing between 1 and **512** records of a single versioned record type (e.g. `WOK_Bet_v1.11`). Data files are therefore homogeneous batches, and larger volumes are split across multiple files, each accompanied by a control manifest.

## Naming conventions

- **Schema files**: lowercase snake_case with an explicit version suffix — `wok_<domain>_v1.11.xsd`, `ksa_<function>_v1.11.xsd`, `include_v1.11.xsd`. The `wok_` prefix ties each data model to the Betting and Gaming Act; `ksa_` files are regulator plumbing (manifest, cancellation).
- **Record elements**: PascalCase-with-underscores including the version, e.g. `WOK_Player_Account_Transaction_v1.11`, `KSA_Cancellation_v1.11`. The version is baked into the element name, so a data file is unambiguously tied to a schema version.
- **Fields**: `Underscore_Separated_PascalCase` (e.g. `Extraction_Date`, `Bet_Total_Stake`). Domain-specific fields are prefixed with their entity (`Game_Session_Rounds`, `Part_Odds`, `Deposit_Time_Window`), which keeps names self-describing inside nested structures.
- **Enumeration values**: UPPER_SNAKE_CASE (e.g. `SELF_EXCLUDED_TEMP`, `NET_DEPOSIT_THRESHOLD`). Nearly every enumeration ends with an `OTHER` escape value, and several carry the comment "More values may be added in future versions."
- **Common header**: every record, regardless of type, begins with the same four mandatory fields — `Record_ID` (UID), `Extraction_Date` (UTC timestamp), `Operator_ID`, `Data_Safe_ID` — followed in most types by an optional `Replaced_Record_ID` for corrections.

## Catalog of data models

| Schema | Record element | One-line description |
|---|---|---|
| `wok_operator_v1.11.xsd` | `WOK_Operator_v1.11` | Daily operator-level financial totals: subtotal for the previous day and rolling previous 365 days, for a given `Concerned_Date` |
| `wok_game_v1.11.xsd` | `WOK_Game_v1.11` | Game catalogue entry: game type (SLOTS/CASINO/BINGO/VIRTUAL_SPORTS/OTHER), commercial name, introduction/active/inactive dates |
| `wok_game_session_v1.11.xsd` | `WOK_Game_Session_v1.11` | A casino-game session: start/end, rounds played and won, optional commission, and the list of account transactions (with player IDs) it generated |
| `wok_bet_v1.11.xsd` | `WOK_Bet_v1.11` | A sports bet: type (SINGLE/COMBINED/XY), status lifecycle, total stake, per-leg `Bet_Parts` (event, sport, odds, live flag, prognosis, stake), linked transactions |
| `wok_player_profile_v1.11.xsd` | `WOK_Player_Profile_v1.11` | Player account snapshot: registration date, date of birth, status (incl. self-exclusion states), end-of-day balance, registered bank accounts |
| `wok_player_account_transaction_v1.11.xsd` | `WOK_Player_Account_Transaction_v1.11` | A single money movement on a player account: amount, type (DEPOSIT, WITHDRAWAL, WINNING, STAKE, BONUS, …), status, deposit instrument |
| `wok_player_limits_v1.11.xsd` | `WOK_Player_Limits_v1.11` | The player's self-set limits: deposit, participation (stake), login duration, per-game-type, and balance limits, each with request/effective datetimes and a time window |
| `wok_player_flags_v1.11.xsd` | `WOK_Player_Flags_v1.11` | The player's responsible-gambling classification (`Flag_RG_Class`): a class value plus the datetime it was assigned |
| `wok_net_deposit_threshold_v1.11.xsd` | `WOK_Net_Deposit_Threshold_v1.11` | An event recording when a player crossed a net-deposit threshold (datetime and monetary value) |
| `wok_intervention_v1.11.xsd` | `WOK_Intervention_v1.11` | A duty-of-care intervention against a player: type (conversation, set flag/limit, exclude, …), cause (problem gambling, fraud, thresholds, …), owner, begin/end |
| `wok_complaint_v1.11.xsd` | `WOK_Complaint_v1.11` | A customer complaint and its zero-or-more operator responses (type, description, datetime) |
| `ksa_cancellation_v1.11.xsd` | `KSA_Cancellation_v1.11` | Cancels a previously submitted record: names the `KSA_Type` and the `Cancelled_Record_ID` |
| `ksa_control_manifest_v1.11.xsd` | `ControlManifest` | Per-batch manifest: sequence number, hash chain, file metadata, encrypted keys/data, XML signature |

The `ksaType` enumeration in `include_v1.11.xsd` (used by cancellations) lists all twelve cancellable record types — the eleven `wok_*` types above plus `wwft_player_account_transaction`, an anti-money-laundering (Wwft) variant of the transaction record whose schema is not part of this WOK set.

## Key entities and relationships

The model is **event/record oriented rather than relational**: there are no XSD key/keyref constraints; relationships are expressed by shared identifier values across record types.

- **Operator and Data Safe** — every record carries `Operator_ID` and `Data_Safe_ID` (both free-form strings up to 256 chars), tying it to the licensee and the specific CDB instance it was written to.
- **Player** — `Player_Profile_ID` (a string, not a UID, so operators may use their own account identifiers) is the join key from transactions, limits, flags, net-deposit-threshold events, interventions, and (optionally) complaints back to `WOK_Player_Profile`. A profile may list multiple bank accounts, each with an active flag.
- **Game and session** — `WOK_Game_Session` references its game via `Game_ID` (defined in `WOK_Game`) and carries its own `Game_Session_ID`.
- **Money as the spine** — both game sessions and bets embed a list of `{Transaction_ID, Player_Profile_ID}` pairs pointing to `WOK_Player_Account_Transaction` records. Gameplay records never carry the money themselves (beyond stakes/commission); the authoritative financial trail is the transaction ledger, and gameplay records cross-reference into it. Note that sessions and bets are inherently multi-player-capable through this list.
- **Bets are composite** — a bet has 1–64 `Part` legs, each a UID-identified selection with event, sport, odds, live/bank flags, prognosis, and per-part stake, supporting singles, combinations, and system ("XY") bets.
- **Corrections chain** — most record types allow an optional `Replaced_Record_ID` pointing at the record they supersede; independent of that, a `KSA_Cancellation` record can void any prior record by type and `Record_ID`. Together these provide replace and delete semantics over an append-only stream.

## How sessions work (and the multi-game collision)

The KSA model has **no platform-session entity**: a login as such is
never reported. The only session in the CDB is `WOK_Game_Session_v1.11`,
and it is **game-scoped by construction** — the record carries exactly
one `Game_ID` alongside its `Game_Session_ID`, so a session spanning two
games is structurally inexpressible. A session here means "one player's
continuous play of one game": start/end datetimes, rounds played and
won, optional commission, and the list of `{Transaction_ID,
Player_Profile_ID}` pairs tying the money to the transaction ledger.
The Dutch gambling-tax reporting (the **kansspelbelasting/KSB GAT**
report to the Belastingdienst — a separate delivery from the KSA CDB)
requires session figures on the same single-game basis. *(GAT layout and
citation to be pinned against the Belastingdienst specification;
requirement carried as stated by the business.)*

That single-game rule collides with any product that makes one player
action belong to two games at once. This platform's worked example is
the **operator jackpot** (`requirements/operator-jackpots/`): a
standalone opt-in game with no UI of its own that takes a contribution
from every casino stake. One login where an opted-in player spins slots
is therefore activity in *two* games — and for NL it must become **two
parallel `WOK_Game_Session` records**.

How this repository resolves it (`requirements/session-tracking/`):
**platform sessions are stored** (login → logout or inactivity timeout),
every play is stamped with its platform session, and NL's game sessions
are **derived** — one per (platform session × game), first play to last
play, rounds counted, transactions listed. The jackpot's contributions
are stamped rounds of their own game, so its session (the "shadow
session") emerges from the same derivation with no special-case code,
and an assertion enforces the invariant that no derived session ever
aggregates more than one game. Rounds are consequently **not** deposited
individually for NL — they ride inside their game-session records, which
file when the platform session ends (logout or timeout). The end
*reason* is not a CDB field; it stays in the operator's tables, and the
timeout is the operator's configured inactivity disconnect.

## Data typing approach

All reusable types live in `include_v1.11.xsd`:

| Type | Definition | Notes |
|---|---|---|
| `dateTimeUTC` | `xs:dateTime` restricted to pattern `YYYY-MM-DDThh:mm:ssZ` | Forces UTC with second precision; no offsets, no fractional seconds |
| `monetaryAmount` | `xs:decimal` with exactly 2 fraction digits | No currency element anywhere — EUR is implicit |
| `UID` | string pattern `[a-z0-9]{8}-…-[a-z0-9]{12}` | UUID-shaped, but lowercase-only (uppercase hex is invalid) |
| `stringShort` / `stringMedium` / `stringLong` | max length 32 / 256 / 1024 | Used for codes, names/IDs, and free text respectively |
| `ksaType` | enumeration of the 12 record types | Used by cancellations to name the target type |
| `timeWindow` | `Day` / `Week` / `Month` / `Other` | The period a player limit applies to |

Domain-specific enumerations (game type, bet type/status, transaction type/status, deposit instrument, player status, intervention type/cause) are defined **inline and anonymously** in each schema rather than shared, since each is used in exactly one place. Dates that are calendar dates rather than instants (`Concerned_Date`, `Player_Profile_DOB`) use plain `xs:date`. A few numeric choices are notable: limit amounts (`Deposit_Amount`, `Participation_Amount`, `Balance_Amount`) are `xs:int` — whole euros — while thresholds and transactions use `monetaryAmount`; `Login_Duration` is an `xs:float`; `Part_Odds` is an unconstrained `xs:decimal`.

## Submission structure

Data reaches the KSA as batches written into the operator's data safe, each batch accompanied by a `ControlManifest`:

1. **Identification** — `Operator_ID`, `Data_Safe_ID`, `Generation_Date`, and a `Manifest_Sequence_Number` that increments per safe instance.
2. **Hash chain** — `Hash_Value` contains SHA-256 hashes of the *previous manifest file* and the *current batch file*. Each manifest thus links back to its predecessor, forming a tamper-evident chain over the entire submission history (reinforced by `Absolute_Path_Previous_Zip` in the metadata).
3. **Metadata** — record count, `First_Timestamp`/`Last_Timestamp` (the `Extraction_Date` of the first and last record in the batch), uncompressed and compressed file sizes, and absolute paths of the current and previous zip files. Batches are zipped for transfer.
4. **Encryption** — one or more `xenc:EncryptedKey` elements plus an `xenc:EncryptedData` element (W3C XML Encryption). Multiple `EncryptedKey` entries allow the content-encryption key to be wrapped for multiple recipients (e.g. operator and regulator).
5. **Integrity and authenticity** — a `dsig:Manifest` (digest references over the batch contents) and a `dsig:Signature` (W3C XML Signature) authenticate the manifest and, transitively, the batch.

The W3C schemas (`xmldsig-core-schema.xsd`, `xenc-schema.xsd`, `xenc-schema-11.xsd`) are unmodified standards and are only referenced by the manifest.

## Notable characteristics and quirks

- **Strong responsible-gambling focus.** Five of the eleven data models exist purely for player protection: limits, flags (RG classification), net-deposit-threshold crossings, interventions, and complaints. Intervention causes include `PROBLEM_GAMBLING`, `NET_DEPOSIT_THRESHOLD`, and `HIGH_DEPOSIT_LIMIT`, and intervention types span informing/announcing conversations, forcibly setting flags or limits, exclusion, and financial-consequence investigations — a direct encoding of the Dutch duty-of-care (zorgplicht) regime. Player status likewise distinguishes temporary vs. indefinite self-exclusion (the CRUKS register regime) and even `SUSPENDED_DEATH`.
- **Mandatory limits.** In `WOK_Player_Limits`, deposit, login-duration, and balance limits are `minOccurs="1"` — every player must have them — while participation and game-type limits are optional. This mirrors the legal requirement that Dutch players set these limits before playing.
- **Pseudonymised player data.** No names, addresses, or citizen numbers appear anywhere. The only personal attributes are date of birth and bank-account identifiers on the profile; everything else keys off the operator-assigned `Player_Profile_ID`.
- **Append-only with explicit correction semantics.** Records are never edited in place: `Replaced_Record_ID` supersedes, `KSA_Cancellation` voids. Combined with the manifest hash chain and signatures, the CDB behaves like a signed, immutable ledger.
- **Fixed batch ceiling.** Every `Root` allows at most 512 records, and a bet at most 64 parts — hard bounds that keep individual files small and predictable.
- **Thin operator report.** `WOK_Operator` is unusually minimal: just two monetary subtotals (previous day, previous 365 days) per concerned date — an aggregate financial pulse rather than a detailed P&L.
- **Sports betting vs. casino split.** Betting (`wok_bet`) is richly structured (legs, odds, prognosis, live/bank flags), whereas casino play (`wok_game_session`) is aggregated to session level (rounds, rounds won) — individual spins are not reported.
- **Implicit currency and UTC-only time.** There is no currency field anywhere (EUR assumed), and the `dateTimeUTC` pattern rejects any non-`Z` timezone.
- **Loose ends.** `Flag_RG_Class` values are free-form `stringShort` rather than an enumeration; `Complaint_Type` and `Response_Type` are likewise free text; the `wwft_player_account_transaction` type is cancellable but has no schema in this set; and the lowercase-only UID pattern will reject standard uppercase-hex UUIDs.
- **Easter egg.** Every schema opens with the same 24x16 ASCII bitmap of 0s and 1s in a comment — a pixel-art watermark included in all officially released KSA files.
