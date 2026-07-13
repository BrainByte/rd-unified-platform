# The SQL developer skill gap — an honest analysis

*What actually changes for a SQL developer moving from the legacy estate
(hand-crafted stored procedures, triggers, views, functions, SSRS, SQL Agent)
to this architecture — which skills transfer, which need adapting, which are
genuinely new, and which become obsolete. Companion to
[`technology-skills-migration.md`](technology-skills-migration.md) (the
construct-by-construct *translation*); this document is about the *people*.*

---

## 1. The headline, first

The gap is **real but narrower than it looks — and it is not where people
expect it**. The instinctive fear is "I need to become a JavaScript
developer." The actual JavaScript surface is small (template strings, plain
functions, objects — no framework, no async, no browser). The *genuine* gaps
are subtler: working through **git instead of the server**, trusting
**derived state instead of maintained state**, and expressing intent as
**data instead of procedure**. Those are habit changes more than knowledge
changes, and habit changes are the ones that need managed practice, not
courses.

Meanwhile the most valuable thing a legacy SQL developer carries — **the
regulatory domain knowledge and set-based thinking** — transfers at 100% and
is the scarcest ingredient in the whole migration. This architecture needs
*more* of what good SQL developers know, expressed differently.

## 2. Skills inventory

### Transfers directly (no gap)

| Skill | Where it lands here |
|---|---|
| Set-based thinking, joins, aggregation | The entire generated-SQL vocabulary — every model is the SQL they already write |
| Window functions (`ROW_NUMBER`, running sums) | Staging dedupe, wallet running balance, breach detectors |
| Data modelling (facts/dims, grain, keys) | The core layer *is* a dimensional model; grain discipline is load-bearing |
| Debugging by querying the data | The harness DB is right there; `dataform-sql/` gives every statement to run by hand |
| Reconciliation instincts ("compute it two ways") | Financial reconciliation, provider recon, the cash↔settlement bridge |
| **Regulatory domain knowledge** | The single most valuable asset — rules, clauses, market quirks become *config they author* |

### Needs adapting (moderate gap, weeks)

| Legacy skill | The adaptation |
|---|---|
| Manual QA on a restored environment | Expectations + negative tests: same instinct ("what should this produce?"), now written once and run in 4 s |
| Index/hint tuning | Partitioning, clustering, pruning, scan-cost awareness — different levers, same performance mindset |
| MERGE/upsert maintenance | Idempotent rebuilds + `QUALIFY` dedupe over append-only CDC — *simpler* than what they know, but must be trusted |
| T-SQL dialect fluency | Two-dialect awareness — but only at the `dialect.js` boundary; everywhere else the shared subset just works |
| Deployment scripts + change tickets | git branch → `npm run check` → merge; the gate is faster than their old compile |

### Genuinely new (the real gap)

| New skill | Honest size | Mitigation in this repo |
|---|---|---|
| **JavaScript-as-glue** (template literals, functions, objects, `require`) | The largest single item — but it is *string-building* JS, not software engineering. A week of discomfort, not a career change | Every builder is small and pure; `test/` shows the pattern; copy-adapt is safe because the validator and harness catch mistakes |
| **Git workflow** (branch, diff, review, merge) | Moderate — many DBAs have lived on the server, not in version control | The workflow is 5 mechanical steps in `CLAUDE.md`; every change in this repo's history is a worked example |
| **Config-as-data mindset** ("don't write the IF, write the value") | Small to learn, *hard to internalise* — the reflex to branch on market dies slowly | The validator rejects much of it; review + the forbidden-`if (market)` rule does the rest |
| **CDC / immutability mental model** (state is derived, never repaired) | Moderate — "just UPDATE the reporting table" is a deep habit | The wallet and pool are worked examples: nothing to repair, ever |
| **Declarative rules** (constraint as data with a clause id) | Small — it is *less* to know than trigger semantics | 87 live examples, each named for the law it enforces |
| BigQuery/Dataform operational basics | Small day-to-day (the harness hides the cloud); needed by whoever deploys | `ARCHITECTURE.md` §7; `npm run dataform:compile` teaches the artifact set |

### Becomes obsolete (unlearning, not learning)

Cursor patterns and RBAR workarounds; trigger design and trigger-chain
debugging; plan-cache forensics and parameter-sniffing folklore; SSRS report
plumbing; SQL Agent job choreography; the "fix it on the server tonight"
hotfix muscle — the last one being the only obsolete skill people *miss*,
because it felt like power. Its replacement (config change → 4-second gate →
merge) is objectively faster; it just doesn't feel heroic.

## 3. The psychological gap — usually the binding constraint

- **"Where is my SQL?"** The disorientation of not finding hand-owned `.sql`
  files is real and immediate. It is also the easiest gap to close:
  `npm run emit-sql` exists precisely for this — every statement, on disk,
  readable, in both dialects. Developers should live in `dataform-sql/`
  during their first weeks until the generator earns their trust.
- **Loss of mastery.** A 15-year T-SQL expert is, briefly, a novice again.
  The mitigation is honest framing: the SQL mastery still *is* the job — the
  emitted SQL is reviewed with exactly their expertise, and the hardest
  design questions (grain, bridge logic, tax bases) are pure data-engineering
  judgement they already own.
