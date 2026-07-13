// ============================================================================
// PLAYER PROTECTION & PAYMENTS DOMAIN
//
// Real regulatory grounding (verified July 2026):
//   - Spain: RD 1614/2011 Art. 36 mandates daily/weekly/monthly deposit
//     limits per participant; DEFAULTS €600/day, €1,500/week, €3,000/month.
//     The RGIAJ (Registro General de Interdicciones de Acceso al Juego) is
//     the NATIONAL self-exclusion register — once a player registers, every
//     licensed operator is legally required to block them.
//   - Malta: no statutory default deposit limits (player-set only, MGA
//     player-protection directives); self-exclusion is operator-level.
//   - Both (and effectively everywhere): withdrawals must not complete for
//     unverified players (KYC / AML).
//
// The three breach models are the compliance crown jewels — each selects
// rows that constitute a REGULATORY BREACH, so all must always be empty.
// They run as assertions in Dataform and in the offline harness, where
// negative tests corrupt data on purpose to prove detection works.
// ============================================================================

const dialect = require("./dialect");
const { jurisdictions } = require("./jurisdictions");

// ---- staging: dedupe CDC ----

function stgPlayerLimits(ctx) {
  return `
    SELECT limit_id, account_id, limit_type, amount, set_at, revoked_at
    FROM ${ctx.ref("cdc_player_limits")}
    QUALIFY ROW_NUMBER() OVER (PARTITION BY limit_id ORDER BY _commit_ts DESC) = 1
      AND _op != 'D'
  `;
}

function stgSelfExclusions(ctx) {
  return `
    SELECT exclusion_id, account_id, source, start_ts, end_ts
    FROM ${ctx.ref("cdc_self_exclusions")}
    QUALIFY ROW_NUMBER() OVER (PARTITION BY exclusion_id ORDER BY _commit_ts DESC) = 1
      AND _op != 'D'
  `;
}

function stgVerifications(ctx) {
  return `
    SELECT verification_id, account_id, check_type, status, event_ts
    FROM ${ctx.ref("cdc_verifications")}
    QUALIFY ROW_NUMBER() OVER (PARTITION BY verification_id ORDER BY _commit_ts DESC) = 1
      AND _op != 'D'
  `;
}

function stgPayments(ctx) {
  return `
    SELECT payment_id, account_id, direction, amount, method, status, requested_ts, completed_ts
    FROM ${ctx.ref("cdc_payments")}
    WHERE direction IN ('DEPOSIT', 'WITHDRAWAL')
    QUALIFY ROW_NUMBER() OVER (PARTITION BY payment_id ORDER BY _commit_ts DESC) = 1
      AND _op != 'D'
  `;
}

// ---- core ----

// All payment states kept; breach checks and totals filter to COMPLETED.
function fctPayments(ctx) {
  return `
    SELECT p.payment_id, p.account_id, a.jurisdiction, p.direction, p.amount,
           p.method, p.status, p.requested_ts, p.completed_ts
    FROM ${ctx.ref("stg_payments")} p
    JOIN ${ctx.ref("dim_customer_account")} a ON p.account_id = a.account_id
  `;
}

// Unified player gambling spend: one row per settled bet AND per gaming
// activity (casino/poker/OPERATOR_JACKPOT contributions & wins), so loss /
// affordability monitoring sees ALL wagering on one grain. Voided bets are
// refunded, so they are excluded. This is what makes an operator-jackpot
// contribution — a gaming wager — count toward a player's loss limit.
function fctPlayerGamblingActivity(ctx) {
  return `
    SELECT a.account_id, a.jurisdiction, b.settled_at AS occurred_at,
           b.stake, b.payout, 'BET' AS source
    FROM ${ctx.ref("fct_bet_slip_lifecycle")} b
    JOIN ${ctx.ref("dim_customer_account")} a ON b.account_id = a.account_id
    WHERE b.slip_status = 'SETTLED'
    UNION ALL
    SELECT a.account_id, a.jurisdiction, g.occurred_at,
           g.stake, g.payout, g.vertical AS source
    FROM ${ctx.ref("fct_gaming_activity")} g
    JOIN ${ctx.ref("dim_customer_account")} a ON g.account_id = a.account_id
  `;
}

