# Max stake limits — implementation guide (step by step)

*Companion to [requirements.md](requirements.md) and [overview.md](overview.md).
Each step names the layer it touches and the requirement it satisfies. The
final section links every requirement to the artifact that implements it.*

Everything follows the standard workflow from `dataform-example/CLAUDE.md`:
edit config/includes → `npm test` → `npm run local` → done. No step creates
per-market SQL.

---

## Part A — the reporting pipeline (`dataform-example/`)

### Step 1 · Config: the statutory bands as data *(REQ-MSL-1)*

In `includes/jurisdictions.js`, add a `slotsStakeLimits` array to each
market's `playerProtection` block. A band is
`{ maxStake, minAge?, maxAge?, from?, to? }` — omit the whole key for markets
with no statutory cap (BG, GR):

```js
playerProtection: {
  ...,
  // REQ: requirements/max-stake-limits (REQ-MSL-1)
  slotsStakeLimits: [
    { maxStake: 5.00, minAge: 18, from: "2026-08-01" },               // all adults
    { maxStake: 2.00, minAge: 18, maxAge: 24, from: "2026-09-15" },   // young adults
  ],
},
```

This is the WHOLE per-market footprint. Guard it in `includes/validate.js`
(numeric `maxStake`, sane ages, date strings) so a bad band cannot compile.

### Step 2 · The universal datum: date of birth *(REQ-MSL-7)*

Age banding needs every account's date of birth — a datum **all** markets
need, so it belongs on the shared account model (the extension carrier is
only for data *some* markets need):

- `seed/data.js`: add a `date_of_birth` column to `cdc_accounts` (every
  account gets one; include one **18–24** account with no other activity so
  the young band is demonstrable without disturbing existing expectations).
- `includes/models.js`: carry the column through `stg_accounts` →
  `dim_customer_account`.
- `includes/dialect.js`: add `ageYears(dobExpr, dateExpr)` (both engines —
  age at a date, calendar-accurate enough for banding).

### Step 3 · The player-set limit: a row, not a schema *(REQ-MSL-2)*

`cdc_player_limits.limit_type` is already free-form data. Seed an active
`STAKE_CASINO` limit for one player. **No DDL, no model change** — the
existing staging/dedup/revocation lifecycle picks it up untouched.

### Step 4 · The regulator-visible reference *(REQ-MSL-6)*

Generate `ref_stake_limits` from config — one row per (market, band) with
`min_age / max_age / valid_from / valid_to` — exactly like the effective-dated
regulator code maps. Wire it in `definitions/15_reference/` and the offline
runner; pin its contents with an expectation.

### Step 5 · The breach detector, written once *(REQ-MSL-3, REQ-MSL-5)*

Add to `includes/player_protection.js`:

- `statutorySlotsCapExpr(j, ageExpr, dateExpr)` — folds the market's bands
  into a null-safe `LEAST` of `CASE WHEN age-in-band AND date-in-force THEN
  maxStake END` arms (an absent band list → NULL → no statutory cap).
- `rgBreachStakeLimits(ctx)` — for every gaming activity row, resolve the
  effective cap **as of that stake**: personal `STAKE_CASINO` (all verticals)
  null-safe-min statutory cap (only when the game's canonical type is
  `SLOT` — UKGC scope), using the player's age at the market-local date of
  the stake. A row where `stake > effective` is a breach. One function, all
  markets, no branches on market anywhere.

### Step 6 · Quarantine-first consequence *(REQ-MSL-5)*

One line in `includes/exceptions.js`: add `rg_breach_stake_limits` to the
COMPLIANCE union feeding `fct_exceptions` — a breaching player is HELD and
excluded from their file; everyone else ships.

### Step 7 · Wire, prove, gate *(REQ-MSL-5, acceptance)*

- `local/run.js`: build the two new models; add negative tests on a corrupt
  copy of `fct_gaming_activity`:
  1. adult stakes 9.00 on a slot after go-live → **fires** (5-cap);
  2. the 21-year-old stakes 3.00 after the youth band arms → **fires** (2-cap);
  3. the same 3.00 stake BEFORE the youth band arms → **exempt** (only the
     5-cap is in force — effective-dating proven);
  4. a poker stake over the player's personal cap → **fires** (personal
     applies beyond slots; statutory does not).
- `local/expectations.js`: pin `ref_stake_limits`; extend the breach-detector
  expectation to six detectors.
- `test/`: unit tests for the cap expression, the detector SQL, the dialect
  helper and the validator.
- `npm run check` green = done (definition of done unchanged).

## Part B — the operator front door (`dataform-website/`) *(REQ-MSL-4)*

1. `db.py` + registration: capture `date_of_birth` on accounts.
2. `engine.py`: mirror the statutory bands as data (`SLOTS_STAKE_LIMITS`,
   same dates — they arm automatically); extend the stake gate so casino
   games check the effective cap (personal `STAKE_CASINO` on all games;
   statutory on slots only), refusing with a clear reason.
3. `app.py` / templates: add *Stake — casino (per bet)* to the limits UI.
4. Reseed the committed database.

## Part C — documentation sync *(REQ-MSL-8)*

Update the six-detector counts and model/test counts across
`dataform-example` docs, the ER diagram (accounts gained `date_of_birth`),
and `readme-web.md`; every new code block carries a
`REQ: requirements/max-stake-limits` comment.

---

## As implemented — requirement → artifact trace

| Requirement | Implemented by | Proven by |
|---|---|---|
| REQ-MSL-1 statutory bands as data | `dataform-example/includes/jurisdictions.js` (`slotsStakeLimits` per market: MT 2 bands, ES/DK/NL flat, BG/GR none) | `test/stake_limits.test.js` (config shape); expectation pinning `ref_stake_limits` |
| REQ-MSL-2 player-set STAKE_CASINO | Seed `L5` in `seed/data.js` flowing through the untouched `cdc_player_limits` machinery | Negative test 4 (poker stake over personal cap fires) |
| REQ-MSL-3 effective-cap resolution | `statutorySlotsCapExpr` + `rgBreachStakeLimits` in `includes/player_protection.js` | Unit tests; negative tests 1–4 |
| REQ-MSL-4 front-door refusal | `dataform-website/engine.py` (`SLOTS_STAKE_LIMITS`, `casino_stake_block`), limits UI in `app.py`/`account.html`, DOB at registration | Site smoke test: personal €2 cap refuses a €5 spin with reason |
| REQ-MSL-5 pipeline proof, quarantine-first | `rg_breach_stake_limits` model + one line in `includes/exceptions.js` COMPLIANCE union | Expectation (detector empty on clean data); negative tests 1–4 incl. the pre-go-live exemption |
| REQ-MSL-6 limits reference | `ref_stake_limits` (`definitions/15_reference/reference_tables.js` + `local/run.js`) | Expectation pinning all bands |
| REQ-MSL-7 DOB on the shared model | `seed/data.js` (`cdc_accounts.date_of_birth`, young account `A8001`), `includes/models.js`, `dialect.ageYears` | Unit test (dialect twins); age-band negative tests |
| REQ-MSL-8 traceability | `REQ: requirements/max-stake-limits` comments at every change site; this table | — |

**Verification**: `npm run check` green — see the counts in
`dataform-example/README.md` (models, assertions, expectations, negative
tests and unit tests all grew by exactly the artifacts above and nothing
else). The full diff of this change is the commit tagged with this folder's
name in its message.
