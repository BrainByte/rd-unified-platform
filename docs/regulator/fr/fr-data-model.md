# France (FR) — ARJEL/ANJ Data Model

## Overview

Online gambling in France was regulated from 2010 by **ARJEL** (Autorité de Régulation des Jeux En Ligne), whose functions passed in 2020 to the **ANJ** (Autorité Nationale des Jeux). The technical regime is unusual among European regulators: instead of periodically submitting batch files, the operator must capture **every individual player action in real time** as a small XML event — a *trace* — and write it into a sealed local capture device (the **frontal**, containing a tamper-evident vault or **coffre-fort**) installed on the operator's premises. The regulator does not receive a nightly feed; it *inspects* the vault, whose contents must be complete, ordered, and immutable. The schemas in this directory (namespace `https://det.tech.arjel/2.0.0-draft/...` for the newer parts) define the shape of those trace events.

The schema set is organised as **one root XSD per game vertical plus layered shared includes**:

| Layer | File(s) | Purpose |
|---|---|---|
| Root schemas | `CJ.xsd`, `PASP.xsd`, `PAHI.xsd`, `PO.xsd`, `LOTI.xsd`, `LOJI.xsd`, `FA.xsd`, `MO.xsd`, `PDV.xsd` | One file per family, each declaring the family's root event elements (`PASPMISE`, `CPTEALIM`, `POJEU`, …) |
| Family commons (legacy style) | `include/Common.xsd`, `CJCommon.xsd`, `PACommon.xsd`, `POCommon.xsd`, `LOTICommon.xsd`, `LOJICommon.xsd` | Un-namespaced shared elements and simple types; `Common.xsd` holds the global vocabulary (IDs, dates, balances), the others add per-family structures (bet legs, draws, poker actions) |
| Modular commons (2.0.0-draft style) | `include/common/{types,header,player,event,finance}/*.xsd` | Namespaced building blocks: primitive types, the event header group, player identification group, base event types (`default`, `anonymous`), and balance groups |
| Feature schemas | `include/features/poker/poker.xsd`, `include/features/cercle/cercle.xsd`, `include/fantasy.xsd`, `include/poker/poker.xsd` | The *cercle* (peer-to-peer "circle game") abstraction — register/game/special/final/cancel event templates — with poker and fantasy layered on top of it |

Two generations coexist. The **legacy families** (CJ, PASP, PAHI, LOTI, LOJI, MO, PDV) are flat, un-namespaced schemas where each event redeclares the same header element by element. The **newer families** (PO, FA) are built from the versioned `2.0.0-draft` namespaced modules: an event extends `event:default` (header + player identity) or `event:anonymous` (header only, used for multi-player poker hands), and reuses `finance:old` balance groups and `cercle:*` templates. The card play in `POJEU` uses XSD substitution groups: `Bet`, `Draw`, `Discard`, `Reveal`, `Check`, `Fold` all substitute for the abstract `cercle:Action` inside a `Tour` (round).

## Language and naming conventions

Everything is in French: element names, enumeration values, and comments (`<!-- Entete -->` = header, `<!-- Corps -->` = body). Key vocabulary:

| French | English | French | English |
|---|---|---|---|
| mise | stake / bet | joueur | player |
| gain | winnings | compte joueur (CJ) | player account |
| annulation (ANNUL) | cancellation | solde | balance |
| abondement | operator bonus / top-up | mouvement | movement (amount) |
| avant / après | before / after | retrait | withdrawal |
| alimentation (ALIM) | deposit (funding) | coffre | vault / safe |
| cote | odds | rencontre (Renc) | match / fixture |
| tirage | draw (lottery) | pari | bet |
| cave | poker buy-in / table stack | tour | round |
| ouverture (OUV) | opening | clôture | closure |
| point de vente (PDV) | retail point of sale | monnaie | currency |
| se coucher / suivre / relance / tapis | fold / call / raise / all-in | flop, tournant, rivière | flop, turn, river |

Event names are UPPERCASE concatenations prefixed by family (`PASPMISE` = sports-bet stake, `CPTERETRAIT` = account withdrawal). Field names are CamelCase French (`SoldeApresMise`, `MoyenPaiement`, `HashJoueur`).

