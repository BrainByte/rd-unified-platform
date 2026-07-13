# Spain (ES) — DGOJ Data Model

**Source schema:** `docs/regulator/es/DGOJ_Monitorizacion_3.3.xsd`
**Namespace:** `http://cnjuego.gob.es/sci/v3.3.xsd`

## 1. Overview

This schema defines the data model for the **Sistema de Monitorización** (monitoring system, also
known as SCI — *Sistema de Control Interno*) of the **Dirección General de Ordenación del Juego
(DGOJ)**, Spain's national gambling regulator. Licensed online gambling operators must
periodically submit batches of records covering player registration, gaming-account movements,
game/bet activity, jackpots and the betting-event catalogue.

It is a **single monolithic XSD** (~2,700 lines, version 3.3, authored by the DGOJ in XMLSpy).
There are no `xs:import`/`xs:include` statements — every simple type, enumeration, helper
structure and record type lives in this one file. The only external namespace referenced is XML
Digital Signature (`xmldsig#`), allowed as an optional trailing element of a batch via `xs:any`.

The schema declares exactly **one global element**, `Lote` (batch). All record variety is
achieved through an abstract type hierarchy: `Registro` elements are declared as the abstract
`RegistroBase`, and instance documents select a concrete record class using `xsi:type`
(e.g. `xsi:type="RegistroRUD"`).

## 2. Language and naming conventions

All element and type names are **Spanish**. Key vocabulary:

| Spanish | English |
|---|---|
| `Lote` | Batch (the submission unit) |
| `Registro` / `Subregistro` | Record / record part (split records) |
| `Cabecera` | Header |
| `Jugador` / `JugadorId` | Player / player ID |
| `Operador` / `OperadorId` | Operator / operator ID |
| `Juego` / `TipoJuego` | Game / game type (vertical) |
| `Apuesta` / `TicketApuesta` / `Cuota` | Bet / bet ticket / odds |
| `Participacion` / `ParticipacionDevolucion` | Stakes (turnover) / returned stakes |
| `Premios` / `PremiosEspecie` | Winnings (prizes) / prizes in kind |
| `Botes` | Jackpots (pots) |
| `Bonos` | Bonuses |
| `Cantidad` / `Importe` / `Unidad` | Amount / monetary amount / unit (currency) |
| `Saldo` (`Inicial`/`Final`) | Balance (opening/closing) |
| `Depositos` / `Retiradas` | Deposits / withdrawals |
| `Medio de pago` | Payment method |
| `Desglose` | Breakdown (itemisation) |
| `Fecha` / `Dia` / `Mes` | Date / day / month |
| `Alta` / `Baja` | Registration/sign-up / deregistration |
| `Sesión` | (Play) session |
| `Rectificación` | Correction (of a previously sent record) |
| `Cadena` / `Entero` | String / integer (type-name prefixes) |

Other recurring terms: `EstadoCNJ` (player-account status per the regulator's code list — CNJ is
the former *Comisión Nacional del Juego*), `SVDI` (the identity-verification service against
national ID data), `RGIAJ` context via `Exclusion`/`Autoexclusión` (self-exclusion), `GGR`
(gross gaming revenue), `RegionFiscal` (fiscal region code `01`–`22`), `PartidasVivas`
(open/unsettled bets — "live positions").

## 3. Submission structure: `Lote`

A submission is a `Lote` element:

```
Lote
├── Cabecera : LoteCabecera
│   ├── OperadorId   (string ≤ 4)   — operator code assigned by the DGOJ
│   ├── AlmacenId    (string ≤ 10)  — data-warehouse/store identifier
│   ├── LoteId       (string ≤ 50)  — batch identifier
│   └── Version      (string ≤ 5)   — schema/model version (e.g. "3.3")
├── Registro (0..n) : RegistroBase  — concrete type chosen via xsi:type
└── <xmldsig signature> (0..1)      — optional enveloped XML-DSig
```

Every record carries a `RegistroCabecera` header:

| Field | Type | Meaning |
|---|---|---|
| `RegistroId` | string ≤ 100 | Record identifier |
| `SubregistroId` / `SubregistroTotal` | positiveInteger ≤ 4 digits | Part *n* of *m* — large records may be split into up to 9,999 parts |
| `Fecha` | `AAAAMMDDHHMMSS` | Record generation timestamp |
| `Rectificacion` (0..1) | — | Reference (`RegistroId` + `RegistroFecha`) to a previously submitted record that this one corrects |

### Periodicity bases

Three abstract bases define the reporting cadence:

