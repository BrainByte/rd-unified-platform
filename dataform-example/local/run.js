// ============================================================================
// OFFLINE PIPELINE RUNNER — the whole DAG in DuckDB, no GCP required.
//
//   npm install            (once — pulls @duckdb/node-api, dev only)
//   node local/run.js            run pipeline + rule assertions + expectations
//   node local/run.js --dry-run  print the execution plan without DuckDB
//
// What it does:
//   1. setDialect('duckdb') so all generated SQL targets DuckDB
//   2. loads seed/data.js into an in-memory DuckDB
//   3. builds every model from includes/models.js + reference data +
//      per-market submissions/tax from includes/queries.js — the SAME
//      builders Dataform uses, in dependency order
//   4. runs every rule assertion (expect zero violations)
//   5. checks the integration expectations from local/expectations.js
//   6. negative test: corrupts a copy of the MT file and proves the
//      rules catch it
// ============================================================================

"use strict";
const { setDialect } = require("../includes/dialect");
setDialect("duckdb"); // MUST precede any SQL generation

const m = require("../includes/models");
const pp = require("../includes/player_protection");
const ex = require("../includes/exceptions");
const { submissionQuery, taxSummaryQuery, gamingSubmissionQuery, gamingTaxSummaryQuery } = require("../includes/queries");

// Fixed "now" for the offline run so the retry state machine is deterministic
// (Dataform would pass CURRENT_TIMESTAMP()). See includes/exceptions.js.
const RUN_TS = "TIMESTAMPTZ '2026-07-08 12:00:00+00'";
const { jurisdictions, commonRules, commonGamingRules } = require("../includes/jurisdictions");
const { marketRules, marketGamingRules, violationQuery } = require("../includes/rules");
const { validateAll } = require("../includes/validate");
const { canonicalSports } = require("../includes/nomenclature/canonical");
const { sportAliases, participantAliases, gameTypeAliases } = require("../includes/nomenclature/aliases");
const { normalise, rowsToSelect } = require("../includes/nomenclature/mapping");
const { codeRows } = require("../includes/effective_dating");
const { buildDuckDbStatements } = require("../seed/generate");
const { expectations } = require("./expectations");

const ctx = { ref: (name) => name }; // flat namespace locally

