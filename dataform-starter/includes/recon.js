// Reconciliation SQL generators.
// Two families:
//   1. Internal recon (permanent): submitted vs settled vs back office.
//   2. Legacy parallel-run diffs (temporary, per market during cutover).
// Every generator writes a normalised "breaks" shape:
//   (jurisdiction, report_date, break_type, break_key, legacy_value, new_value, detail)

// ---------- Level 1: daily totals diff ----------
function legacyTotalsDiff(ctx, j) {
  return `
    WITH legacy AS (
      SELECT report_date,
             COUNT(*) AS row_count,
             ROUND(SUM(stake), ${j.rounding}) AS total_stake,
             ROUND(SUM(payout), ${j.rounding}) AS total_payout
      FROM \`${j.legacySourceTable}\`
      GROUP BY report_date
    ),
    new_pipe AS (
      SELECT report_date,
             COUNT(*) AS row_count,
             ROUND(SUM(stake), ${j.rounding}) AS total_stake,
             ROUND(SUM(payout), ${j.rounding}) AS total_payout
      FROM ${ctx.ref(`submission_ready_${j.code.toLowerCase()}`)}
      GROUP BY report_date
    )
    SELECT
      '${j.code}' AS jurisdiction,
      COALESCE(l.report_date, n.report_date) AS report_date,
      'TOTALS' AS break_type,
      CAST(COALESCE(l.report_date, n.report_date) AS STRING) AS break_key,
      TO_JSON_STRING(STRUCT(l.row_count, l.total_stake, l.total_payout)) AS legacy_value,
      TO_JSON_STRING(STRUCT(n.row_count, n.total_stake, n.total_payout)) AS new_value,
      CASE
        WHEN l.report_date IS NULL THEN 'date only in new pipeline'
        WHEN n.report_date IS NULL THEN 'date only in legacy'
        WHEN l.row_count != n.row_count THEN 'row count mismatch'
        ELSE 'amount mismatch'
      END AS detail
    FROM legacy l
    FULL OUTER JOIN new_pipe n USING (report_date)
    WHERE l.report_date IS NULL OR n.report_date IS NULL
       OR l.row_count != n.row_count
       OR ABS(l.total_stake  - n.total_stake)  > ${j.reconTolerance}
       OR ABS(l.total_payout - n.total_payout) > ${j.reconTolerance}
  `;
}

// ---------- Level 2: row-level anti-joins ----------
function legacyRowDiff(ctx, j) {
  const key = j.reconKey.join(", ");
  const joinCond = j.reconKey.map((k) => `l.${k} = n.${k}`).join(" AND ");
  return `
    WITH legacy AS (SELECT ${key} FROM \`${j.legacySourceTable}\`),
    new_pipe AS (
      SELECT ${key}
      FROM ${ctx.ref(`submission_ready_${j.code.toLowerCase()}`)}
    )
    SELECT '${j.code}' AS jurisdiction, l.report_date,
           'MISSING_IN_NEW' AS break_type,
           CAST(l.bet_id AS STRING) AS break_key,
           'present' AS legacy_value, 'absent' AS new_value,
           NULL AS detail
    FROM legacy l LEFT JOIN new_pipe n ON ${joinCond}
    WHERE n.bet_id IS NULL
    UNION ALL
    SELECT '${j.code}', n.report_date,
           'EXTRA_IN_NEW',
           CAST(n.bet_id AS STRING),
           'absent', 'present', NULL
    FROM new_pipe n LEFT JOIN legacy l ON ${joinCond}
    WHERE l.bet_id IS NULL
  `;
}

// ---------- Level 3: field-level compare on matched rows ----------
function legacyFieldDiff(ctx, j) {
  const joinCond = j.reconKey.map((k) => `l.${k} = n.${k}`).join(" AND ");
  const numericFields = j.reportFields.filter((f) =>
    ["stake", "payout", "ggr"].includes(f)
  );
  const comparisons = numericFields
    .map(
      (f) => `
    SELECT '${j.code}' AS jurisdiction, l.report_date,
           'FIELD_${f.toUpperCase()}' AS break_type,
           CAST(l.bet_id AS STRING) AS break_key,
           CAST(l.${f} AS STRING) AS legacy_value,
           CAST(n.${f} AS STRING) AS new_value,
           NULL AS detail
    FROM \`${j.legacySourceTable}\` l
    JOIN ${ctx.ref(`submission_ready_${j.code.toLowerCase()}`)} n ON ${joinCond}
    WHERE ABS(l.${f} - n.${f}) > ${j.reconTolerance}`
    )
    .join("\n    UNION ALL\n");
  return comparisons;
}

// ---------- Internal recon (permanent, post-cutover) ----------
// submitted (receipts from submission service) vs submission_ready vs back office
function internalRecon(ctx, j) {
  return `
    SELECT
      '${j.code}' AS jurisdiction,
      s.report_date,
      'SUBMITTED_VS_READY' AS break_type,
      CAST(s.report_date AS STRING) AS break_key,
      CAST(r.total_stake AS STRING) AS legacy_value,   -- ready
      CAST(s.total_stake AS STRING) AS new_value,       -- submitted
      s.receipt_id AS detail
    FROM ${ctx.ref("submission_receipts")} s
    JOIN (
      SELECT report_date, ROUND(SUM(stake), ${j.rounding}) AS total_stake
      FROM ${ctx.ref(`submission_ready_${j.code.toLowerCase()}`)}
      GROUP BY report_date
    ) r USING (report_date)
    WHERE s.jurisdiction = '${j.code}'
      AND ABS(s.total_stake - r.total_stake) > ${j.reconTolerance}
  `;
}

module.exports = { legacyTotalsDiff, legacyRowDiff, legacyFieldDiff, internalRecon };