// Unified wallet ledger: every money movement across payments, betting and
// gaming as a signed amount on ONE balance. An operator-jackpot contribution
// is a JACKPOT_CONTRIBUTION debit here — sourced from fct_gaming_activity, so
// a refunded/voided contribution never hits the wallet (it round-trips to
// zero). This is the money-movement view that complements the GGR/activity
// view, and it reconciles against the operator pool.
function fctWalletLedger(ctx) {
  return `
    SELECT account_id, completed_ts AS ts, 'DEPOSIT' AS entry_type, amount AS signed_amount
    FROM ${ctx.ref("fct_payments")} WHERE direction = 'DEPOSIT' AND status = 'COMPLETED'
    UNION ALL
    SELECT account_id, completed_ts, 'WITHDRAWAL', -amount
    FROM ${ctx.ref("fct_payments")} WHERE direction = 'WITHDRAWAL' AND status = 'COMPLETED'
    UNION ALL
    SELECT account_id, placed_at, 'BET_STAKE', -stake
    FROM ${ctx.ref("fct_bet_slip_lifecycle")} WHERE slip_status != 'VOIDED'
    UNION ALL
    SELECT account_id, settled_at, 'BET_PAYOUT', payout
    FROM ${ctx.ref("fct_bet_slip_lifecycle")} WHERE slip_status = 'SETTLED' AND payout > 0
    UNION ALL
    SELECT account_id, occurred_at,
           CASE WHEN vertical = 'OPERATOR_JACKPOT' THEN 'JACKPOT_CONTRIBUTION' ELSE 'GAMING_STAKE' END,
           -stake
    FROM ${ctx.ref("fct_gaming_activity")} WHERE stake > 0
    UNION ALL
    SELECT account_id, occurred_at,
           CASE WHEN vertical = 'OPERATOR_JACKPOT' THEN 'JACKPOT_WIN' ELSE 'GAMING_PAYOUT' END,
           payout
    FROM ${ctx.ref("fct_gaming_activity")} WHERE payout > 0
    UNION ALL
    -- provider progressive jackpot wins are paid to the player wallet too
    SELECT account_id, win_ts, 'PROVIDER_JACKPOT_WIN', amount
    FROM ${ctx.ref("cdc_jackpot_wins")}
  `;
}

// SUFFICIENT-BALANCE SPEND GATE: a player can never spend money they don't
// have. Ordering the wallet ledger by time (credits before debits at a tie),
// the running balance must never go negative — a negative running balance is
// a spend the wallet couldn't cover, i.e. a control failure. Any row is a
// breach; runs as a pipeline-blocking assertion.
function rgBreachWalletOverspend(ctx) {
  return `
    SELECT account_id, ts, entry_type, signed_amount, running_balance
    FROM (
      SELECT account_id, ts, entry_type, signed_amount,
             SUM(signed_amount) OVER (
               PARTITION BY account_id ORDER BY ts ASC, signed_amount DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS running_balance
      FROM ${ctx.ref("fct_wallet_ledger")}
    ) w
    WHERE running_balance < 0
  `;
}

// Current unified balance per player = sum of every wallet movement. (The
// illustrative seed models activity, not fully-funded wallets, so balances
// are informational — a real system would gate spend on a non-negative
// balance and reconcile deposits against wagers here.)
function dimWalletBalance(ctx) {
  return `
    SELECT l.account_id, a.jurisdiction, ROUND(SUM(l.signed_amount), 2) AS balance
    FROM ${ctx.ref("fct_wallet_ledger")} l
    JOIN ${ctx.ref("dim_customer_account")} a ON l.account_id = a.account_id
    GROUP BY l.account_id, a.jurisdiction
  `;
}