**`traduction/traduction.csv` is not an English translation table** — it is the *abbreviation dictionary* for the compact on-disk trace encoding: each element name and enumeration value maps to a short code (`IDOper;a`, `Mise;w`, `PASPMISE;s6`, `CarteBancaire;1`). It also encodes the card deck: `1Pi`–`RTr` map to integers 1–52 (suits Pi/Co/Ca/Tr = spades/hearts/diamonds/clubs), which is why `POJEU` sample files carry numeric `<Valeur>` card values. The CSV additionally preserves names of **retired events** (`POCAVE`, `POPARTIE`, `POREVERS`, `Moderateur` fields) from the pre-cercle poker model — useful archaeology when reading old traces.

## Event catalog

The regime is **event-log shaped**: one XML document per player action, appended to the vault as it happens. This contrasts with the batch-record regimes of DK/ES/GR/NL.

### CJ — Compte Joueur (player account), 19 events

| Event | Description |
|---|---|
| `OUVINFOPERSO` | Account opening: full identity (name, birth date/place, address, phones, email, login/pseudo) |
| `MODIFINFOPERSO` | Modification of the personal information above |
| `PREFCPTE` | Player-set limits: per-vertical `MiseMax` (PS/PH/PO/LO), `DepotMax` deposit limit, `TempsMax` time limit |
| `CPTEIDENTITE` | Identity verification completed (`PieceIdentite` document vs `Electronique`) |
| `CPTEADRESSE` | Address verification confirmed |
| `OKCONDGENE` | Acceptance of terms and conditions |
| `OUVOKCONFIRME` | Account confirmed/definitively opened |
| `ACCESREFUSE` | Access refused, with `TypeRefus` (identity delay/rejection, banned, self-banned, locked, closed…) |
| `AUTOINTERDICTION` | Self-exclusion: duration + unit (J/S/M/A = day/week/month/year) and end date |
| `LIMITMISE` | Stake limitation imposed on the player (`Nature`, `Motif` free text, validity period) |
| `CLOTUREDEM` | Account closure with final balance and `TypeCloture` reason |
| `CPTEALIM` | Deposit: balance before/movement/after, payment instrument and `TypeMoyenPaiement` (card, transfer, e-money, cash, cheque, winning receipt…) |
| `CPTERETRAIT` | Withdrawal: requested amount and balance triplet |
| `CPTEABOND` | Bonus credit (`TypeAbondement`: opening, rakeback, achievement, code, offer, points…) |
| `CPTEALIMOPE` | Operator credit to the *bonus* balance (named bonus) |
| `CPTEAJUSTOPE` | Operator adjustment of cash and/or bonus balance with typed reason |
| `CPTEREF` | Reference payment account for withdrawals (bank code `PspCib`, `PspIban` or account ref) |
| `LOTNATURE` | Prize in kind: list of `LotN` (name + value) |
| `ACHATMONNAIE` | Purchase of virtual currency: euro balance triplet plus currency balance triplet in `Unite` |

### PASP / PAHI — sports betting / horse-race betting (bet lifecycle)

| Event | Description |
|---|---|
| `PASPMISE` / `PAHIMISE` | Bet placement: bet description + `SoldeAvantMise`/`Mise`/`SoldeApresMise` (and bonus triplet) |
| `PASPGAIN` / `PAHIGAIN` | Settlement of winnings; PASP supports `Cashout` (early buy-back `Rachat` at a `Cote`) |
| `PASPANNUL` / `PAHIANNUL` | Cancellation/refund with enumerated `Motif` (cancelled fixture/race, non-runner, result, player, …) |

A `PASPMISE` carries up to 64 `PaSp` bets, each with `Combi` (S = single, C = combined/accumulator, XY = system "X out of Y" with the `X` element, plus full-cover types TRIXIE, PATENT, YANKEE, LUCKY15/31/63, CANADIAN, HEINZ, SUPERHEINZ, GOLIATH), an optional `Mutuel` pool flag, and up to 64 `LigSp` legs (fixture `Renc`, `Sport`/`Cat`/`Evnt`/`Disc` codes, `Genre`, participants, prognosis `PronoSp` = result-type + choice, `Cote` odds, `Live`, `Banque`). `PAHIMISE` instead uses a racing `Desc` (hippodrome, meeting `Reunion`, race name/number) with `PronoPH` (bet type e.g. *tiercé*, base horses, field/combination flags, base stake, number of combinations).