// ---- build the ordered plan: [{ name, sql, kind }] ----
function buildPlan() {
  const steps = [];
  const table = (name, sql) => steps.push({ name, sql: `CREATE OR REPLACE TABLE ${name} AS ${sql}`, kind: "model" });

  // reference tables from in-repo data (same construction as
  // definitions/15_reference/reference_tables.js)
  table("ref_sport_canonical", rowsToSelect(canonicalSports, ["code", "name"]));
  table("ref_sport_aliases", rowsToSelect(
    sportAliases.map((a) => ({ alias_norm: normalise(a.alias), canonical: a.canonical, source: a.source || null })),
    ["alias_norm", "canonical", "source"]));
  table("ref_participant_aliases", rowsToSelect(
    participantAliases.map((a) => ({ alias_norm: normalise(a.alias), canonical_id: a.canonicalId, canonical_name: a.canonicalName })),
    ["alias_norm", "canonical_id", "canonical_name"]));
  table("ref_game_type_aliases", rowsToSelect(
    gameTypeAliases.map((a) => ({ alias_norm: normalise(a.alias), canonical: a.canonical, source: a.source || null })),
    ["alias_norm", "canonical", "source"]));
  const gameMapCols = ["jurisdiction", "canonical_game_type", "regulator_code", "valid_from", "valid_to"];
  const gameMapRows = [];
  for (const j of Object.values(jurisdictions)) {
    if (!j.gamingNomenclature) continue; // betting-only markets carry no gaming map
    for (const row of codeRows(j.gamingNomenclature.gameCodes)) {
      gameMapRows.push({ jurisdiction: j.code, canonical_game_type: row.canonical, regulator_code: row.code, valid_from: row.valid_from, valid_to: row.valid_to });
    }
  }
  table("map_game_regulator", rowsToSelect(gameMapRows, gameMapCols));

  const sportMapCols = ["jurisdiction", "canonical_sport", "regulator_code", "valid_from", "valid_to"];
  const mapRows = [];
  for (const j of Object.values(jurisdictions)) {
    for (const row of codeRows(j.nomenclature.sportCodes)) {
      mapRows.push({ jurisdiction: j.code, canonical_sport: row.canonical, regulator_code: row.code, valid_from: row.valid_from, valid_to: row.valid_to });
    }
  }
  table("map_sport_regulator", rowsToSelect(mapRows, sportMapCols));

  // statutory slots stake caps, from config (REQ: requirements/max-stake-limits)
  table("ref_stake_limits", rowsToSelect(pp.stakeLimitRows(),
    ["jurisdiction", "game_scope", "max_stake", "min_age", "max_age", "valid_from", "valid_to"]));

  // staging -> core -> fixtures (same builders Dataform wires up)
  table("stg_accounts", m.stgAccounts(ctx));
  table("stg_bet_slip_events", m.stgBetSlipEvents(ctx));
  table("stg_fixtures", m.stgFixtures(ctx));
  table("stg_reg_attributes", m.stgRegAttributes(ctx));
  table("dim_customer_account", m.dimCustomerAccount(ctx));
  table("fct_bet_slip_lifecycle", m.fctBetSlipLifecycle(ctx));
  table("dim_fixture", m.dimFixture(ctx));
  table("unmapped_sports", m.unmappedSports(ctx));

  // gaming domain
  table("stg_games", m.stgGames(ctx));
  table("stg_game_rounds", m.stgGameRounds(ctx));
  table("stg_poker_activity", m.stgPokerActivity(ctx));
  table("stg_operator_jackpot_contributions", m.stgOperatorJackpotContributions(ctx));
  table("stg_operator_jackpot_wins", m.stgOperatorJackpotWins(ctx));
  table("fct_operator_jackpot_contributions", m.fctOperatorJackpotContributions(ctx));
  table("dim_game", m.dimGame(ctx));
  table("fct_gaming_activity", m.fctGamingActivity(ctx));
  table("fct_jackpot_liability", m.fctJackpotLiability(ctx));
  table("fct_operator_jackpot_liability", m.fctOperatorJackpotLiability(ctx));
  table("unmapped_game_types", m.unmappedGameTypes(ctx));
  table("recon_provider_ggr", m.reconProviderGgr(ctx));

  // player protection & payments
  table("stg_player_limits", pp.stgPlayerLimits(ctx));
  table("stg_self_exclusions", pp.stgSelfExclusions(ctx));
  table("stg_verifications", pp.stgVerifications(ctx));
  table("stg_payments", pp.stgPayments(ctx));
  table("fct_payments", pp.fctPayments(ctx));
  table("fct_player_gambling_activity", pp.fctPlayerGamblingActivity(ctx));
  table("fct_wallet_ledger", pp.fctWalletLedger(ctx));
  table("dim_wallet_balance", pp.dimWalletBalance(ctx));
  table("dim_player_compliance", pp.dimPlayerCompliance(ctx));
  table("rg_effective_deposit_limits", pp.rgEffectiveDepositLimits(ctx));
  table("rg_breach_deposit_limits", pp.rgBreachDepositLimits(ctx));
  table("rg_breach_loss_limits", pp.rgBreachLossLimits(ctx));
  table("rg_breach_wallet_overspend", pp.rgBreachWalletOverspend(ctx));
  table("rg_breach_activity_while_excluded", pp.rgBreachActivityWhileExcluded(ctx));
  table("rg_breach_unverified_withdrawals", pp.rgBreachUnverifiedWithdrawals(ctx));
  table("rg_breach_stake_limits", pp.rgBreachStakeLimits(ctx));  // REQ: requirements/max-stake-limits

  // fault isolation, data readiness & the exception flow. These sit BEFORE the
  // submissions: the submission admissibility filter reads fct_exceptions +
  // rg_period_readiness to exclude quarantined/held/incomplete entities while
  // everyone else ships. Under quarantine-first the breach detectors above no
  // longer hard-abort — they feed per-entity HOLDs here instead.
  table("stg_account_addresses", ex.stgAccountAddresses(ctx));
  table("dim_account_address_validated", ex.dimAccountAddressValidated(ctx));
  table("rg_period_readiness", ex.rgPeriodReadiness(ctx));
  table("ops_exception_state_next", ex.opsExceptionStateNext(ctx, RUN_TS));
  table("fct_exceptions", ex.fctExceptions(ctx, RUN_TS));

  // per-market outputs
  for (const j of Object.values(jurisdictions)) {
    const mkt = j.code.toLowerCase();
    table(`submission_ready_${mkt}`, submissionQuery(ctx, j));
    table(`tax_summary_${mkt}`, taxSummaryQuery(ctx, j));
    if (j.gamingReportFields) { // gaming is an opt-in domain per market
      table(`gaming_submission_ready_${mkt}`, gamingSubmissionQuery(ctx, j));
      table(`gaming_tax_summary_${mkt}`, gamingTaxSummaryQuery(ctx, j));
    }
  }

  // rule assertions: any returned row is a violation
  for (const j of Object.values(jurisdictions)) {
    for (const rule of marketRules(j, commonRules)) {
      steps.push({
        name: `rule ${j.code}/${rule.id}`,
        sql: violationQuery(ctx, j, rule),
        kind: "assertion",
        rule,
      });
    }
    if (!j.gamingReportFields) continue; // no gaming domain, no gaming rules
    for (const rule of marketGamingRules(j, commonGamingRules)) {
      steps.push({
        name: `gaming rule ${j.code}/${rule.id}`,
        sql: violationQuery(ctx, j, rule, {
          table: `gaming_submission_ready_${j.code.toLowerCase()}`,
          keyColumn: "activity_id",
        }),
        kind: "assertion",
        rule,
      });
    }
  }
  // Quarantine-first structural gate: under this model a compliance breach no
  // longer aborts the whole run — it HOLDS the breaching entity (fct_exceptions)
  // and excludes it from its file. The one invariant that still HARD-blocks is
  // isolation itself: a held / quarantined / incomplete entity must NEVER appear
  // in a submission. Any row here is a leak in the isolation mechanism.
  for (const j of Object.values(jurisdictions)) {
    steps.push({
      name: `isolation gate: no blocked entity in ${j.code} file`,
      sql: ex.blockedInSubmissionQuery(ctx, j),
      kind: "assertion",
    });
  }
  return steps;
}