// Current compliance status per player: latest identity-verification
// state, open (indefinite) exclusions, active personal deposit limits.
function dimPlayerCompliance(ctx) {
  return `
    WITH latest_verification AS (
      SELECT account_id, status AS verification_status, event_ts AS verification_ts
      FROM ${ctx.ref("stg_verifications")}
      WHERE check_type = 'IDENTITY'
      QUALIFY ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY event_ts DESC) = 1
    ),
    open_exclusions AS (
      SELECT account_id, MIN(source) AS open_exclusion_source
      FROM ${ctx.ref("stg_self_exclusions")}
      WHERE end_ts IS NULL
      GROUP BY account_id
    ),
    active_limits AS (
      SELECT account_id,
             MAX(IF(limit_type = 'DEPOSIT_DAILY',  amount, NULL)) AS personal_daily_limit,
             MAX(IF(limit_type = 'DEPOSIT_WEEKLY', amount, NULL)) AS personal_weekly_limit,
             MAX(IF(limit_type = 'DEPOSIT_MONTHLY',amount, NULL)) AS personal_monthly_limit
      FROM ${ctx.ref("stg_player_limits")}
      WHERE revoked_at IS NULL
      GROUP BY account_id
    )
    SELECT
      a.account_id,
      a.jurisdiction,
      COALESCE(v.verification_status, 'UNVERIFIED') AS verification_status,
      v.verification_ts,
      x.open_exclusion_source,
      l.personal_daily_limit,
      l.personal_weekly_limit,
      l.personal_monthly_limit
    FROM ${ctx.ref("dim_customer_account")} a
    LEFT JOIN latest_verification v ON v.account_id = a.account_id
    LEFT JOIN open_exclusions x ON x.account_id = a.account_id
    LEFT JOIN active_limits l ON l.account_id = a.account_id
  `;
}

// NULL-safe minimum: BigQuery LEAST returns NULL if any arg is NULL,
// DuckDB ignores NULLs — so spell it out explicitly for both engines.
function nullSafeLeast(a, b) {
  return `CASE WHEN ${a} IS NULL THEN ${b} WHEN ${b} IS NULL THEN ${a} ELSE LEAST(${a}, ${b}) END`;
}

// Statutory defaults per market from config, as a CASE over jurisdiction.
// A period may be null for a market (Germany's LUGAS default is
// MONTHLY-only), in which case that market simply has no arm for it.
function defaultLimitExpr(period) {
  const key = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly" }[period];
  const arms = Object.values(jurisdictions)
    .filter((j) => j.playerProtection && j.playerProtection.defaultDepositLimits
      && j.playerProtection.defaultDepositLimits[key] != null)
    .map((j) => `WHEN '${j.code}' THEN ${j.playerProtection.defaultDepositLimits[key]}`)
    .join(" ");
  return arms ? `CASE c.jurisdiction ${arms} ELSE NULL END` : `CAST(NULL AS DECIMAL(12,2))`;
}

// Effective deposit limit per account per period:
//   effective = null-safe MIN(personal active limit, statutory default)
// NULL effective = no cap applies (e.g. MT player with no personal limit).
function rgEffectiveDepositLimits(ctx) {
  const rows = ["DAILY", "WEEKLY", "MONTHLY"].map((period) => {
    const personal = `c.personal_${period.toLowerCase()}_limit`;
    return `
    SELECT
      c.account_id,
      c.jurisdiction,
      '${period}' AS period,
      ${personal} AS personal_limit,
      ${defaultLimitExpr(period)} AS default_limit,
      ${nullSafeLeast(personal, defaultLimitExpr(period))} AS effective_limit
    FROM ${ctx.ref("dim_player_compliance")} c`;
  });
  return rows.join("\n    UNION ALL\n");
}