### PO — poker (cercle model)

| Event | Description |
|---|---|
| `POINSCRIT` | Registration/buy-in to a table or tournament (`Inscription` ticket, `Format` cash-game/tournament, balance triplet) |
| `POJEU` | A complete dealt hand: participants with per-player `Finance` (Net, Total, CaveAvant/Après, Rake), then `Jeu` as named `Tour` rounds of substitutable actions (`Bet` typed ante/blind/call/raise/allin, `Draw`, `Reveal`, `Check`, `Fold`) |
| `POACHAT` | Re-buy/add-on purchase during play |
| `POGAIN` | Payout credited back to the player account |
| `POBILAN` | Final per-player summary of the tournament/session (`Classement` ranking, settlement triplet) |
| `POANNUL` | Cancellation (too few players, player, disconnection, other) |

`POJEU` is an *anonymous* event (header only) because a hand involves several players — including, in the samples, players of **foreign partner operators** (`Oper` "Hyper Poker (IT)", `Pays` IT), reflecting European shared-liquidity poker.

### FA — fantasy sports (cercle model, `register2`/`game`/`special`/`final2`/`cancel2`)

`FAINSCRIT` (contest entry with sport/event codes and `Format`), `FAJEU` (team submission: `IDCompo` + `Composition` of `Choix` name/role pairs), `FAACHAT`, `FAGAIN`, `FABILAN` (ranking **and** `Points`), `FAANNUL`.

### LOTI / LOJI — draw lotteries / instant lotteries

`*MISE` (ticket purchase; LOTI includes `Tirage` draw references and a `Selection` of numbers/options, LOJI just the game description), `*GAIN`, `*ANNUL` (motif: draw/game, player, other), and `*BILAN` — a summary event carrying `NombreChoix`.

### MO / PDV — reference data (anonymous events, header = operator/vault/date only)

`TYPEMONNAIE` declares a virtual currency (ID, name, description, euro `Valeur` per unit); `OUVPOINTDEVENTE` / `MODIFPOINTDEVENTE` / `CLOTUREPOINTDEVENTE` register, modify and close retail points of sale (address, postal code, `Taille` size).

## Key entities and relationships