// ---- negative test: prove the rules bite ----
// Corrupt a copy of the MT file (negative stake + duplicated slip) and
// re-run two rules against it, expecting violations.
function negativeTests() {
  const corruptCtx = { ref: (n) => (n === "submission_ready_mt" ? "submission_ready_mt_corrupt" : n) };
  const mt = jurisdictions.MT;
  return {
    setup: [
      `CREATE OR REPLACE TABLE submission_ready_mt_corrupt AS
         SELECT * FROM submission_ready_mt
         UNION ALL
         SELECT * REPLACE (-5.00 AS stake) FROM submission_ready_mt WHERE slip_id = 'S1'`,
    ],
    checks: [
      { rule: "COM-003 (non_negative stake)", expectViolations: 1,
        sql: violationQuery(corruptCtx, mt, { id: "COM-003", type: "non_negative", field: "stake" }) },
      { rule: "COM-005 (unique slip_id)", expectViolations: 1,
        sql: violationQuery(corruptCtx, mt, { id: "COM-005", type: "unique", field: "slip_id" }) },
    ],
  };
}

// Player-protection negative tests: corrupt a copy of fct_payments so
// that (1) the RGIAJ-excluded player's blocked deposit becomes COMPLETED,
// (2) A2001's deposit jumps over their personal 100/day limit, and
// (3) the unverified player's withdrawal completes. All three breach
// detectors must fire — proving the compliance net catches real failures.
function playerProtectionNegativeTests() {
  const corruptCtx = { ref: (n) => (n === "fct_payments" ? "fct_payments_corrupt" : n) };
  return {
    setup: [
      `CREATE OR REPLACE TABLE fct_payments_corrupt AS
         SELECT * FROM fct_payments
           WHERE payment_id NOT IN ('D3', 'D5', 'W3')
         UNION ALL
         SELECT * REPLACE ('COMPLETED' AS status, TIMESTAMPTZ '2026-07-08 09:15:05+00' AS completed_ts)
           FROM fct_payments WHERE payment_id = 'D5'
         UNION ALL
         SELECT * REPLACE (150.00 AS amount) FROM fct_payments WHERE payment_id = 'D3'
         UNION ALL
         SELECT * REPLACE ('COMPLETED' AS status, TIMESTAMPTZ '2026-07-08 13:00:00+00' AS completed_ts)
           FROM fct_payments WHERE payment_id = 'W3'`,
    ],
    checks: [
      { rule: "RGIAJ exclusion breach (excluded player's deposit completed)", expectViolations: 1,
        sql: `SELECT * FROM (${pp.rgBreachActivityWhileExcluded(corruptCtx)}) WHERE activity_type = 'DEPOSIT'` },
      { rule: "deposit limit breach (150 > personal 100/day; weekly/monthly ES defaults not exceeded)", expectViolations: 1,
        sql: `SELECT * FROM (${pp.rgBreachDepositLimits(corruptCtx)}) WHERE account_id = 'A2001'` },
      { rule: "unverified withdrawal breach (KYC)", expectViolations: 1,
        sql: pp.rgBreachUnverifiedWithdrawals(corruptCtx) },
    ],
  };
}