// BREACH 1 — deposits over the effective limit in any window.
// Windows are the MARKET-LOCAL calendar day / ISO week / month.
function rgBreachDepositLimits(ctx) {
  const branches = Object.values(jurisdictions)
    .filter((j) => j.playerProtection)
    .map((j) => {
      const localDay = dialect.localDate("p.completed_ts", j.timezone);
      return `
    SELECT * FROM (
      SELECT
        w.account_id,
        '${j.code}' AS jurisdiction,
        w.period,
        w.window_start,
        w.deposited,
        l.effective_limit
      FROM (
        SELECT account_id, period, window_start, SUM(amount) AS deposited
        FROM (
          SELECT p.account_id, 'DAILY' AS period, ${localDay} AS window_start, p.amount
          FROM ${ctx.ref("fct_payments")} p
          WHERE p.jurisdiction = '${j.code}' AND p.direction = 'DEPOSIT' AND p.status = 'COMPLETED'
          UNION ALL
          SELECT p.account_id, 'WEEKLY', ${dialect.dateTrunc("WEEK", localDay)}, p.amount
          FROM ${ctx.ref("fct_payments")} p
          WHERE p.jurisdiction = '${j.code}' AND p.direction = 'DEPOSIT' AND p.status = 'COMPLETED'
          UNION ALL
          SELECT p.account_id, 'MONTHLY', ${dialect.dateTrunc("MONTH", localDay)}, p.amount
          FROM ${ctx.ref("fct_payments")} p
          WHERE p.jurisdiction = '${j.code}' AND p.direction = 'DEPOSIT' AND p.status = 'COMPLETED'
        ) d
        GROUP BY account_id, period, window_start
      ) w
      JOIN ${ctx.ref("rg_effective_deposit_limits")} l
        ON l.account_id = w.account_id AND l.period = w.period
      WHERE l.effective_limit IS NOT NULL
        AND w.deposited > l.effective_limit
    )`;
    });
  return branches.join("\n    UNION ALL\n");
}

// BREACH 4 — net loss over the effective LOSS limit in any market-local
// window. Net loss = staked - won across bets AND gaming (via
// fct_player_gambling_activity), so an operator-jackpot contribution — a
// gaming wager on the phantom game — counts toward the loss limit exactly
// like any other stake. (Deposit limits stay deposit-only; contributions
// are spend, not deposits, so they belong here.) Statutory loss defaults
// would slot in like the deposit ones; here limits are player-set.
function rgBreachLossLimits(ctx) {
  const branches = Object.values(jurisdictions)
    .filter((j) => j.playerProtection)
    .map((j) => {
      const localDay = dialect.localDate("act.occurred_at", j.timezone);
      const lossWindow = (period, windowExpr) => `
          SELECT act.account_id, '${period}' AS period, ${windowExpr} AS window_start,
                 (act.stake - act.payout) AS net
          FROM ${ctx.ref("fct_player_gambling_activity")} act
          WHERE act.jurisdiction = '${j.code}'`;
      const activeLossLimit = (period) => `
        SELECT account_id, '${period}' AS period,
               MAX(IF(limit_type = 'LOSS_${period}', amount, NULL)) AS loss_limit
        FROM ${ctx.ref("stg_player_limits")} WHERE revoked_at IS NULL GROUP BY account_id`;
      return `
    SELECT * FROM (
      SELECT
        w.account_id,
        '${j.code}' AS jurisdiction,
        w.period,
        w.window_start,
        w.net_loss,
        l.loss_limit
      FROM (
        SELECT account_id, period, window_start, SUM(net) AS net_loss
        FROM (
          ${lossWindow("DAILY", localDay)}
          UNION ALL
          ${lossWindow("WEEKLY", dialect.dateTrunc("WEEK", localDay))}
          UNION ALL
          ${lossWindow("MONTHLY", dialect.dateTrunc("MONTH", localDay))}
        ) s
        GROUP BY account_id, period, window_start
      ) w
      JOIN (
        ${activeLossLimit("DAILY")}
        UNION ALL
        ${activeLossLimit("WEEKLY")}
        UNION ALL
        ${activeLossLimit("MONTHLY")}
      ) l
        ON l.account_id = w.account_id AND l.period = w.period
      WHERE l.loss_limit IS NOT NULL
        AND w.net_loss > l.loss_limit
    )`;
    });
  return branches.join("\n    UNION ALL\n");
}