| Base type | Adds | Used by |
|---|---|---|
| `RegistroBase` | header only | event/transaction-grained game records |
| `RegistroPeriodicoBase` | `Periodicidad` (`Diaria`/`Mensual`) + `Periodo` (choice of `Dia` AAAAMMDD or `Mes` AAAAMM) | RUD, CJT, CJD, CEV |
| `RegistroMensualBase` | `Mes` (AAAAMM) | RUT, RUR, RUG, OPT, ORT, BOT, JUA |

## 4. Record types

### 4.1 Player-register records (RU*)

| Type | Cadence | Content |
|---|---|---|
| `RegistroRUD` | daily or monthly | **Player detail register.** One `Jugador` block per player with a change (`CambiosEnDatos`: `A` new, `S` changed, `N` unchanged, `B` deregistered): full identity (resident with DNI/NIE vs non-resident with document type), name, date of birth, sex, address, email/phone with verified flags, `Login` and pseudonyms, `RegionFiscal`, deposit/spend/time **limits** (`LimitesJugador`), **self-exclusions** (`Exclusion`), special player profiles (`PerfilEspecial`), account **status** with history and suspension/cancellation reason, **SVDI** and **documentary verification** flags/dates/methods, test-player flag, and sign-up IP/device. |
| `RegistroRUT` | monthly | **Player register totals**: number of players, sign-ups (`Altas`), deregistrations (`Bajas`), active players, test players; counts by `EstadoCNJ` status and by special profile. |
| `RegistroRUR` | monthly | **Shared-liquidity (network) player mapping**: for each player, one or more `(OperadorId, JugadorId)` pairs plus `Login` and status — links a player's identities across network operators. |
| `RegistroRUG` | monthly | **Winners register**: identity of prize winners including `Premio` (prize amount) and `Retencion` (tax withholding), used notably for land-based SELAE/ONCE winners; includes SVDI/documentary verification status. |

### 4.2 Gaming-account records (CJ* — *Cuenta de Juego*)

| Type | Cadence | Content |
|---|---|---|
| `RegistroCJT` | daily or monthly | **Aggregate account movements** for the whole operator: opening balance; deposits and withdrawals broken down by payment method; stakes, stake refunds, prizes and prize adjustments broken down by game type; inter-operator transfers (`Trans_IN`/`Trans_OUT`); other concepts; commission; bonuses by concept (`CONCESION` grant / `LIBERACION` release / `CANCELACION` cancellation); prizes in kind; closing balance. |
| `RegistroCJD` | daily or monthly | **Per-player account movements**, same money flow structure but with operation-level detail: every deposit/withdrawal carries timestamp, payment method + type code, ownership-verified flag, operation result (`OK`/cancelled-by-user/operator/payment-method/other), IP, device type + device ID, entity and last-4 digits of the instrument; plus per-account (`Cuentas`) closing balances, bonus events with grant/activation dates, prizes in kind and gifts (`Regalos`). |

### 4.3 Operator/game monthly totals

| Type | Cadence | Content |
|---|---|---|
| `RegistroOPT` | monthly | **Per-game-type operating totals** for a singular licence: stakes, refunds, prizes (cash and in kind), jackpot movements, network adjustments, "other" amounts by concept (`APA` stake adjustments, `APR` prize adjustments, `BON` bonuses, `OVL` overlay, `ADD` added value, `OTR` other), commission and **GGR** — most figures broken down per co-participating operator (`DesgloseOperador`). Includes `FechaInicioOferta` (date the game was first offered). |
| `RegistroORT` | monthly | Same structure as OPT but for **network ("red") totals**, without `FechaInicioOferta` and without the `OVL`/`ADD` concepts. |
| `RegistroBOT` | monthly | **Liability record** per game type: `PartidasVivas` (open/unsettled bets — opening balance, increments, settlements, closing balance, plus expected settlement schedule by future month) and `Botes` (jackpots — balances and movements, itemised per jackpot with ID, description and start/end dates). |

### 4.4 Betting-event catalogue and adjustments

| Type | Cadence | Content |
|---|---|---|
| `RegistroCEV` | daily or monthly | **Event catalogue**: each bettable event with ID, description, special-event flag, start/end, sport/event `Codigo` (DGOJ code list `1`–`99`, `901`–`905`, `998`, `999`), competition name, international flag, country, competition sex (`M`/`F`/`O`) and category/phase, plus new-vs-updated flag. Bet records reference these events by `EventoId`. |
| `RegistroJUA` | monthly | **Bet adjustments**: post-settlement corrections referencing `EventoId`, `TicketApuesta` and `JugadorId`, with date, reason and amount. |

### 4.5 Game/bet transaction records (per settled bet, tournament or session)

These extend `RegistroBase` directly (no periodicity fields — they are event-grained):