// Gaming negative tests: corrupt a copy of the ES gaming file with an
// invalid regulator code and a raking casino round; rules must fire.
function gamingNegativeTests() {
  const es = jurisdictions.ES;
  const gOpts = { table: "gaming_submission_ready_es_corrupt", keyColumn: "activity_id" };
  const corruptCtx = { ref: (n) => n };
  return {
    setup: [
      `CREATE OR REPLACE TABLE gaming_submission_ready_es_corrupt AS
         SELECT * FROM gaming_submission_ready_es
         UNION ALL
         SELECT * REPLACE ('XXX' AS game_code, 'X1' AS activity_id) FROM gaming_submission_ready_es WHERE activity_id = 'NE:R7'
         UNION ALL
         SELECT * REPLACE (9.99 AS rake_or_fee, 'X2' AS activity_id) FROM gaming_submission_ready_es WHERE activity_id = 'NE:R7'`,
    ],
    checks: [
      { rule: "ES-202 (valid_game_code)", expectViolations: 1,
        sql: violationQuery(corruptCtx, es, { id: "ES-202", type: "valid_game_code" }, gOpts) },
      { rule: "G-COM-005 (no rake on casino rounds)", expectViolations: 1,
        sql: violationQuery(corruptCtx, es,
          { id: "G-COM-005", type: "zero_when", field: "rake_or_fee", whenField: "vertical", equals: "CASINO_ROUND" }, gOpts) },
    ],
  };
}

// Extension negative test: corrupt a copy of the BG file with a malformed
// NRA registration reference (a carrier-sourced extension attribute) and
// prove the declarative format rule over that extension column fires.
function extensionNegativeTests() {
  const bg = jurisdictions.BG;
  const corruptCtx = { ref: (n) => (n === "submission_ready_bg" ? "submission_ready_bg_corrupt" : n) };
  return {
    setup: [
      `CREATE OR REPLACE TABLE submission_ready_bg_corrupt AS
         SELECT * FROM submission_ready_bg
         UNION ALL
         SELECT * REPLACE ('BADFORMAT' AS nra_registration_id, 'S8X' AS slip_id)
           FROM submission_ready_bg WHERE slip_id = 'S8'`,
    ],
    checks: [
      { rule: "BG-202 (nra_registration_id format — extension attribute)", expectViolations: 1,
        sql: violationQuery(corruptCtx, bg,
          { id: "BG-202", type: "matches", field: "nra_registration_id", pattern: "^BG-[0-9]{4}-[0-9]{9}$" }) },
    ],
  };
}

