# Portugal (PT) — SRIJ Data Model

## Overview

Online gambling in Portugal is regulated by the **SRIJ** (Serviço de Regulação e Inspeção de Jogos), the gambling regulation and inspection service of Turismo de Portugal. The legal basis is the **RJO** — Regime Jurídico dos Jogos e Apostas Online, approved by **Decreto-Lei n.º 66/2015** of 29 April — and the sampled document, **Regulamento n.º 903-B/2015** (Diário da República, 2.ª série, n.º 250, 23 December 2015), the *Regulamento que define os Requisitos Técnicos do Sistema Técnico do Jogo Online* (secção 1.1–1.2). Only the Portuguese version is legally binding (secção 1.4).

**This source differs fundamentally from the other five sampled jurisdictions.** DK/ES/GR/NL/FR were sampled from machine-readable XSD schema sets; the PT sample is the *regulation itself* — ~30 pages of prose requirements organised in numbered sections (1–9) plus a technical annex (Anexo 1). Most of the document specifies the **technical system architecture, controls, certification and security regime**, not field-level record layouts. However, it is not schema-free: **Anexo 1 embeds actual inline XSDs and WSDLs** — six reporting file categories for the operator's data safe plus two SOAP web services — printed in the official gazette. These printed schemas are loosely typed (almost every element is `xs:string`) and dated 2015; the regulation itself repeatedly defers to a separate, evolving SRIJ document called the **"Modelo de Dados"** (data model) for the authoritative formats, procedures and folder structures (secções 2.1.2, 2.1.4, 2.2.2, 3.3, 9.9.2). Implementation therefore requires obtaining SRIJ's current technical specifications; the gazette text is the legal anchor and a (stale) snapshot of the wire format.

## Technical system architecture

The regulation mandates a specific operator-side architecture (definitions in secção 1.5; requirements in secções 2–3, mapped to RJO artigos 26.º, 28.º, 32.º, 34.º, 36.º–41.º):

| Component | Portuguese term | Location | Role |
|---|---|---|---|
| Gaming technical system | *sistema técnico de jogo* | — | Everything: Internet presence, IER, gaming platform, databases, game software, RNG, management modules |
| Internet presence | *presença na Internet* | `.pt` top-level domain | Player-facing interface; all Portuguese-IP or Portuguese-registered-account traffic must be redirected to it (secções 2.1.1, 5.1.2) |
| Entry & recording infrastructure | *infraestrutura de entrada e registo* (IER) | **Portuguese territory** | Gateway + Safe; all player↔platform traffic must route through it, all other gaming operations must be reported to it (secção 2.1) |
| Operator gateway | *gateway da entidade exploradora* | Portuguese territory (part of IER) | Dedicated gateway for all Portuguese player access (web, mobile, other); data available in usable format for audit (secção 2.1.1) |
| Data safe | **Safe** (*cofre*) | Portuguese territory | Dedicated storage of gaming/betting data in SRIJ-defined categories and folder structure; permanent SRIJ access for consultation/collection; SRIJ pulls via **FTPS** (secção 2.1.2) |
| Captor | *captor* | May be outside Portugal, with the platform (secção 2.2) | Systematically extracts data from the gaming platform, validates, formats (**XML**), compresses/encrypts (**ZIP**) per the SRIJ Modelo de Dados, and transmits to the Safe over FTPS/HTTPS or equivalent; must buffer and retransmit in full if the Safe is unavailable (secção 2.2.2) |
| Control infrastructure | *infraestrutura de controlo* (IC) | SRIJ-managed | SRIJ's environment: a **Data Warehouse** that polls each operator's Safe at set intervals, pulls the daily encrypted files, decrypts (Multicert private key), decompresses and loads them into database partitions (secções 3.1, 3.2.2) |

This is a **pull model**: the operator deposits files into its own Safe; SRIJ's Managed File Transfer process detects and collects them (Anexo 1). The regulator does not receive pushed submissions except for the self-exclusion notification web service. SRIJ also performs on-site and remote audits and can demand ad-hoc reports "with the nature and specific format indicated case by case" (secções 3.2, 3.2.3).

