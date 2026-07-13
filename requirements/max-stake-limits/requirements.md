# Requirement: Maximum stake limits for casino games (all jurisdictions)

| | |
|---|---|
| Requirement id | **MSL** (max-stake-limits) — individual items REQ-MSL-1 … REQ-MSL-8 |
| Scope | All implemented jurisdictions (MT, ES, DK, BG, GR, NL) |
| Status | Implemented — see [implementation.md](implementation.md) § "As implemented" |
| Companion docs | [overview.md](overview.md) (what & how) · [implementation.md](implementation.md) (step-by-step) |

## Background / regulatory context

The UK Gambling Commission introduced **statutory stake limits for online
slots** ([Online slots stake limit guidance](https://www.gamblingcommission.gov.uk/licensees-and-businesses/guide/online-slots-stake-limit-guidance)):

- **£5 per game cycle** for adults, from **9 April 2025**;
- **£2 per game cycle** for young adults aged **18–24**, from **21 May 2025**
  (a *staggered*, *age-banded* rollout);
- the limits apply to **online slots only** — not to other casino games such
  as roulette or blackjack;
- operators must also enforce a minimum **2.5-second game-cycle interval**
  (a game-engine control — see "Out of scope" below).

Group compliance has decided to adopt **UKGC-style stake-limit protections
across all our markets** ahead of similar regulation arriving locally, with
**per-market values and dates** (set by each market's compliance owner — the
values below are illustrative pending local legal review), and additionally to
let **players set their own per-stake limit for casino play** as a
responsible-gambling tool.

## The requirements

**REQ-MSL-1 — Statutory slots stake caps, per jurisdiction, as data.**
Each jurisdiction MAY define a maximum permitted stake for a single online
slots game cycle. The definition supports **age bands** (e.g. a general adult
cap and a tighter 18–24 cap) and **effective dates** (each band arms on its
own date — mirroring the UKGC's staggered 9 April / 21 May rollout). A market
with no cap defined has no statutory restriction. Adopted values:

| Market | Bands (illustrative) | In force from |
|---|---|---|
| MT | €5.00 all adults · €2.00 ages 18–24 | 2026-08-01 · 2026-09-15 |
| ES | €10.00 flat | 2026-08-01 |
| DK | 7.50 flat | 2026-08-01 |
| NL | €5.00 flat | 2026-08-01 |
| BG, GR | *none yet* (player-set only) | — |

**REQ-MSL-2 — Player-set casino stake limit.** Any player can set a personal
maximum stake per bet for **casino play** (limit type `STAKE_CASINO`), with
the same set/replace/revoke lifecycle as existing deposit and loss limits.
Unlike the statutory cap, the personal cap applies to **all casino verticals**
(slots, tables, poker), and is effective immediately when set.

**REQ-MSL-3 — Effective cap resolution.** The cap applied to a given stake is
the **null-safe minimum** of (a) every statutory band applicable to that
player's **age at the time of the stake** and **the local date of the stake**
(slots only), and (b) the player's active personal `STAKE_CASINO` limit (all
casino verticals). No applicable cap → the stake is unrestricted.

**REQ-MSL-4 — Front-door enforcement.** The operator platform must refuse a
casino stake above the player's effective cap at bet time, with a clear
reason. (Demonstrated in the BetNova demo site.)

**REQ-MSL-5 — After-the-fact proof (the reporting pipeline).** A breach
detector must select every gaming stake that exceeded the effective cap in
force **at the moment it was staked** — including historical recomputation
(a stake placed before a band's effective date is NOT a breach of that band).
Under the platform's quarantine-first model a breach HOLDS the breaching
entity, and negative tests must prove the detector fires for: an adult over
the statutory cap, a young adult over the youth band, and a player over their
personal cap — and does NOT fire for a pre-go-live stake.

**REQ-MSL-6 — Regulator-visible limits reference.** The limits in force must
be materialised as an effective-dated reference table (like the regulator code
maps), so any period's applicable caps are queryable and auditable.

**REQ-MSL-7 — Player age.** Age banding requires each account's date of
birth. This is a **universal datum** (every market needs it), so it is added
to the shared account model — NOT via the per-market extension carrier, which
is reserved for data only some markets need.

**REQ-MSL-8 — Traceability.** Every code change cites this requirement
(`REQ: requirements/max-stake-limits`), and
[implementation.md](implementation.md) links each requirement to the
artifacts that implement and prove it.

## Out of scope

- The UKGC **2.5-second minimum game-cycle interval** — a real-time game
  engine control, not a data/reporting concern.
- Full **game-cycle** semantics (multiple part-stakes within one cycle
  aggregating to the cap). The demo models one stake = one cycle; the
  detector's grain (per gaming activity row) is where cycle aggregation would
  slot in.
- Bonus/free-spin play treatment.

## Acceptance criteria

1. `npm run check` green in `dataform-example/` with new unit tests, the new
   reference table, the new breach detector, expectations and negative tests
   (including the pre-go-live exemption and the age-band case).
2. The BetNova demo blocks a casino stake above a player-set `STAKE_CASINO`
   limit immediately, and carries the statutory logic date-armed.
3. No `if (market === …)` in shared logic: all per-market values are config.
4. Docs and diagrams updated; every artifact traceable back to this folder.