// Operator-jackpot licensing negative test: Spain (DGOJ) holds no licence
// that the phantom OJACK game maps to. If an operator-jackpot activity ever
// reached the ES file, the cross-domain no_unlicensed_games rule must fire —
// the reporting solution enforces the win-to-licensed-game correlation for
// free. (MT, which licenses OJACK under Type 1, carries it happily.)
function operatorJackpotBlockTest() {
  const es = jurisdictions.ES;
  const gOpts = { table: "gaming_submission_ready_es_ojack", keyColumn: "activity_id" };
  const corruptCtx = { ref: (n) => n };
  return {
    setup: [
      // Inject a real operator-jackpot activity id (OJC1 -> phantom game OJ1
      // -> canonical OJACK) into a copy of the ES gaming file.
      `CREATE OR REPLACE TABLE gaming_submission_ready_es_ojack AS
         SELECT * FROM gaming_submission_ready_es
         UNION ALL
         SELECT * REPLACE ('OJC1' AS activity_id) FROM gaming_submission_ready_es WHERE activity_id = 'NE:R7'`,
    ],
    checks: [
      { rule: "ES-201 (no_unlicensed_games) blocks the operator jackpot — no DGOJ licence", expectViolations: 1,
        sql: violationQuery(corruptCtx, es, { id: "ES-201", type: "no_unlicensed_games" }, gOpts) },
    ],
  };
}

// Loss-limit negative test: a large operator-jackpot contribution (a gaming
// wager on the phantom game) pushes A1001's net loss over their personal
// daily LOSS limit — proving operator-jackpot contributions count toward
// loss limits exactly like any other stake.
function lossLimitContributionTest() {
  const corruptCtx = { ref: (n) => (n === "fct_player_gambling_activity" ? "fct_player_gambling_activity_corrupt" : n) };
  return {
    setup: [
      `CREATE OR REPLACE TABLE fct_player_gambling_activity_corrupt AS
         SELECT * FROM fct_player_gambling_activity
         UNION ALL
         SELECT 'A1001' AS account_id, 'MT' AS jurisdiction,
                TIMESTAMPTZ '2026-07-08 12:00:00+00' AS occurred_at,
                100.00 AS stake, 0.00 AS payout, 'OPERATOR_JACKPOT' AS source`,
    ],
    checks: [
      { rule: "loss-limit breach: a 100 operator-jackpot contribution tips A1001 over their 50/day loss limit", expectViolations: 1,
        sql: `SELECT * FROM (${pp.rgBreachLossLimits(corruptCtx)}) WHERE account_id = 'A1001' AND period = 'DAILY'` },
    ],
  };
}

// Spend-gate negative test: inject a large unfunded debit for A1001 after
// all their real activity — the running wallet balance goes negative, so the
// sufficient-balance gate fires. Proves the platform would catch a spend the
// wallet can't cover.
function walletOverspendTest() {
  const corruptCtx = { ref: (n) => (n === "fct_wallet_ledger" ? "fct_wallet_ledger_corrupt" : n) };
  return {
    setup: [
      `CREATE OR REPLACE TABLE fct_wallet_ledger_corrupt AS
         SELECT * FROM fct_wallet_ledger
         UNION ALL
         SELECT 'A1001' AS account_id, TIMESTAMPTZ '2026-07-08 23:00:00+00' AS ts,
                'BET_STAKE' AS entry_type, -100000.00 AS signed_amount`,
    ],
    checks: [
      { rule: "sufficient-balance gate: an unfunded 100000 spend drives A1001's wallet negative", expectViolations: 1,
        sql: `SELECT * FROM (${pp.rgBreachWalletOverspend(corruptCtx)}) WHERE account_id = 'A1001'` },
    ],
  };
}

