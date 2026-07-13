// ============================================================================
// FAULT ISOLATION, DATA READINESS & THE EXCEPTION FLOW
//
// The rule engine (includes/rules.js) proves CORRECTNESS: the data present is
// valid. This module adds the two things a differential-speed, cross-domain
// reporting pipeline also needs:
//
//   1. FAULT ISOLATION (quarantine-first): a failure affects only its own
//      row/entity — everyone else's report still ships. Nothing hard-aborts
//      the whole run. A failing entity is ROUTED by *why* it failed:
//        - DATA        (bad postcode)            -> QUARANTINED  (no retry)
//        - TRANSIENT   (reference/feed lag)      -> RETRYING with backoff,
//                                                   then escalated to QUARANTINED
//        - COMPLETENESS(period not closed yet)   -> WAITING_DATA
//        - COMPLIANCE  (a breach detector fired) -> HELD (per-entity)
//      A held/quarantined/incomplete entity is excluded from its submission;
//      the exception is surfaced (fct_exceptions) for triage & reprocessing.
//
//   2. COMPLETENESS / DATA READINESS: report fields draw on domains that move
//      at different speeds. A period is only submittable once every upstream
//      domain is COMPLETE THROUGH the period close (source watermarks). The
//      crux — telling "not arrived yet" (TRANSIENT/COMPLETENESS, wait/retry)
//      from "legitimately does not exist" (ship the correct empty value) — is
//      resolved by terminal STATE, never by row-absence: an OPEN slip has no
//      settlement *by state*, so it is correctly absent, not held.
//
// The one hard structural gate that remains: no held/quarantined/incomplete
// entity may ever appear in a submission (checked in local/run.js).
// ============================================================================

const dialect = require("./dialect");
const { jurisdictions } = require("./jurisdictions");

const MAX_ATTEMPTS = 5;       // transient retries before escalation to quarantine
const BACKOFF_BASE_MIN = 15;  // exponential backoff base: 15 * 2^(attempt-1) minutes

// backoff minutes for a given attempt number (also used by tests)
function backoffMinutes(attempt) {
  return BACKOFF_BASE_MIN * Math.pow(2, attempt - 1);
}

// ---- staging ----
function stgAccountAddresses(ctx) {
  return `
    SELECT account_id, postcode, city
    FROM ${ctx.ref("cdc_account_addresses")}
    QUALIFY ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY _commit_ts DESC) = 1
      AND _op != 'D'
  `;
}

// per-market postcode format (variance as DATA) as a CASE over jurisdiction
function postcodeValidExpr(jurisAlias, postcodeExpr) {
  const arms = Object.values(jurisdictions)
    .filter((j) => j.addressValidation)
    .map((j) => `WHEN '${j.code}' THEN ${dialect.regexpContains(postcodeExpr, j.addressValidation.postcodePattern)}`)
    .join(" ");
  return `CASE ${jurisAlias} ${arms} ELSE TRUE END`;
}

function requireRegionExpr(jurisAlias) {
  const arms = Object.values(jurisdictions)
    .filter((j) => j.addressValidation)
    .map((j) => `WHEN '${j.code}' THEN ${j.addressValidation.requireRegion ? "TRUE" : "FALSE"}`)
    .join(" ");
  return `CASE ${jurisAlias} ${arms} ELSE FALSE END`;
}

// ---- row-level validation: tag each address, don't filter-to-violations ----
// fail_reason NULL = valid. Precedence: format (DATA) before region (TRANSIENT).
function dimAccountAddressValidated(ctx) {
  return `
    WITH base AS (
      SELECT
        ad.account_id, a.jurisdiction, ad.postcode, r.region_name,
        (${postcodeValidExpr("a.jurisdiction", "ad.postcode")}) AS postcode_valid,
        (${requireRegionExpr("a.jurisdiction")}) AS require_region
      FROM ${ctx.ref("stg_account_addresses")} ad
      JOIN ${ctx.ref("dim_customer_account")} a ON ad.account_id = a.account_id
      LEFT JOIN ${ctx.ref("cdc_postcode_regions")} r ON ad.postcode LIKE r.postcode_prefix || ' %'
    )
    SELECT
      account_id, jurisdiction, postcode, region_name, postcode_valid,
      CASE WHEN NOT postcode_valid THEN 'postcode_format'
           WHEN require_region AND region_name IS NULL THEN 'region_not_found'
           ELSE NULL END AS fail_reason,
      CASE WHEN NOT postcode_valid THEN 'DATA'
           WHEN require_region AND region_name IS NULL THEN 'TRANSIENT'
           ELSE NULL END AS error_class
    FROM base
  `;
}

