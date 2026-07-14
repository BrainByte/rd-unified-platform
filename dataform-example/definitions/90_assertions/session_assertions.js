// Rule-driven assertions for SESSION reporting, mirroring the gaming
// pattern: one assertion per declarative session rule per configured
// market. Cross-domain session rule types (activity_within_session,
// single_open_session, single_game_session) check the core session facts
// scoped to the market's players; column rules (end_reason_in_set) target
// the market's session file.
// REQ: requirements/session-tracking (REQ-ST-5)
const { jurisdictions } = require("includes/jurisdictions");
const { marketSessionRules, violationQuery } = require("includes/rules");

for (const j of Object.values(jurisdictions)) {
  if (!j.sessionReporting) continue;
  const mkt = j.code.toLowerCase();

  for (const rule of marketSessionRules(j)) {
    assert(`session_rule_${mkt}_${rule.id.toLowerCase().replace(/-/g, "_")}`, (ctx) =>
      violationQuery(ctx, j, rule, {
        table: `submission_sessions_${mkt}`,
        keyColumn: "session_id",
      })
    )
      .tags(["rules", "sessions", j.code])
      .description(`${rule.id}: ${rule.description}`);
  }
}