// Max-stake-limit negative tests (REQ: requirements/max-stake-limits,
// REQ-MSL-5). Inject stakes into a copy of fct_gaming_activity and prove the
// detector resolves the cap in force AT EACH STAKE'S OWN age and date:
//   XSL1 adult (A1001, 38) slot stake 9.00 after go-live      -> 5-cap FIRES
//   XSL2 young (A8001, 21) slot stake 3.00 after youth band   -> 2-cap FIRES
//   XSL3 young (A8001, 21) slot stake 3.00 BEFORE youth band  -> exempt (only
//        the 5-cap adult band is in force: effective-dating proven)
//   XSL4 A1001 poker stake 50.00 over their personal 30 cap   -> FIRES
//        (personal STAKE_CASINO covers all verticals; statutory is slots-only)
function stakeLimitNegativeTests() {
  const corruptCtx = { ref: (n) => (n === "fct_gaming_activity" ? "fct_gaming_activity_stakes" : n) };
  const row = (id, acct, game, vertical, stake, ts) =>
    `SELECT '${id}' AS activity_id, '${acct}' AS account_id, '${game}' AS game_id,
            '${vertical}' AS vertical, ${stake} AS stake, 0 AS payout, 0 AS rake_or_fee,
            0 AS jackpot_contribution, CAST(NULL AS VARCHAR) AS jackpot_id,
            TIMESTAMPTZ '${ts}' AS occurred_at`;
  const detector = (id) =>
    `SELECT * FROM (${pp.rgBreachStakeLimits(corruptCtx)}) WHERE activity_id = '${id}'`;
  return {
    setup: [
      `CREATE OR REPLACE TABLE fct_gaming_activity_stakes AS
         SELECT * FROM fct_gaming_activity
         UNION ALL ${row("XSL1", "A1001", "G1", "CASINO_ROUND", 9.00, "2026-08-05 12:00:00+00")}
         UNION ALL ${row("XSL2", "A8001", "G1", "CASINO_ROUND", 3.00, "2026-09-20 12:00:00+00")}
         UNION ALL ${row("XSL3", "A8001", "G1", "CASINO_ROUND", 3.00, "2026-08-20 12:00:00+00")}
         UNION ALL ${row("XSL4", "A1001", "G6", "POKER_CASH", 50.00, "2026-07-09 12:00:00+00")}`,
    ],
    checks: [
      { rule: "stake limit: adult 9.00 slot stake over the MT 5.00 cap (in force) fires", expectViolations: 1,
        sql: detector("XSL1") },
      { rule: "stake limit AGE BAND: 21-year-old's 3.00 slot stake over the 18-24 2.00 cap fires", expectViolations: 1,
        sql: detector("XSL2") },
      { rule: "stake limit EFFECTIVE-DATING: the same 3.00 stake BEFORE the youth band arms is exempt (only the 5.00 adult cap in force)", expectViolations: 0,
        sql: detector("XSL3") },
      { rule: "stake limit PERSONAL: 50.00 poker stake over A1001's personal STAKE_CASINO 30.00 fires (all casino verticals)", expectViolations: 1,
        sql: detector("XSL4") },
    ],
  };
}

// Fault-isolation negative test: force a quarantined account's slip (A7001 /
// S7001) into a copy of the MT file. The structural isolation gate must catch
// it — proving the one hard invariant (nothing held/quarantined/incomplete may
// reach a regulator) actually bites.
function faultIsolationNegativeTests() {
  const mt = jurisdictions.MT;
  const corruptCtx = { ref: (n) => (n === "submission_ready_mt" ? "submission_ready_mt_leak" : n) };
  return {
    setup: [
      `CREATE OR REPLACE TABLE submission_ready_mt_leak AS
         SELECT * FROM submission_ready_mt
         UNION ALL
         SELECT * REPLACE ('S7001' AS slip_id) FROM submission_ready_mt WHERE slip_id = 'S1'`,
    ],
    checks: [
      { rule: "isolation gate: a quarantined account (A7001 / S7001) leaked into the MT file is caught", expectViolations: 1,
        sql: ex.blockedInSubmissionQuery(corruptCtx, mt) },
    ],
  };
}

