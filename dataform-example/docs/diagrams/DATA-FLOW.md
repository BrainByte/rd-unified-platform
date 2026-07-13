# Data Flow Diagram — Unified Regulatory Reporting Platform

How data moves from the operator's transactional systems, through the layered
transformation DAG, past the compliance gate, and out to each regulator — with
**config as data** driving the per-market fan-out. Three views:

1. **Context (Level 0)** — external entities and the system boundary
2. **Pipeline (Level 1)** — the layered processes, data stores, and the gate
3. **Config control plane** — how "variance as data" parameterises the DAG

---

## 1 · Context diagram (Level 0)

```mermaid
flowchart LR
    OLTP["🗄️ Operator OLTP<br/>(SQL Server)"]
    PROV["🎰 Game providers<br/>NetEnt · Evolution<br/>Playtech · Aggregator"]
    GIT["📁 Git-versioned config<br/>jurisdictions · nomenclature<br/>extensions · rules"]
    COMP["🛡️ Compliance / Ops<br/>team"]
    REG["🏛️ Regulators<br/>MGA · DGOJ · Spillemyndigheden<br/>NRA · HGC · KSA · GGL"]

    SYS(("Unified Reporting<br/>Platform"))

    OLTP -- "CDC change stream<br/>(Datastream)" --> SYS
    PROV -- "daily feeds +<br/>GGR statements" --> SYS
    GIT  -- "mappings, tax rates,<br/>market rules" --> SYS
    SYS  -- "unmapped queues,<br/>recon breaks, breach alerts" --> COMP
    COMP -- "mapping / rule updates<br/>(reviewed PRs)" --> GIT
    SYS  -- "submission files +<br/>tax summaries" --> REG
```

---

## 2 · Pipeline (Level 1) — the transformation DAG

Data flows top-to-bottom through materialised layers. Between the marts and the
regulator outputs sit **correctness rules** (hard-fail on invalid data) and
**fault isolation** (quarantine-first): a bad/late/held entity is routed to
`fct_exceptions` and excluded, while everyone else ships. **Nothing
held/quarantined/incomplete ever reaches a regulator** — the one hard block.

```mermaid
flowchart TB
    subgraph EXT [" "]
        direction LR
        OLTP["🗄️ SQL Server OLTP"]
        PROV["🎰 Provider feeds"]
    end

    subgraph L0 ["① Source · cdc_landing (23 CDC tables)"]
        CDC["cdc_accounts · cdc_bet_slips · cdc_bet_slip_events<br/>cdc_fixtures · cdc_games · cdc_*_rounds · cdc_payments<br/>cdc_player_limits · cdc_self_exclusions · cdc_verifications<br/>cdc_operator_jackpot_* · cdc_reg_attributes · ..."]
    end

    subgraph L1 ["② Staging · dedupe latest-per-key (_op != D)"]
        STG["stg_accounts · stg_bet_slip_events · stg_fixtures<br/>stg_games · stg_game_rounds (4 feeds normalised)<br/>stg_payments · stg_player_limits · stg_verifications<br/>stg_self_exclusions · stg_operator_jackpot_* · stg_reg_attributes"]
    end

    subgraph L2 ["③ Reference · nomenclature spine (from git)"]
        REF["ref_sport_canonical · ref_sport_aliases · ref_participant_aliases<br/>ref_game_type_aliases<br/><b>map_sport_regulator</b> · <b>map_game_regulator</b> (effective-dated)"]
    end

    subgraph L3 ["④ Core & Gaming marts (jurisdiction-agnostic)"]
        CORE["dim_customer_account · fct_bet_slip_lifecycle · dim_fixture<br/>dim_game · <b>fct_gaming_activity</b> · fct_jackpot_liability<br/>fct_operator_jackpot_contributions (void/refund cascade)<br/>fct_operator_jackpot_liability · recon_provider_ggr"]
    end

    subgraph L4 ["⑤ Player protection · wallet & compliance"]
        PP["fct_payments · fct_player_gambling_activity<br/>fct_wallet_ledger &rarr; dim_wallet_balance<br/>dim_player_compliance · rg_effective_deposit_limits"]
    end

    subgraph GATE ["⑥ Correctness + fault isolation (quarantine-first)"]
        direction LR
        RULES["Rule assertions<br/>rule_&lt;mkt&gt;_&lt;clause&gt;<br/>(correctness — hard)"]
        BREACH["breach detectors +<br/>address validation +<br/>rg_period_readiness"]
        EXC[("fct_exceptions<br/>route by class:<br/>DATA/TRANSIENT/<br/>COMPLETENESS/COMPLIANCE")]
    end

    subgraph L5 ["⑦ Submissions · admissible entities only"]
        SUB["submission_ready_&lt;mkt&gt; · tax_summary_&lt;mkt&gt;<br/>gaming_submission_ready_&lt;mkt&gt; · gaming_tax_summary_&lt;mkt&gt;<br/>(MT ES DK BG GR NL DE)"]
    end

    QUEUE["📋 Maintenance queues<br/>unmapped_sports · unmapped_game_types<br/>recon_provider_ggr breaks"]
    EXCFLOW["🩹 Exception flow<br/>retry (backoff) · triage ·<br/>reprocess · restatement"]
    REG["🏛️ Regulators"]

    OLTP --> CDC
    PROV --> CDC
    CDC --> STG
    STG --> REF
    STG --> CORE
    REF --> CORE
    CORE --> PP
    CORE --> RULES
    PP --> BREACH
    CORE --> BREACH
    BREACH --> EXC
    RULES --> SUB
    REF --> SUB
    STG -. "extension attrs" .-> SUB
    EXC -- "admissibility:<br/>held/quarantined/incomplete excluded" --> SUB
    EXC --> EXCFLOW
    EXCFLOW -. "retry / fixed / late data arrived" .-> CDC
    SUB -->|"isolation gate: no blocked entity ships"| REG
    CORE -. "NULL canonical" .-> QUEUE
    CORE -. "GGR mismatch" .-> QUEUE

    classDef gate fill:#fde8e8,stroke:#c0392b,stroke-width:2px;
    classDef out fill:#e8f5e9,stroke:#2e7d32,stroke-width:1.5px;
    classDef ref fill:#eef4fb,stroke:#2b6cb0;
    class GATE,RULES,BREACH,EXC gate;
    class L5,SUB out;
    class L2,REF ref;
```

