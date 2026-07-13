// Fault isolation, data readiness & the exception flow (quarantine-first).
// SQL lives in includes/exceptions.js — shared with the offline runner. In
// Dataform the retry "now" is CURRENT_TIMESTAMP(); the offline runner passes a
// fixed instant for deterministic tests.
const ex = require("includes/exceptions");
const { jurisdictions } = require("includes/jurisdictions");

const NOW = "CURRENT_TIMESTAMP()";

publish("stg_account_addresses", {
  type: "view", schema: "staging", tags: ["staging", "exceptions"],
  description: "Customer addresses, deduped latest-per-key.",
  assertions: { uniqueKey: ["account_id"] },
}).query((ctx) => ex.stgAccountAddresses(ctx));

publish("dim_account_address_validated", {
  type: "table", schema: "core", tags: ["exceptions"],
  description: "Row-level address validation: postcode format (DATA) and region resolution (TRANSIENT) tagged per market. fail_reason NULL = valid.",
}).query((ctx) => ex.dimAccountAddressValidated(ctx));

publish("rg_period_readiness", {
  type: "table", schema: "compliance", tags: ["exceptions", "readiness"],
  description: "Per (market, period) completeness: is the settlement feed complete through the period close? Differential-speed data readiness gate.",
}).query((ctx) => ex.rgPeriodReadiness(ctx));

publish("ops_exception_state_next", {
  type: "table", schema: "compliance", tags: ["exceptions", "retry"],
  description: "Retry state machine: advances transient retries with exponential backoff, escalates past MAX_ATTEMPTS to QUARANTINED, and RESOLVES failures whose late data has arrived.",
}).query((ctx) => ex.opsExceptionStateNext(ctx, NOW));

publish("fct_exceptions", {
  type: "table", schema: "compliance", tags: ["exceptions"],
  description: "The exception store (dead-letter): one row per held/quarantined/incomplete entity, routed by class (DATA/TRANSIENT/COMPLETENESS/COMPLIANCE). The exception-flow's data source.",
}).query((ctx) => ex.fctExceptions(ctx, NOW));

// The one hard structural gate that remains under quarantine-first: no held /
// quarantined / incomplete entity may ever reach a regulator submission.
for (const j of Object.values(jurisdictions)) {
  assert(`assert_no_blocked_entity_in_${j.code.toLowerCase()}`, (ctx) => ex.blockedInSubmissionQuery(ctx, j))
    .tags(["exceptions", "isolation"])
    .description(`Isolation gate: no quarantined/held/incomplete entity may appear in the ${j.code} submission`);
}
