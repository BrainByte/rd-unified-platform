// ============================================================================
// FILTERS — reusable WHERE-clause fragments driven by config.
// The ONLY place void handling and local-date logic exist.
// ============================================================================

function statusFilter(j) {
  return j.includeVoided
    ? `b.slip_status IN ('SETTLED', 'VOIDED')`
    : `b.slip_status = 'SETTLED'`;
}

function jurisdictionFilter(j) {
  return `a.jurisdiction = '${j.code}'`;
}

// Reporting date: local settlement date, or local void date for voids.
function reportDateExpr(j) {
  const dialect = require("./dialect");
  return dialect.localDate("COALESCE(b.settled_at, b.voided_at)", j.timezone);
}

module.exports = { statusFilter, jurisdictionFilter, reportDateExpr };
