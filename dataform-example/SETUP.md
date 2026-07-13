# Setup — offline DuckDB harness & tests

Get the whole pipeline running and tested on your machine in a couple of
minutes. **No cloud, no BigQuery, no GCP account, no credentials** — the
entire pipeline executes in an embedded DuckDB engine that's pulled in as
a dev dependency. If you just want the reading order for the project, see
[`../README_FIRST.md`](../README_FIRST.md) at the repo root; this page is
purely about getting it running.

---

## Prerequisites

- **Node.js 18 or newer** (20+ recommended; verified on Node 24).
  Check with `node --version`.
- **npm 9+** (ships with modern Node). Check with `npm --version`.
- **git**, to clone the repo.
- ~150 MB free disk for `node_modules` (the DuckDB native binary).

That's it. You do **not** need the `dataform` CLI, a GCP project, or any
Google credentials to run everything on this page.

> Platform notes: works on **Windows** (PowerShell or Git Bash),
> **macOS** (Intel or Apple Silicon), and **Linux x64/arm64**. The only
> unsupported target is **musl/Alpine** Linux — the DuckDB engine ships
> glibc prebuilds, so use a Debian/Ubuntu-based image if you're in Docker.

---

## Quick start

Everything lives in the `dataform-example/` directory — run all commands
from there:

```bash
cd dataform-example
npm install        # once — pulls @duckdb/node-api (dev-only, ~150 MB)
npm run check      # unit tests + compile demo + full offline pipeline
```

If `npm run check` ends with **`OFFLINE PIPELINE GREEN`** and
**`pass 119 / fail 0`**, you're fully set up. That single command is the
project's definition of done.

---

## What each command does

| Command | What it runs | Needs `npm install`? |
|---|---|---|
| `npm test` | Unit tests over every SQL generator (`node --test`) | no |
| `npm run demo` | Prints the SQL your **config** generates — the fastest way to *see* "variance as data" | no |
| `npm run local:dry` | Prints the execution plan (every model, assertion, expectation) | **no** — works with zero installs |
| `npm run local` | The whole pipeline in DuckDB: models + rule assertions + integration expectations + negative tests | yes |
| `npm run emit-sql` | Writes every generated model + assertion to the repo-root `dataform-sql/` folder (both dialects) — **the SQL, readable in SQL developers' terms**; transient, understanding aid only | no |
| `npm run dataform:compile` | Stages the pure Dataform workspace (`workflow_settings.yaml` + `definitions/` + `includes/`) and compiles it with the **genuine `@dataform/cli`** — proves the project deploys (needs network for `npx`) | no |
| `npm run check` | `test` + `demo` + `local` + `emit-sql` — the full gate | yes |
| `npm run seed:generate` | Regenerates `seed/bigquery_setup.sql` from `seed/data.js` | no |

`npm run local:dry` and `npm test` need **nothing** installed — handy for
a first look or a CI lint step before the DuckDB binary is available.

---

## Expected output

`npm run local` finishes with a run of green checks and:

```
✔ Pipeline built (66 models), rule assertions: 87 clean
... integration expectations ...
... negative tests (corrupt data on purpose; the guardrails must fire) ...

✔ OFFLINE PIPELINE GREEN — safe to develop against
```

`npm test` finishes with:

```
ℹ tests 119
ℹ pass 119
ℹ fail 0
```

(Counts grow as the project does; see `README.md` for the current
figures.)

---

## The development loop

The offline harness is the gate for **every** change — you never need the
cloud to know a change is correct:

```
1. Edit config / includes  (a market, a rule, a field, an attribute)
2. npm test                unit tests over the generators
3. npm run local           the FULL pipeline in DuckDB, in seconds
4. (optional) dataform compile   confirm blast radius, if you have the CLI
5. commit
```

See `CLAUDE.md` → "Workflow for any change" and its recipes.

---

## Troubleshooting

**`✘ @duckdb/node-api is not installed`** — run `npm install`. To sanity-
check the plan without it, `npm run local:dry` works with zero installs.

**`npm install` fails with `ETARGET / No matching version`** — the
package is pinned to `1.4.5-r.1` in `package.json`. Its published
versions carry a `-r.N` suffix that caret ranges (`^1.4.0`) don't match,
so keep the pin exact. If you must move it, pick a real published version
(`npm view @duckdb/node-api versions`).

**`npm install` fails downloading the native binary** — the DuckDB engine
fetches a per-platform prebuilt binary. Behind a corporate proxy, set
`HTTP_PROXY`/`HTTPS_PROXY`. On **Alpine/musl** it won't install — switch
to a Debian/Ubuntu-based environment (glibc).

**A syntax error mentioning DuckDB** — regenerate the seed with
`npm run seed:generate` and re-run. Engine-specific SQL lives only in
`includes/dialect.js`; nothing else should differ between DuckDB and
BigQuery.

**Node too old** — `@duckdb/node-api` needs Node 18+. Upgrade Node (nvm,
Volta, or your OS package manager) and re-run `npm install`.

---

## What's NOT needed (and why)

- **No BigQuery / GCP** — production targets BigQuery + Dataform, but all
  SQL is generated by pure JS functions and runs identically in DuckDB
  via a thin dialect layer (`includes/dialect.js`). Deploying to the
  cloud is a formality once the offline run is green.
- **No CI runner** — CI is not wired (the self-hosted GitLab has no
  runner); `npm run check` on your desktop is the gate. See `CLAUDE.md`
  open item #5.

Next: [`../README_FIRST.md`](../README_FIRST.md) for the guided tour, or
`ARCHITECTURE.md` for how it all fits together.