| Type | Game types | Grain and content |
|---|---|---|
| `RegistroApuestaContrapartida` | `ADC`, `AHC`, `AOC` (fixed-odds sports/horse/other betting) | One record per **settled bet**: bet type (`Simple`, `Combinada`, `Trixie`, `Yankee`, `Lucky15/31/63`, `Heinz`, `Goliat`…), in-play flag, list of events with market (`Hecho`) and settlement time; single `Jugador` with ticket ID, accepted odds (`Cuota`, 4 dp), stake/refund/prize, cash-outs (amount + date), IP/device, and account balance at event start when in-play. |
| `RegistroApuestaMutua` | `ADM`, `AHM`, `ADX`, `AOX` (pool and exchange betting) | One record per pool/market: events list, exchange crosses (`DesgloseCruzadas` with `Lay`/`Back` legs and tickets, `Reto` challenge flag); **many players** per record, each with ticket, bet date, odds, stakes/prizes, jackpot contributions, cash-outs, IP/device. |
| `RegistroPoquerTorneo` | `POT` | One record per **poker tournament**: variant (`TH`, `OM`, `ST`, `DR`), commercial variant, network/international-liquidity flags, participant count, operator overlay/added contributions; per-player entries (via cross-operator `ID`) with buy-in/refund/prizes and IP/device. |
| `RegistroOtrosJuegos` | `POC`, `BNG`, `AZA`, `BLJ`, `RLT`, `PUN`, `COM` | One record per **player session**: one `Juego` block per game type played (dates of first/last play, stakes, refunds, prizes, per-jackpot contributions/awards at 4 dp, variant, live-game/network/international-liquidity flags, table ID for poker cash, games played) plus the session itself — session ID, start/end, **session planning** (time limit, spend limit, exclusion period) as required by Spanish responsible-gambling rules, complete/new/rectifying flags and close reason (`Usuario`/`Limite`/`Conexion`), IP/device. |
| `RegistroConcurso` | `COC` | One record per **contest**: participations, winners, and premium-rate phone/SMS participation metrics (call/SMS counts, prices, stakes, `STA` amounts); per-player stakes/prizes. |
| `RegistroLoteria` | SELAE/ONCE draw codes (`PLN`, `PEU`, `OCP`…) | One record per **draw**: draw dates, ticket count; per-player stakes, refunds, prizes, jackpots. Player ID and IP/device optional (covers anonymous retail play). |
| `RegistroLoteriaPresorteada` | 3-letter code | **Instant/pre-drawn lottery session**: like `RegistroOtrosJuegos`, session-based with session planning limits, ticket count, stakes/prizes/jackpots. |

## 5. Key entities and relationships

- **Operator** (`OperadorId`, ≤ 4 chars) — appears in the batch header and inside breakdown
  structures (`DesgloseOperador`, `DesgloseBotes`, `DesgloseConceptoOP`) so that network games
  (shared liquidity, co-organised games) can attribute amounts to each participating operator.
- **Player** (`JugadorId`, ≤ 50 chars, unique per operator) — the pair
  `(OperadorId, JugadorId)` forms the reusable `ID` complex type used where players must be
  identified across operators (tournaments, contests, `RUR`). Full identity lives in RUD/RUG.