// ---- differential-speed completeness: which (market, period) are closed? ----
// (account_id, jurisdiction, report_date) for every terminal slip — the same
// grain the submission reports on.
function terminalSlipPeriods(ctx) {
  return Object.values(jurisdictions).map((j) => {
    const rd = dialect.localDate("COALESCE(b.settled_at, b.voided_at)", j.timezone);
    return `
      SELECT b.account_id, '${j.code}' AS jurisdiction, ${rd} AS report_date
      FROM ${ctx.ref("fct_bet_slip_lifecycle")} b
      JOIN ${ctx.ref("dim_customer_account")} a ON b.account_id = a.account_id
      WHERE a.jurisdiction = '${j.code}' AND b.slip_status IN ('SETTLED', 'VOIDED')`;
  }).join("\n    UNION ALL\n");
}

// A period is READY iff the settlement feed watermark for that market is
// complete through a local date strictly after the period date (the day is
// closed). No watermark -> NOT ready (fail-closed).
function rgPeriodReadiness(ctx) {
  return Object.values(jurisdictions).map((j) => {
    const rd = dialect.localDate("COALESCE(b.settled_at, b.voided_at)", j.timezone);
    const wm = dialect.localDate("w.complete_through", j.timezone);
    return `
      SELECT DISTINCT '${j.code}' AS jurisdiction, ${rd} AS report_date,
        COALESCE(${wm} > ${rd}, FALSE) AS is_ready
      FROM ${ctx.ref("fct_bet_slip_lifecycle")} b
      JOIN ${ctx.ref("dim_customer_account")} a ON b.account_id = a.account_id
      LEFT JOIN ${ctx.ref("cdc_source_watermarks")} w
        ON w.source = 'bet_settlement' AND w.jurisdiction = '${j.code}'
      WHERE a.jurisdiction = '${j.code}' AND b.slip_status IN ('SETTLED', 'VOIDED')`;
  }).join("\n    UNION ALL\n");
}

// ---- retry state machine (bookkeeping) ----
// Given the persisted state (cdc_exception_state) and THIS run's transient
// failures, compute the next state. Retries only advance once now >= the
// scheduled next_retry_at; exceeding MAX_ATTEMPTS escalates to QUARANTINED;
// a prior failure that no longer reproduces is RESOLVED (re-admitted).
// nowExpr is supplied by the caller (a fixed instant offline for determinism;
// CURRENT_TIMESTAMP() in Dataform).
function opsExceptionStateNext(ctx, nowExpr) {
  const ts = dialect.tsType();
  return `
    WITH cur AS (
      SELECT account_id AS entity_id, 'ADDRESS' AS entity_type, fail_reason AS reason_code
      FROM ${ctx.ref("dim_account_address_validated")}
      WHERE error_class = 'TRANSIENT'
    ),
    prev AS ( SELECT * FROM ${ctx.ref("cdc_exception_state")} ),
    stepped AS (
      SELECT
        c.entity_type, c.entity_id, c.reason_code, 'TRANSIENT' AS error_class,
        COALESCE(p.attempt_count, 0)
          + CASE WHEN p.entity_id IS NULL OR ${nowExpr} >= p.next_retry_at THEN 1 ELSE 0 END AS attempt_count,
        COALESCE(p.first_seen, ${nowExpr}) AS first_seen
      FROM cur c
      LEFT JOIN prev p ON p.entity_id = c.entity_id AND p.reason_code = c.reason_code
    )
    SELECT
      entity_type, entity_id, reason_code, error_class, attempt_count, first_seen,
      CASE WHEN attempt_count > ${MAX_ATTEMPTS} THEN CAST(NULL AS ${ts})
           ELSE ${dialect.addMinutes(nowExpr, `${BACKOFF_BASE_MIN} * POWER(2, attempt_count - 1)`)} END AS next_retry_at,
      CASE WHEN attempt_count > ${MAX_ATTEMPTS} THEN 'QUARANTINED' ELSE 'RETRYING' END AS status
    FROM stepped
    UNION ALL
    -- prior transient failures that no longer reproduce: the late data arrived.
    SELECT p.entity_type, p.entity_id, p.reason_code, p.error_class, p.attempt_count,
           p.first_seen, CAST(NULL AS ${ts}) AS next_retry_at, 'RESOLVED' AS status
    FROM prev p
    WHERE NOT EXISTS (
      SELECT 1 FROM cur c WHERE c.entity_id = p.entity_id AND c.reason_code = p.reason_code
    )
  `;
}