// ---- execution ----
async function main() {
  const configErrors = validateAll(jurisdictions, commonRules, commonGamingRules);
  if (configErrors.length) {
    console.error("✘ Config errors:\n" + configErrors.join("\n"));
    process.exit(1);
  }

  const seed = buildDuckDbStatements();
  const plan = buildPlan();
  const neg = negativeTests();
  const gneg = gamingNegativeTests();
  const ppneg = playerProtectionNegativeTests();
  const eneg = extensionNegativeTests();
  const ojneg = operatorJackpotBlockTest();
  const llneg = lossLimitContributionTest();
  const woneg = walletOverspendTest();
  const fineg = faultIsolationNegativeTests();
  const slneg = stakeLimitNegativeTests();

  if (process.argv.includes("--dry-run")) {
    console.log(`DRY RUN (dialect: duckdb)\n`);
    console.log(`-- ${seed.length} seed statements --`);
    for (const s of seed) console.log("  " + s.split("\n")[0]);
    console.log(`\n-- ${plan.length} pipeline steps --`);
    for (const s of plan) console.log(`  [${s.kind}] ${s.name}`);
    console.log(`\n-- ${expectations.length} expectations, ${neg.checks.length + gneg.checks.length + ppneg.checks.length + eneg.checks.length + ojneg.checks.length + llneg.checks.length + woneg.checks.length + fineg.checks.length + slneg.checks.length} negative tests --`);
    console.log("\n✔ Plan built cleanly. Run without --dry-run to execute in DuckDB.");
    return;
  }

  let duckdb;
  try {
    duckdb = require("@duckdb/node-api");
  } catch {
    console.error(
      "\n✘ @duckdb/node-api is not installed.\n" +
      "  Run:  npm install\n" +
      "  (or:  npm install --save-dev @duckdb/node-api)\n" +
      "  Offline plan check works without it:  node local/run.js --dry-run\n"
    );
    process.exit(1);
  }

  const instance = await duckdb.DuckDBInstance.create(":memory:");
  const db = await instance.connect();
  const run = async (sql) => (await db.runAndReadAll(sql)).getRowObjects();

  for (const s of seed) await run(s);
  console.log(`✔ Seed loaded (${seed.length} statements)`);

  let failures = 0;

  for (const step of plan) {
    if (step.kind === "model") {
      await run(step.sql);
    } else {
      const rows = await run(step.sql);
      if (rows.length > 0) {
        failures++;
        console.error(`✘ ${step.name} — ${rows.length} violation(s): ${JSON.stringify(rows[0])}`);
      }
    }
  }
  console.log(`✔ Pipeline built (${plan.filter((s) => s.kind === "model").length} models), ` +
    `rule assertions: ${plan.filter((s) => s.kind === "assertion").length - failures} clean`);

  for (const e of expectations) {
    const rows = await run(e.sql);
    const actual = JSON.stringify(rows);
    const expected = JSON.stringify(e.expect);
    if (actual === expected) {
      console.log(`✔ ${e.desc}`);
    } else {
      failures++;
      console.error(`✘ ${e.desc}\n    expected ${expected}\n    actual   ${actual}`);
    }
  }

  for (const s of [...neg.setup, ...gneg.setup, ...ppneg.setup, ...eneg.setup, ...ojneg.setup, ...llneg.setup, ...woneg.setup, ...fineg.setup, ...slneg.setup]) await run(s);
  for (const check of [...neg.checks, ...gneg.checks, ...ppneg.checks, ...eneg.checks, ...ojneg.checks, ...llneg.checks, ...woneg.checks, ...fineg.checks, ...slneg.checks]) {
    const rows = await run(check.sql);
    if (rows.length === check.expectViolations) {
      console.log(`✔ negative test: ${check.rule} caught the corruption`);
    } else {
      failures++;
      console.error(`✘ negative test: ${check.rule} expected ${check.expectViolations} violation(s), got ${rows.length}`);
    }
  }

  console.log(failures === 0
    ? "\n✔ OFFLINE PIPELINE GREEN — safe to develop against"
    : `\n✘ ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

// buildPlan is reused by local/emit-sql.js, which writes every generated
// statement to the transient repo-root dataform-sql/ folder so SQL
// developers can read the pipeline in their own terms.
module.exports = { buildPlan };