Anexo 1 states minimum Safe specifications: Linux OS (Oracle Linux / Red Hat tested), a dedicated ≥20 Mbps connection to the IC, an FTPS service, and a fixed (conspicuously Oracle-flavoured) folder structure `/u01/app/oracle/mftxfer/in`, `.../in/excl`, `.../in/out`.

## What must be recorded and reported

### Systematic reporting — the six Safe file categories (Anexo 1)

Operators must produce XML files per predefined category, grouped daily into a single signed, compressed (ZIP) and encrypted file per day deposited in the Safe (secções 2.1.4, 3.3.1–3.3.4; Anexo 1). File naming: `CCCC_YYYYMMDD[HH24]_[GameVault code].xml` (e.g. `AJOG_2015040221_2AA.xml`); reprocessed files carry an `rp.xml` suffix. Every file has a common envelope: `cod_entexpl` (operator code), `datahr` (file production datetime), `id_ficheiro` (file id), `cod_cofre` (safe/GameVault code).

| Category | Cadence | Content (PT / EN) |
|---|---|---|
| `RESF_` | Daily | *Resumo financeiro* — financial summary of the whole day per game type and licence: `total_apostas` (total stakes), `total_ganhos` (total winnings), `total_comissoes` (commissions/rake), `total_reembolsos` (refunds), `tipo_liq` international-liquidity flag (1/0). Amounts in euros. Must reconcile with the per-record files |
| `JGDR_` | Hourly | *Registos de jogadores* — new player registrations and updates: full KYC — `nome`, `data_nascimento`, `nif` (tax number), `id_cidadao` + `id_tipocid` (identity document number and type), `morada`/`cod_postal` (address), `id_nacao` (ISO 3166 alpha-2 nationality), `telefone`, `email`, `logon`, `alias_jog`, account code, payment type, registration timestamp, tax-authority response fields (`resp_at`, `id_resp_at`) |
| `SESS_` | Hourly | *Sessões* — login/logout events: player code, `id_sessao`, action timestamp, `tipo_log` (LOGIN/LOGOUT), `dispositivo` (C computer, A mobile app, B mobile browser, T TV) |
| `AJOG_` | Hourly | *Atividade de jogo* — all gaming activity, organised into **six vertical sub-records**: `sport` (sports betting), `hipica` (horse-race betting), `poker`, `pbanca` (baccarat / *Ponto e Banca*), `bjack` (blackjack), `fortazar` (games of chance: roulette/slots/bingo fields). Per bet/hand: game-slip and operation codes, start/end timestamps, event start/end, session id, player IP + IP region, and **before/movement/after balance triplets** for stake (`a_saldo_ini`/`a_valor`/`a_saldo_fim`), bonus, winnings (`g_*`), refunds (`r_*`), plus commission. Poker adds tournament flag, table id, buy-ins, blinds/button, table position and hyphen-separated **card lists** (`cartas_m`/`cartas_j`); baccarat adds point/bank cards and scores; `fortazar` adds roulette number/colour, slot result, bingo card and result. The player wrapper also carries account-level `saldo`/`bonus`/`pinscr` (poker tournament prize) triplets |
| `TRAN_` | Hourly | *Transações* — player-account wallet ledger: `cod_optct` (DEBITO/CREDITO between the player's bank account and the operator), operation timestamp, and `saldo_ini`/`saldo_mov`/`saldo_fim` triplet |
| `EXCL_` | Daily | *Autoexclusão* — self-exclusion requests registered with the operator: identity (document type/number, name, nationality), address, district, email, `SitProfissional` (occupation code, two-digit list 11–99), `Duracao` (months), `DataInicio`, reason (`Motivo`), and **hex-encoded images of the identity document front/back** (`DocFrente`/`DocVerso`) |

A game-event code unique per operator identifies each *evento de jogo* (a sports bet, poker tournament, roulette bet…), and each player in an event receives a per-event *código de evento de jogador* linking all their operations (Anexo 1, "Conceitos da estrutura do modelo de dados").

### SRIJ web services (Anexo 1)

Two SOAP services connect the operator to the IC (namespaces under `http://www.turismodeportugal.pt/...`):

- **Self-exclusion** — three flows: (1) daily `EXCL_` file to the Safe subdirectory `/in/excl`; (2) `ListaExcluidos` SOAP service the operator polls to download SRIJ's national self-excluded list (request: 3-char operator code; response: list of `CidadaoExcluido` with document type/number, nationality, start/end dates, confirmed S/N); (3) `NotificacaoPedidoExclusao` — SRIJ **pushes** real-time notifications of changes to its list into the operator's system, which must react and re-download the list. Operators must notify SRIJ of self-exclusions/revocations within **24 hours** (secções 2.2.3, 3.2; Anexo 1).
- **Identity verification** — at registration, verification either via the citizen card / *chave móvel digital* through the AMA `autenticacao.gov.pt` mechanism, or by real-time lookup of public-entity databases mediated by SRIJ via the `PedidoVerificacaoIdentidadeTP` service: request `Nome`/`Nif`/`DataNascimento`, response flags `NomeValido`, `NifValido`, `DataNascimentoValida`/`MaiorDeIdade` (of age), `Falecido` (deceased) as S/N values (secção 5.2.1; Anexo 1).

### Mandatory internal logs (prose-level, no schema given)

The body of the regulation obliges many auditable logs whose *content* is enumerated but whose *format* is not — these live in the operator's system and feed the Safe categories and ad-hoc reports:

- **T&C acceptance** log (secção 5.1.1 n.º 2); **complaints** log with grounds, player, date/time, resolution time, outcome accepted/partially/rejected (secção 5.1.4); **player-data changes** and password changes in an auditable log (secção 5.2.3); **account deactivation** log with balance, reason and responsible employee (secção 5.2.4).
- **Deposits** log (date/time, payment instrument, player, amount, transaction type) and **withdrawals** log, plus reports of all deposits by instrument and all *rejected* deposit/withdrawal attempts (secções 5.4.1 n.º 5–8, 5.4.2 n.º 7–9); **bonus credits** log — bonuses are play-only, never withdrawable (secção 5.4.4).
- **Session information** (player ID, start/end, device details, total staked/won/deposited/withdrawn with timestamps, last confirmation, closure reason — secção 6.3.6 n.º 2); **player data** record (identity, account and balance, suspension/self-exclusion status, prior accounts and cancellation reason — n.º 3); **games played** (game id and version, start/end times, balances at start/end, bets, jackpot contribution, game state, result, prizes, unfinished games — n.º 4); **relevant events** (top prizes, large fund transfers, game/jackpot parameter changes, jackpot lifecycle, self-exclusions/suspensions — n.º 6–7); **system errors** with cause and resolution (secção 6.3.3).
- **Jackpot register**, audit-grade: date/time, configuration, contributions, initiators, prizes, authorised staff access; jackpot state on redundant fault-tolerant storage; values reconstructible from player contributions (secção 6.4.6).
- **Bets register** for everything operated under the licence: date/time, possible outcomes, player's stake, operator's stake if applicable, result (secção 6.5.1).
- **Reporting/analysis capabilities** for AML/CFT suspicious transactions, deviation from betting patterns, inactive accounts (>90 days), cancellations with positive balance, registrations complete/incomplete, suspended/self-excluded players, player-set limits (secção 5.5); real-time detection of collusion and bots in peer-to-peer games (secção 6.6.3).

### Player registration data (secção 5.2.1)

Collected and stored at registration: full name, date of birth, nationality, **profession**, residential address, country of residence, civil ID/passport/other document number, **NIF** (tax number), email, payment-account identifiers. One active registration per Internet presence; account may never go negative; no player-to-player transfers (secções 5.2.2 n.º 1–4). Portugal is thus firmly on the **full-KYC** end of the spectrum (like ES/GR, unlike DK/NL).

### Responsible gambling (secções 5.3, 1.5)

Player-set **deposit limits** and **bet limits** each at daily/weekly/monthly granularity; reductions apply immediately (at latest at next login), relaxations after a **24-hour** cooling delay (secção 5.3.2 n.º 2–5). Self-exclusion options: short reflection pauses, minimum **three months**, or indefinite — indefinite self-exclusion cancels the account and returns the balance to the player's payment account (secção 5.3.2 n.º 6–10; definition in secção 1.5). Suspension lists with reasons (secção 5.3.1).

## Timing, cadence and retention

- **Hourly XML files** per category covering all activity of that hour; **daily ZIP** per day containing at least the four hourly category sets plus the daily `RESF_` financial summary and daily `EXCL_` list, deposited in the Safe **by 01:00** local time for the previous day (secções 3.3.2–3.3.3; Anexo 1). SRIJ's collection window runs roughly 01:00–12:00. Files rejected as invalid must be reprocessed, re-encrypted and re-deposited as `…rp.xml` outside the normal processing window — and **every reprocessing batch must include the `RESF_` file** (Anexo 1). This is PT's correction mechanism: file-level regeneration, not record-level cancellation.
- **Real-time obligations** are limited to: routing all traffic through the IER, self-exclusion list notifications/downloads, identity verification at registration, and P2P fraud monitoring. Gaming activity reporting itself is hourly-batch.
- **Timekeeping**: everything synchronised to the legal time of continental Portugal via NTP from the Observatório Astronómico de Lisboa (secções 2.1.3, 7.7.7).
- **Availability**: gaming must stop if the Gateway is down, if the Captor cannot sustain hourly reporting, or if the Safe is down for more than 24 hours; cumulative Captor/Safe downtime ≤ **4 hours/month** (secção 2.3.3). Lost data must be re-extracted within **one week** (secção 2.3.4); disaster recovery of the IER within one month (secção 2.3.5).
- **Retention**: Safe data for at least **10 years** (120 months) — the most recent **24 months online** in the Safe, the remaining 96 months allowed on digital archive media with a recovery process for 8 years (secções 2.3.6, 6.3.7). Security audit logs ≥ 6 months (secção 7.7.6). Account activity visible to the player online for ≥90 days, statements coverable for 12 months (secções 5.2.2 n.º 9–10).

## Data typing and format requirements

Where the document is explicit:

- **Format**: XML per the SRIJ XSDs ("Definição de Esquema XSD-XML", secção 3.3), one file per hour per category, zipped daily.
- **Timestamps**: event/operation timestamps documented as `YYYYMMDDHH24MISS.FF TZH:TZM` (fractional seconds + timezone offset); file datetimes and financial dates as `YYYYMMDDHH24MISS` / `YYYYMMDD` digit strings — declared in the printed XSDs as `xs:string`/`xs:int`, not `xs:dateTime`.
- **Money**: euros, implicit (stated per field comment: "em euros"); no currency element. Balance-triplet pattern (initial/movement/final) on stakes, bonuses, winnings and refunds.
- **Code lists in the document**: identity document type `id_tipocid` (0 BI, 1 Cartão de Cidadão, 2 passport, 3 NIF, 4 other); device (C/A/B/T); session log type (LOGIN/LOGOUT); transaction (DEBITO/CREDITO); result codes per vertical (e.g. 0 lost / 1 won / 3 draw; poker 2 = all-in; baccarat 4 ponto / 3 draw / 5 banca); roulette colour V/P; S/N booleans; ISO 3166 alpha-2 nationality; two-digit occupation list (11–99); cards as hyphen-separated lists; document images as hex-encoded binary.
- **What the printed XSDs do *not* give**: real types (amounts, timestamps, flags are nearly all `xs:string`; `cod_entexpl` is `xs:byte` and `datahr` `xs:int` — the latter cannot even hold a 14-digit datetime), no patterns, no enumerations enforced in-schema (they live only in the prose field comments), no namespaces on the six category schemas, and no key/keyref constraints. **Do not treat the gazette XSDs as production-grade** — the authoritative current schemas are in SRIJ's Modelo de Dados package.

## Certification, homologation, integrity and security

- **Certification before licensing**: the whole gaming technical system must be certified by a **Recognised Certification Body** (*Organismo de Certificação Reconhecido*, OCR) from SRIJ's published list, per SRIJ's certification programme (secções 1.2, 4.1–4.2; RJO artigo 35.º). Exceptional certification with unmet requirements needs an ISO/IEC 31010 risk assessment. After certification, game software undergoes **homologation (type-approval) by SRIJ itself** (secção 3.2.1).
- **File integrity**: each data category must be **signed, compressed and encrypted** by the operator using SRIJ-issued **Multicert PKI certificates** (ITU X.509 v3, RFC 5280, 2048-bit RSA, SHA-256, 3-year validity); SRIJ decrypts with the Multicert private key. SRIJ supplies an `encripta.sh` reference script (secção 2.1.4; Anexo 1). Data must be encrypted "at the end" of the pipeline but not necessarily at rest throughout; key custody must be part of the IER security design (secção 2.3.1).
- **ISMS**: full information-security management regime based on **ISO/IEC 27001:2013 Annex A** (secção 7): access control, cryptographic key custody on redundant secure storage, environment separation (dev/test/prod), backups with point-in-time recovery, network segregation, dual DNS, intrusion detection, non-repudiation of player actions (secção 5.2.2 n.º 7).
- **Audits**: annual security audit; annual penetration tests (PCI-DSS / OWASP inspired) explicitly including attempts to **manipulate the Safe's data collection and storage**; quarterly vulnerability scans; CVSS ≥ 7.0 findings fixed within 48 hours (secções 8.1–8.3).
- **Change management** (secção 9): component register with unique IDs, versions, **hash values for substantially relevant components**, and geographic location; components classified 1–3 on confidentiality/integrity/availability/traceability; relevance-3 changes require **prior SRIJ approval**; RNG changes notified ≥5 business days ahead (secção 9.9.1); new games or changes that use Modelo de Dados record types not previously used require SRIJ approval 5 business days ahead **with example records** (secção 9.9.2).
- **RNG**: cryptographically secure, DIEHARD/NIST test suites, certified, with fail-safe disabling on error (secção 6.7).
- **Supervision hooks**: operators must define gaming-control indicators and alert thresholds; when a threshold trips, the associated systematic data must also be sent to SRIJ (secção 8.4.1). Errors, security incidents, data loss and disasters must be reported to SRIJ immediately (secções 2.3.4–2.3.5, 7.11, 8.4.2).

## Notable characteristics and quirks

- **Regulation-with-embedded-schemas**: the only sampled jurisdiction where the wire format was published inside the legal gazette text — complete with an inconsistency: the `EXCL_` prose says "one file per hour" while its filename rule and the storage chapter say daily (Anexo 1 V.6 vs. section I of the storage requirements).
- **Sovereignty by architecture**: gateway and Safe must be on Portuguese soil and all traffic must transit a `.pt` domain, even though the gaming platform and Captor may be abroad (secções 2.1, 2.2, 5.1.2).
- **Prescribed infrastructure details** unusual for a regulation: Linux distribution guidance, 20 Mbps line, literal Oracle filesystem paths, and a named shell script.
- **Balance triplets everywhere** (initial/movement/final for cash, bonus and poker-prize wallets) make the hourly files a self-verifying ledger — the same design instinct as FR's `SoldeAvant/Mouvement/Après`.
- **Gameplay depth**: `AJOG_` records cards on the table and in hand, table position, button holder, and baccarat scores — full hand reconstruction, again FR-like, but batched hourly rather than streamed per event.
- **Self-exclusion is bidirectional and identity-heavy**: operators upload requests including scanned ID images (hex), and consume a national list via SOAP pull plus real-time push.
- **International liquidity is a first-class flag** (`tipo_liq` in `RESF_`, `ap_cruz` cross-bet marker in `AJOG_`), anticipating shared poker pools.
- **Quirk watch**: gazette XSDs use `mixed="true"` on record types, `windows-1252` encoding on the web-service XSDs, an `xsd:list`-based S/N enumeration that is arguably invalid XSD, and OCR-style typos (e.g. "SRIJe", "ORC" for OCR) — all signs the gazette text is a transcription, not the normative artefact.

## How PT compares to the five analysed regimes

- **Closest relative: Denmark's SAFE.** PT's Safe is the same concept with the same name — an operator-hosted store from which the regulator pulls standardised files (DK via FTP + TamperToken; PT via FTPS + Multicert PKI). Both are batch-file regimes with per-category files.
- **FR's sealed-vault DNA, without the seal.** Like FR's *frontal/coffre-fort*, PT forces all traffic through an in-country capture point (IER) and records balance triplets and full gameplay; unlike FR, PT aggregates hourly/daily files rather than appending atomic signed events, and integrity comes from file-level signing/encryption rather than a tamper-evident event chain. (The Portuguese word *cofre* survives in the `cod_cofre` element and the "GameVault code".)
- **Cadence** sits between GR (2-hourly floor) and DK/ES (daily): hourly XML, daily packaging, one financial summary per day.
- **Identity**: full-KYC like ES and GR (including profession — like ES's RUD — and the tax number), against DK/NL pseudonymity.
- **Corrections** are the crudest of the six: regenerate and re-deposit whole files with an `rp` suffix (no record-level rectification/cancellation constructs).
- **Unique to PT** among the six: statutory obligation to *stop offering games* when the reporting chain (Gateway/Captor/Safe) is down; identity verification and self-exclusion delivered as synchronous SOAP services from the regulator; ID document images inside a reporting feed.

## Derived schemas in this repository

The [`derived/`](derived/) folder contains a **derived, non-official** transcription of Anexo 1's embedded schemas: six category XSDs (`RESF`, `JGDR`, `SESS`, `AJOG`, `TRAN`, `EXCL`) over a shared envelope include (`pt-common.xsd`), the three SRIJ SOAP-service XSDs, and one schema-valid sample instance per family. They compile and validate under `xmlschema`, and every non-literal typing choice (e.g. fixing the gazette's `xs:int` datetimes, typing euro amounts as `xs:decimal`) is marked `INFERRED`/`NORMALISED` in `xs:documentation` with a citation to the regulation. They are an interpretation for architecture and demo work — **not** SRIJ's Modelo de Dados; see `derived/README.md`.

## Open questions for implementation

A real onboarding would still need to obtain from SRIJ:

1. **The current "Modelo de Dados" package** — versioned XSDs for `RESF_`/`JGDR_`/`SESS_`/`AJOG_`/`TRAN_`/`EXCL_` (the gazette snapshots are 2015-era, loosely typed, and the regulation says formats "may subsequently be altered", secção 3.3.1), plus the Safe folder-structure spec and the `encripta.sh` signing/compression/encryption procedure and its current cryptographic parameters.
2. **The GameVault code and operator code assignment** (`cod_cofre`, `cod_entexpl`, 3-char codes like `2AA`) and Multicert certificate enrolment process.
3. **Authoritative code lists**: game-type descriptions for `RESF_`/`tipo_jogo`, bet result codes per vertical, payment-type codes (`tip_pag`), card encodings for the hyphen-separated lists, IP-region values, and whether new verticals (e.g. bingo as a category, lotteries) have been added since 2015.
4. **The current WSDL endpoints, authentication and environments** for `ListaExcluidos`, `NotificacaoPedidoExclusao` and `PedidoVerificacaoIdentidadeTP`, plus AMA `autenticacao.gov.pt` integration credentials and test harness.
5. **Precision rules** the prose leaves open: decimal places for euro amounts, exact timestamp fractional-seconds/timezone expectations, whether hourly files must exist for empty hours, and validation rules SRIJ's collection process applies (which drive the `rp.xml` reprocessing loop).
6. **The certification programme documents** (Programa de Certificação, Procedimentos da Gestão de Alterações) referenced but not included, and the OCR list.
7. **Ad-hoc supervision report formats** (secção 3.2.3) and the alert-threshold data feed expectations (secção 8.4.1), which are defined case-by-case.