// BREACH 2 — ANY activity (deposit, bet placed, gaming round/hand) inside
// a self-exclusion window. For RGIAJ-sourced exclusions this is a breach
// of national law, not merely operator policy.
function rgBreachActivityWhileExcluded(ctx) {
  const during = (ts) =>
    `${ts} >= x.start_ts AND (x.end_ts IS NULL OR ${ts} < x.end_ts)`;
  return `
    SELECT x.account_id, x.source AS exclusion_source, 'DEPOSIT' AS activity_type,
           p.payment_id AS activity_ref, p.completed_ts AS activity_ts
    FROM ${ctx.ref("fct_payments")} p
    JOIN ${ctx.ref("stg_self_exclusions")} x ON x.account_id = p.account_id
    WHERE p.direction = 'DEPOSIT' AND p.status = 'COMPLETED'
      AND ${during("p.completed_ts")}
    UNION ALL
    SELECT x.account_id, x.source, 'BET_PLACED',
           b.slip_id, b.placed_at
    FROM ${ctx.ref("fct_bet_slip_lifecycle")} b
    JOIN ${ctx.ref("stg_self_exclusions")} x ON x.account_id = b.account_id
    WHERE ${during("b.placed_at")}
    UNION ALL
    SELECT x.account_id, x.source, 'GAMING_ACTIVITY',
           g.activity_id, g.occurred_at
    FROM ${ctx.ref("fct_gaming_activity")} g
    JOIN ${ctx.ref("stg_self_exclusions")} x ON x.account_id = g.account_id
    WHERE ${during("g.occurred_at")}
  `;
}

// ============================================================================
// MAX STAKE LIMITS — REQ: requirements/max-stake-limits
//
// Statutory online-slots stake caps (UKGC-modelled: age-banded, effective-
// dated, SLOT games only) live per market in jurisdictions.js as
// playerProtection.slotsStakeLimits (REQ-MSL-1). Players may additionally
// set a personal STAKE_CASINO limit covering ALL casino verticals
// (REQ-MSL-2) — a new limit_type VALUE through the existing machinery.
// The effective cap for a stake = null-safe LEAST(applicable statutory
// bands, personal limit), resolved at the stake's own age/date (REQ-MSL-3).
// ============================================================================

// Fold a market's bands into one expression: the least maxStake whose age
// band AND effective window cover this stake. NULL = no statutory cap.
function statutorySlotsCapExpr(j, ageExpr, dateExpr) {
  const bands = (j.playerProtection && j.playerProtection.slotsStakeLimits) || [];
  if (!bands.length) return "CAST(NULL AS DECIMAL(12,2))";
  const arms = bands.map((b) => {
    const conds = [`${ageExpr} >= ${b.minAge != null ? b.minAge : 18}`];
    if (b.maxAge != null) conds.push(`${ageExpr} <= ${b.maxAge}`);
    if (b.from) conds.push(`${dateExpr} >= DATE '${b.from}'`);
    if (b.to) conds.push(`${dateExpr} < DATE '${b.to}'`);
    return `CASE WHEN ${conds.join(" AND ")} THEN ${b.maxStake.toFixed(2)} END`;
  });
  return arms.reduce((a, b) => nullSafeLeast(a, b));
}