// ---- the exception store (dead-letter) — one row per held/quarantined entity ----
function fctExceptions(ctx, nowExpr) {
  const ts = dialect.tsType();
  return `
    WITH next_state AS ( ${opsExceptionStateNext(ctx, nowExpr)} )
    -- DATA: bad postcode -> straight to QUARANTINED (retrying can't help)
    SELECT 'ACCOUNT' AS block_scope, 'ADDRESS' AS entity_type, account_id AS entity_id,
           account_id, CAST(NULL AS DATE) AS report_date, 'postcode_format' AS reason_code,
           'DATA' AS error_class, 'ERROR' AS severity, 'QUARANTINED' AS status,
           CAST(NULL AS INTEGER) AS attempt_count, CAST(NULL AS ${ts}) AS next_retry_at,
           'Postcode does not match the market format' AS detail
    FROM ${ctx.ref("dim_account_address_validated")} WHERE error_class = 'DATA'
    UNION ALL
    -- TRANSIENT: reference-data lag -> RETRYING, or escalated to QUARANTINED
    SELECT 'ACCOUNT', 'ADDRESS', ns.entity_id, ns.entity_id, CAST(NULL AS DATE), ns.reason_code,
           'TRANSIENT', 'WARNING', ns.status, ns.attempt_count, ns.next_retry_at,
           'Region reference not found — likely reference-data lag'
    FROM next_state ns WHERE ns.status IN ('RETRYING', 'QUARANTINED')
    UNION ALL
    -- COMPLETENESS: the period is not closed for a domain the report needs
    SELECT 'PERIOD', 'PERIOD', t.account_id, t.account_id, t.report_date, 'period_not_complete',
           'COMPLETENESS', 'WARNING', 'WAITING_DATA', CAST(NULL AS INTEGER), CAST(NULL AS ${ts}),
           'Upstream domain not complete through the period close'
    FROM ( ${terminalSlipPeriods(ctx)} ) t
    JOIN ${ctx.ref("rg_period_readiness")} pr
      ON pr.jurisdiction = t.jurisdiction AND pr.report_date = t.report_date
    WHERE pr.is_ready = FALSE
    UNION ALL
    -- COMPLIANCE: any breach detector row -> per-entity HOLD (no longer aborts)
    SELECT 'ACCOUNT', 'COMPLIANCE', b.account_id, b.account_id, CAST(NULL AS DATE), b.breach,
           'COMPLIANCE', 'CRITICAL', 'HELD', CAST(NULL AS INTEGER), CAST(NULL AS ${ts}),
           'Compliance breach — entity withheld from submission and escalated'
    FROM (
      SELECT DISTINCT account_id, 'deposit_limit' AS breach FROM ${ctx.ref("rg_breach_deposit_limits")}
      UNION ALL SELECT DISTINCT account_id, 'loss_limit' FROM ${ctx.ref("rg_breach_loss_limits")}
      UNION ALL SELECT DISTINCT account_id, 'wallet_overspend' FROM ${ctx.ref("rg_breach_wallet_overspend")}
      UNION ALL SELECT DISTINCT account_id, 'activity_while_excluded' FROM ${ctx.ref("rg_breach_activity_while_excluded")}
      UNION ALL SELECT DISTINCT account_id, 'unverified_withdrawal' FROM ${ctx.ref("rg_breach_unverified_withdrawals")}
      -- REQ: requirements/max-stake-limits (REQ-MSL-5) — a stake over the
      -- effective cap holds the player like any other compliance breach.
      UNION ALL SELECT DISTINCT account_id, 'stake_limit' FROM ${ctx.ref("rg_breach_stake_limits")}
    ) b
  `;
}

// ---- admissibility: the filter every submission/tax query applies ----
// A slip is admissible iff its account has no blocking ACCOUNT-scope exception
// AND its (market, period) is ready (complete). Legitimately-absent rows (an
// OPEN slip) never reach here — they're filtered by slip_status upstream — so
// "absent because it doesn't exist" is never confused with "held".
function admissibilityFilter(ctx, j) {
  const { reportDateExpr } = require("./filters");
  return `b.account_id NOT IN (
        SELECT entity_id FROM ${ctx.ref("fct_exceptions")}
        WHERE block_scope = 'ACCOUNT' AND status IN ('QUARANTINED', 'RETRYING', 'HELD')
      )
      AND ${reportDateExpr(j)} IN (
        SELECT report_date FROM ${ctx.ref("rg_period_readiness")}
        WHERE jurisdiction = '${j.code}' AND is_ready
      )`;
}

// Structural safety assertion: no blocked entity may appear in a submission.
// Returns rows (=violations) if isolation ever leaks — the one hard gate.
function blockedInSubmissionQuery(ctx, j) {
  const mkt = j.code.toLowerCase();
  return `
    SELECT sub.slip_id, b.account_id
    FROM ${ctx.ref(`submission_ready_${mkt}`)} sub
    JOIN ${ctx.ref("fct_bet_slip_lifecycle")} b ON sub.slip_id = b.slip_id
    WHERE b.account_id IN (
      SELECT entity_id FROM ${ctx.ref("fct_exceptions")}
      WHERE status IN ('QUARANTINED', 'RETRYING', 'HELD', 'WAITING_DATA')
    )
  `;
}

module.exports = {
  MAX_ATTEMPTS, BACKOFF_BASE_MIN, backoffMinutes,
  stgAccountAddresses, dimAccountAddressValidated,
  terminalSlipPeriods, rgPeriodReadiness,
  opsExceptionStateNext, fctExceptions,
  admissibilityFilter, blockedInSubmissionQuery,
};
