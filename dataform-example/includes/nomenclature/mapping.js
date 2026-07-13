// ============================================================================
// MAPPING UTILITIES
//
// normalise (JS) and normaliseSql (SQL) are TWINS and must stay equivalent:
// aliases are normalised in JS at compile time; upstream values are
// normalised in SQL at query time; a match requires both sides to agree.
// Keep the transformation minimal and change both together (see
// test/nomenclature.test.js for the contract).
// ============================================================================

// lowercase, trim, collapse whitespace, strip diacritics, drop . and ,
function normalise(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Delegates to the dialect layer so local DuckDB runs match production.
function normaliseSql(expr) {
  return require("../dialect").normaliseText(expr);
}

// Publish an in-repo data array as a BigQuery table body (UNION ALL of
// SELECTs). Keeps mappings in Git — every change is a reviewable diff.
function rowsToSelect(rows, columns) {
  const lit = (v) =>
    v === null || v === undefined ? "CAST(NULL AS STRING)" : `'${String(v).replace(/'/g, "\\'")}'`;
  return rows
    .map((r) => `SELECT ${columns.map((c) => `${lit(r[c])} AS ${c}`).join(", ")}`)
    .join("\nUNION ALL\n");
}

// Render an event-name template like "{home} v {away}" into a SQL CONCAT.
// Only {home} and {away} tokens are supported — validated at config time.
function renderEventName(template) {
  const parts = template.split(/(\{home\}|\{away\})/).filter((p) => p !== "");
  const exprs = parts.map((p) => {
    if (p === "{home}") return "f.home_name";
    if (p === "{away}") return "f.away_name";
    return `'${p.replace(/'/g, "\\'")}'`;
  });
  return exprs.length === 1 ? exprs[0] : `CONCAT(${exprs.join(", ")})`;
}

function templateTokensValid(template) {
  const tokens = template.match(/\{[^}]*\}/g) || [];
  return tokens.every((t) => t === "{home}" || t === "{away}");
}

module.exports = { normalise, normaliseSql, rowsToSelect, renderEventName, templateTokensValid };