// The regulator-visible reference (REQ-MSL-6): every band in force, flattened
// from config into rows for ref_stake_limits — the same effective-dated shape
// as the regulator code maps, so "what was the cap on date X?" is a query.
function stakeLimitRows() {
  const rows = [];
  for (const j of Object.values(jurisdictions)) {
    for (const b of (j.playerProtection && j.playerProtection.slotsStakeLimits) || []) {
      rows.push({
        jurisdiction: j.code, game_scope: "SLOT", max_stake: b.maxStake.toFixed(2),
        min_age: b.minAge != null ? b.minAge : 18, max_age: b.maxAge != null ? b.maxAge : null,
        valid_from: b.from || null, valid_to: b.to || null,
      });
    }
  }
  return rows;
}

// BREACH 6 — a gaming stake above the effective cap in force AT THE MOMENT
// IT WAS STAKED (REQ-MSL-5): statutory applies to SLOT games only (UKGC
// scope), the personal STAKE_CASINO cap to every casino vertical; age is the
// player's age on the market-local date of the stake, and each band only
// binds once its effective date has passed — so historical stakes are judged
// by the rules of their own day, never today's.
function rgBreachStakeLimits(ctx) {
  const branches = Object.values(jurisdictions)
    .filter((j) => j.playerProtection)
    .map((j) => {
      const localDay = dialect.localDate("g.occurred_at", j.timezone);
      const age = dialect.ageYears("a.date_of_birth", localDay);
      const statutory = `CASE WHEN gm.canonical_game_type = 'SLOT' THEN ${statutorySlotsCapExpr(j, age, localDay)} END`;
      const effective = nullSafeLeast("pl.personal_stake_limit", `(${statutory})`);
      return `
    SELECT g.activity_id, g.account_id, '${j.code}' AS jurisdiction, g.vertical,
           g.stake, ${effective} AS effective_limit, g.occurred_at
    FROM ${ctx.ref("fct_gaming_activity")} g
    JOIN ${ctx.ref("dim_customer_account")} a
      ON g.account_id = a.account_id AND a.jurisdiction = '${j.code}'
    LEFT JOIN ${ctx.ref("dim_game")} gm ON g.game_id = gm.game_id
    LEFT JOIN (
      SELECT account_id, MIN(amount) AS personal_stake_limit
      FROM ${ctx.ref("stg_player_limits")}
      WHERE limit_type = 'STAKE_CASINO' AND revoked_at IS NULL
      GROUP BY account_id
    ) pl ON pl.account_id = g.account_id
    WHERE ${effective} IS NOT NULL AND g.stake > ${effective}`;
    });
  return branches.join("\n    UNION ALL\n");
}

// BREACH 3 — a withdrawal completed for a player who was not identity-
// verified at completion time (KYC/AML: applies in every market here).
function rgBreachUnverifiedWithdrawals(ctx) {
  const markets = Object.values(jurisdictions)
    .filter((j) => j.playerProtection && j.playerProtection.withdrawalRequiresVerification)
    .map((j) => `'${j.code}'`)
    .join(", ");
  return `
    SELECT p.payment_id, p.account_id, p.jurisdiction, p.amount, p.completed_ts
    FROM ${ctx.ref("fct_payments")} p
    WHERE p.direction = 'WITHDRAWAL' AND p.status = 'COMPLETED'
      AND p.jurisdiction IN (${markets})
      AND NOT EXISTS (
        SELECT 1 FROM ${ctx.ref("stg_verifications")} v
        WHERE v.account_id = p.account_id
          AND v.check_type = 'IDENTITY'
          AND v.status = 'VERIFIED'
          AND v.event_ts <= p.completed_ts
      )
  `;
}

module.exports = {
  stgPlayerLimits, stgSelfExclusions, stgVerifications, stgPayments,
  fctPayments, fctPlayerGamblingActivity, fctWalletLedger, dimWalletBalance,
  dimPlayerCompliance,
  rgEffectiveDepositLimits, rgBreachDepositLimits, rgBreachLossLimits,
  rgBreachActivityWhileExcluded, rgBreachUnverifiedWithdrawals,
  rgBreachWalletOverspend,
  statutorySlotsCapExpr, rgBreachStakeLimits, stakeLimitRows,
  nullSafeLeast,
};