- **Identity: "I'm a DBA, not a developer."** The JS glue triggers this.
  Counter-framing that works: the config file is closer to *filling in a
  regulatory form* than to programming, and the builders are closer to
  *dynamic SQL done safely* (a thing senior T-SQL people already do with
  `sp_executesql`) than to app development.
- **Trust in the harness.** People raised on "test in a prod-sized
  environment" initially distrust a 4-second laptop gate. The negative tests
  are the persuader: watching the pipeline *catch deliberately corrupted
  data* builds trust faster than any argument.

## 4. Failure patterns to watch for (and their tripwires)

| Anti-pattern | Why it happens | What catches it |
|---|---|---|
| Hand-editing files in `dataform-sql/` | Old reflex: fix the SQL where you see it | Files are wiped every run; the header says so; review rejects it |
| `if (market === 'XX')` creeping into a builder | The legacy fork instinct | Non-negotiable rule #1, review, and the fact that config almost always has a cleaner slot |
| Bypassing the harness ("it's a tiny change") | Hotfix muscle memory | `npm run check` is faster than the excuse; CI (once wired) makes it structural |
| Copy-pasting a market block instead of asking what the *variance* is | Fork habit transferred to config | Review question: "which single key actually differs?" |
| Over-engineering the JS (helpers, abstractions, cleverness) | New-toy enthusiasm, usually from the *stronger* programmers | The layer map: builders stay small, pure, boring |

## 5. A realistic learning path (using this repo as the curriculum)

| Stage | Time | Activity | Exit test |
|---|---|---|---|
| Orient | Day 1 | [`README_FIRST.md`](README_FIRST.md) → [`OVERVIEW.md`](OVERVIEW.md) → [`technology-skills-migration.md`](technology-skills-migration.md) | Can say "variance is data, logic is once" and mean it |
| See the SQL | Days 1–2 | `npm run check`, then read `dataform-sql/` side by side with `includes/` | Can trace one submission file back to its builder and config |
| First safe change | Week 1 | Resolve an unmapped alias; change a tax rate; add a `matches` rule — each is a one-line **data** diff gated in 4 s | Green harness, reviewed merge |
| First structural change | Weeks 2–3 | Re-implement a worked scenario without reading its implementation ([max-stake-limits](requirements/max-stake-limits/requirements.md) is the ideal kata), then compare | Their diff vs the repo's diff — the delta *is* the remaining gap |
| Own a market | Month 2 | Onboard a practice market end to end (Germany's commit is the template: config + seed + expectations + docs) | `npm run check` + `dataform:compile` green; docs updated |

Realistic totals for a competent legacy SQL developer: **productive on data
diffs in days; trusted on builder changes in 2–4 weeks; owning market
onboarding in about two months.** The long pole is never JavaScript — it is
the third column of §2's table becoming reflex.

## 6. Who struggles, who thrives

- **Thrives:** the developer whose value was *understanding the domain and
  the data* — they shed the plumbing and keep the judgement. Also the
  quietly rigorous ones: the harness rewards people who always wanted tests.
- **Struggles initially:** the server-side hero whose value was fast manual
  intervention — their skill was real, but it was compensating for the
  architecture this replaces. They need the §3 framing and early wins most.
- **Needs watching:** the strong programmer who treats the includes as an
  application to architect. The discipline here is *restraint*.

## 7. What the organisation should do

1. **Make `dataform-sql/` the security blanket** — teach it first, not last.
2. **First tickets are data diffs** (aliases, rates, rules) — high-frequency,
   low-blast-radius, instantly gated: confidence compounds.
3. **Review for the anti-patterns in §4** explicitly; the rules are short.
4. **Pair the domain expert with the git-fluent** — the gaps are usually
   complementary across a legacy team.
5. **Keep the worked-scenario katas coming** — the `requirements/` pattern
   (spec → overview → implementation → trace) doubles as training material,
   which is exactly why this repo documents changes that way.
6. **Do not hire "JavaScript developers" to bridge the gap** — the scarce
   skill is regulatory data judgement; the JS is teachable in a week.

## 8. Verdict

The skill gap is **asymmetric**: small in knowledge, meaningful in habit.
Nothing a working SQL developer knows about data becomes worthless — the
set-based core, the domain fluency and the reconciliation instincts become
*more* leveraged, because they now apply to seventeen markets at once. What
must be built is a modest tool fluency (JS-as-glue, git) and three new
reflexes (variance is data; state is derived; the gate before the merge).
With this repo as the curriculum, that is a weeks-not-months transition —
and the honest management risk is not capability but *identity*, which is
addressed by giving people early, visible, low-risk wins and by never
pretending their old mastery wasn't real.

---

*Companions: [`technology-skills-migration.md`](technology-skills-migration.md)
(the construct translation this analysis builds on) ·
[`performance-analysis.md`](performance-analysis.md) (why the architecture is
worth the transition) · [`dataform-sql/`](dataform-sql/README.md) (the
security blanket) · [`requirements/`](requirements/) (the katas).*