**Reading the gate (quarantine-first):** correctness rules still hard-fail on
invalid data. But a breach, a bad postcode, or an unready period no longer
aborts the run — the entity is routed into `fct_exceptions` (DATA→quarantine,
TRANSIENT→retry, COMPLETENESS→wait, COMPLIANCE→hold) and excluded from its file
by the admissibility filter, while everyone else ships. The one hard structural
block is **isolation itself**: no held/quarantined/incomplete entity may reach a
regulator. Legitimately-absent data (an OPEN slip's settlement) is shipped
correctly as empty — told apart from "late" by terminal *state*, not row-absence.
**Negative tests** prove each guardrail — including the isolation gate — fires.

---

## 3 · Config control plane — "market variance is data"

The same DAG serves every market. What differs between MT, ES, DK, BG, GR and NL
is **configuration**, not code — so a new market is a config change, not a new
pipeline.

```mermaid
flowchart LR
    subgraph CFG ["Git-versioned config (control inputs)"]
        JUR["jurisdictions.js<br/>tax rate · cadence · timezone<br/>player-id treatment · rules · extensions"]
        NOM["nomenclature/<br/>canonical taxonomy + aliases +<br/>per-regulator code maps"]
        EXT["extensions.js<br/>per-market bespoke attributes<br/>(carrier + computed)"]
        RUL["rules engine<br/>declarative regulatory clauses"]
    end

    subgraph ENGINE ["Shared, write-once transformation logic"]
        Q["query builders<br/>fields · filters · queries"]
        R["rule -> assertion compiler"]
        D["dialect layer<br/>(BigQuery / DuckDB)"]
    end

    subgraph OUT ["Materialised per market (fan-out)"]
        M1["MT files + tax"]
        M2["ES files + tax"]
        M3["DK · BG · GR · NL<br/>files + tax"]
    end

    JUR --> Q
    NOM --> Q
    EXT --> Q
    RUL --> R
    Q --> D
    R --> D
    D --> M1
    D --> M2
    D --> M3

    EFF["⏱️ effective-dating<br/>valid_from / valid_to +<br/>rate schedules"]
    EFF -. "resolved by report_date" .-> NOM
    EFF -. "resolved by report_date" .-> JUR

    classDef cfg fill:#fff7e6,stroke:#b7791f;
    class CFG,JUR,NOM,EXT,RUL cfg;
```

**Effective-dating** closes the time dimension: a resubmission of a historical
period resolves the tax rate and regulator code that were *in force then*
(`valid_from`/`valid_to` on the maps, a rate schedule on the jurisdiction),
not today's values.

---

## 4 · Runtime paths — production vs offline

The identical model runs two ways; the offline path is the developer gate and
needs no cloud.

```mermaid
flowchart LR
    SRC["includes/*.js<br/>(single source of truth<br/>for all SQL)"]

    subgraph PROD ["Production"]
        DF["Dataform"]
        BQ["BigQuery"]
        DF --> BQ
    end

    subgraph LOCAL ["Offline harness"]
        RUN["local/run.js"]
        DUCK["DuckDB (embedded)"]
        RUN --> DUCK
    end

    SRC --> DF
    SRC --> RUN
    SEED["seed/data.js"] --> BQ
    SEED --> DUCK
    DUCK --> CHK["npm run check<br/>119 tests · 66 models<br/>87 assertions · 16 negative tests<br/>= definition of done"]
```