- **Game** (`JuegoId` + `TipoJuego`) — a specific bet, tournament, draw or session-scoped game
  instance. `TipoJuego` is the ~46-code vertical enumeration (betting, poker, casino, bingo,
  contests, plus SELAE- and ONCE-reserved lottery codes; `P*` codes are SELAE/online-presence
  variants, `O*` codes are ONCE products, per the schema's own documentation).
- **Event** (`EventoId`) — betting events are declared once in `CEV` and referenced from bet
  records and adjustments.
- **Money flows** — deposits/withdrawals (with payment-method detail), stakes, refunds, prizes,
  bonuses, commissions, transfers, jackpots and GGR reconcile between the per-player view
  (`CJD`), the operator aggregate (`CJT`) and the per-game monthly totals (`OPT`/`ORT`), with
  liabilities (open bets, jackpots) tracked in `BOT`.

## 6. Data typing approach

- **Strings**: length-bounded generic types `cadena10/20/50/100/200/1000`.
- **Booleans**: a custom `boolean` enumeration of `S`/`N` (sí/no) — *not* `xs:boolean`.
- **Amounts**: `cantidad` = `xs:decimal`, 12 total digits, **2 decimal places**; `cantidad4d`
  allows **4 decimal places** (used for odds and per-jackpot micro-contributions).
- **Monetary amounts** (`Importe`/`Importe4d`): a list of `Linea` items, each
  `Cantidad` + `Unidad` (unit is a free-text string ≤ 20, i.e. the currency, in practice EUR).
  The repeating-line design permits multi-currency amounts; an `Importe` may also be empty.
- **Integers**: `entero3/6/8` (non-negative, digit-capped).
- **Dates**: all dates/times are **digit-string patterns**, not XSD date types:
  `AAAAMM`, `AAAAMMDD`, `AAAAMMDDHHMMSS`, and `AAAAMMDDHHMMSS±HHMM` (timezone suffix optional).
  Durations reuse 6-digit patterns `HHMMSS` and `DDHHMM`.
- **Enumerations / code lists** (all inline, no external code files):
  - `EstadoCNJ` — player-account status: `A`, `PV`, `S`, `C`, `CD`, `PR`, `AE`, `O`
    (active, pending verification, suspended, cancelled, cancelled-duplicate, prohibited
    (RGIAJ), self-excluded, other — codes are not documented inside the XSD itself).
  - `CambioEnDatos` — `A`/`S`/`N`/`B` (new / changed / unchanged / removed).
  - `MotivoEstado` — reason for suspension/cancellation: player request, inactivity, safer
    gambling, fraud/ID/payments, T&Cs, other.
  - `TipoLimite` (`Deposito`/`Participacion`/`Gasto`/`Tiempo`) with `PeriodoLimite`
    (daily/weekly/monthly) and units (`UnidadLimite`, `UnidadExclusion`).
  - `PerfilJugador` — privileged customer, intensive gambler, young participant, risk
    behaviour, other.
  - `TipoJuego` — the game-vertical code list (see §5).
  - `TipoApuesta` — bet structures from `Simple` to `Goliat`.
  - `TipoMedioPago` — numeric payment-method codes `1`–`20` and `99`.
  - `TipoDispositivo` (`MO`/`PC`/`TB`/`TF`/`OT`), `TipoDocumento` (`ID`/`SS`/`PA`/`DL`/`OT`),
    `TipoVerificacionDocumental` (document, selfie, video-ID, certificate, phone…),
    `TipoResultado` (payment-operation outcome), `VariantePoquer`, `VarianteSesion`,
    `Sexo`/`SexoCompeticion`, `MotivoFinSesion`.
  - `PaisISO` — full inline ISO 3166-1 alpha-2 country list (2022 edition) plus `00` for
    unknown; `RegionFiscal` — codes `01`–`22`; `ListaCodigo` — DGOJ sport/event codes
    `1`–`99`, `901`–`905`, `998`, `999`.
- **Breakdown pattern**: a family of `Desglose*` helper types all follow
  `Total` + repeating `Desglose` rows keyed by operator, game type, concept, bonus concept,
  payment method or jackpot ID — the workhorse structure of the financial records.

## 7. Notable characteristics and quirks

1. **Polymorphism via `xsi:type`**: only `Lote` is a global element; the concrete record class
   of each `Registro` is asserted in the instance document, so consumers must dispatch on
   `xsi:type` rather than on element names.
2. **String-typed everything**: booleans are `S`/`N` strings and all timestamps are digit
   strings with regex validation — no `xs:date`/`xs:dateTime`/`xs:boolean` anywhere. Timezone
   information is optional and encoded as `±HHMM`.
3. **Currency-agnostic amounts**: `Importe` is a *list* of amount lines with a free-text unit,
   allowing zero, one or several currencies per figure.
4. **Record splitting and corrections** are first-class: `SubregistroId/SubregistroTotal`
   support chunking a logical record across physical parts, and `Rectificacion` links a
   correcting record to the original by ID and date.
5. **Sign conventions in documentation**: e.g. `GGR` "will be negative to indicate an operator
   win for the game"; jackpot and open-bet movements are modelled as explicit
   increment/decrement pairs rather than signed values.
6. **Responsible-gambling data is pervasive**: player limits, self-exclusion, session planning
   (time/spend limits, exclusion pauses), session close reasons, special risk profiles and
   verification (SVDI + documentary) statuses are mandatory parts of the model.
7. **Payment-instrument surveillance**: per-operation deposits/withdrawals require IP, device
   type/ID, ownership-verification flag, operation outcome and last-4 digits of the instrument.
8. **Monopoly-operator support**: many `TipoJuego` codes are reserved for SELAE (state lottery)
   and ONCE, and `RegistroRUG` includes prize/withholding fields specifically for their retail
   winners — the schema serves both online licensees and the lottery incumbents.
9. **Mixed granularity by design**: monthly aggregates (RUT, OPT, ORT, BOT), daily-or-monthly
   per-player detail (RUD, CJD, CJT, CEV) and per-bet/per-session transaction records coexist
   in the same batch envelope.
10. **Inline code lists**: even the full ISO country list is embedded as enumerations, making
    the file self-contained but requiring a schema release to update any code list.
