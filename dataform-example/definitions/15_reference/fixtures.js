// Dataform wiring only — SQL lives in includes/models.js.
const m = require("includes/models");

publish("dim_fixture", {
  type: "table", schema: "core", tags: ["reference"],
  description: "Canonicalised fixture: sport via alias map (NULL = unmapped); participant names canonicalised with graceful fallback to raw.",
  bigquery: { clusterBy: ["canonical_sport"] },
  assertions: { uniqueKey: ["fixture_id"] },
}).query((ctx) => m.dimFixture(ctx));

publish("unmapped_sports", {
  type: "view", schema: "reference", tags: ["reference", "unmapped_queue"],
  description: "THE MAINTENANCE LOOP. Distinct upstream sport names with no alias, ranked by betting impact. Resolving a row = one line in includes/nomenclature/aliases.js. Empty view = full coverage.",
}).query((ctx) => m.unmappedSports(ctx));