- **Header (every event)**: `IDOper` (4-digit licence number), `DateEvt` (YYMMDDhhmmss), `IDEvt` (per-vault sequence number), `IDJoueur` (operator's player ID), `HashJoueur` (uppercase SHA-1, a stable pseudonymous player key), `IDSession`, optional `IPJoueur`, optional `IDPointDeVente` (retail), `IDCoffre` (vault instance), optional empty `Supervision` flag for system-generated events (samples pair it with `IDSession` `0-sys`). MO/PDV events carry only operator/date/event-ID/vault.
- **Player account** is the hub: CJ events form its lifecycle (open → verify → confirm → fund → limit → self-exclude → close), and every gaming event debits/credits it via balance triplets.
- **Bet ↔ settlement linkage** is by the `Tech` operator reference (the bet's technical ID): `*GAIN`/`*ANNUL` repeat the `Tech` and `DateMise` of the original `*MISE` rather than an XML key/keyref. `TechJeu` optionally groups a bet under a game/offer.
- **Cercle events** link through `Inscription` (registration ticket), `Tech` (tournament/table ID) and `Pool` (table pool within a tournament).
- **Money**: every financial event snapshots `SoldeAvant` / `SoldeMouvement` (non-negative) / `SoldeApres`, with a parallel `BonusAvant/Mouvement/Apres` triplet for the ring-fenced bonus balance — the vault therefore holds a self-verifying running ledger. Poker uses `Finance` (Net, Total, CaveAvant/Après, optional `Rake`). An optional `Unite` element re-denominates the amounts in a virtual currency declared via `TYPEMONNAIE`.
- **Reference/marker elements**: empty-element booleans are idiomatic — `Jackpot`, `Mutuel`, `Test` (test account), `Tel` (bet placed by telephone), `Supervision`, `Live`, `Banque`, `Champ`, `Combinaison`.

## Data typing approach

`include/Common.xsd` (legacy) and `include/common/types/types.xsd` (2.0.0-draft) define the primitive vocabulary:

- **Dates are digit strings, not `xs:dateTime`**: `date-aammjjhhmmss` = `\d{12}` (two-digit year, local time, no timezone) for event/bet timestamps; `date-aaaammjj` for calendar dates (birth, PDV opening). Nothing prevents century ambiguity except convention.
- **Amounts** are plain `xs:decimal`: `solde` (balance) may be negative, `mouvement` is a non-negative decimal. No currency field — euros implied unless `Unite` names a virtual currency.
- **Strings** are length-bounded restrictions (`string-32/64/256/1024`) of an `fr` base type whose whitelist explicitly includes accented French characters, `€`, and ligatures.
- **Identifiers**: `operator` = exactly 4 digits; `sha1` = 40 uppercase hex chars; `postal` matches French postal codes (including Corsica's `2A/2B`); `IP` accepts v4 or v6, and the modular set even defines `publicIP` types whose regexes *exclude private/reserved ranges*.
- **Enumerations** are declared inline per event (refusal types, closure types, payment instruments, cancellation motives, bonus types, bet combination types, poker `betType`), always ending in an `Autre` (other) escape value.
- The 2.0.0-draft modules add reusable **groups** — `header:id`, `player:id`, `finance:old-balance`/`old-bonus` — and base complex types `event:default`/`event:anonymous` with `retransmission` and `test` boolean attributes, giving the newer families genuine inheritance where the legacy files copy-paste.

## Versioning and change history

The namespaced modules are self-labelled `version="2.0.0-draft"`; the legacy files carry no version at all. `liste_des_modifications.txt` shows the referential is maintained by **surgical, field-level edits** rather than versioned releases:

- **05/05/2025** — `cercle.xsd`: typed the `Joueur` participant element as `poker:player`.
- **02/06/2025** — `types.xsd`/`player.xsd`: fixed the IPv6 regex, removed the obsolete `IP2` type, retyped `IPJoueur` to `types:IP`.
- **01/06/2026** — `CJ.xsd`: `Nom` changed from an inline `string-64` to the shared `ref="Nom"` (now unbounded `xs:string`).
- **15/06/2026** — `CJCommon.xsd`: `Prenom` loosened from `string-256` to `xs:string`.

The trend is *loosening* name fields and consolidating onto shared declarations. Because changes are in-place, consumers must track the change log rather than a schema version number.

## Notable characteristics and quirks

- **Real-time per-event capture, not periodic batches.** Each XML is a single action written to the sealed frontal as it occurs; DK/ES/GR/NL-style daily/monthly aggregation does not exist here. The regulator audits the vault.
- **Double-entry evidence built in**: before/movement/after balance triplets on every money event make gaps or tampering arithmetically detectable across the event sequence (`IDEvt` is a per-vault counter).
- **Full gameplay reconstruction**: `POJEU` records every card drawn and every action of every seat, per betting round — enough to replay the hand. Cards are integers via the traduction dictionary.
- **`BILAN` summary events** (PO/FA/LOTI/LOJI) close a participation with a final settlement and ranking — small aggregates *inside* an otherwise atomic event stream.
- **Responsible gambling is first-class**: `AUTOINTERDICTION` (self-exclusion with duration units), `LIMITMISE` (imposed stake limits with free-text nature/motive), `PREFCPTE` (player-chosen stake/deposit/time limits per vertical), `ACCESREFUSE` (including `AutoInterdit` and national `Interdit` register refusals).
- **Retail is in scope**: `PDV` events register physical points of sale, and every player-event header can carry `IDPointDeVente`, tracing online-account actions performed in a shop.
- **Virtual currencies** (`MO` family + `ACHATMONNAIE` + `Unite`) let operators run token economies while keeping euro valuations auditable.
- **Shared international poker liquidity** is visible in `POJEU`: participants may belong to a foreign operator identified by free-text `Oper` and country instead of a French `IDOper`.
- **Quirks to watch**: two-digit-year timestamps without timezone; `HashJoueur` is SHA-1; header field order differs slightly between legacy (`IDOper, DateEvt, IDEvt, …`) and cercle-based events (`IDOper, IDCoffre, DateEvt, IDEvt, …`); `PAHIMISE`'s bonus element is `BonusMouvement` where `PASPMISE` uses `BonusMise`; `CPTEABOND` makes `Info` mandatory while it is optional everywhere else; and the `traduction.csv` codes (not the XML tags) are what actually appear in the compressed vault format.
