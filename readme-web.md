# BetNova — the fictitious demo gaming website (`dataform-website/`)

A deliberately-simple, **entirely fictitious** online gaming website (think
bet365-style sportsbook + casino, but invented) that runs locally from the
command line and persists everything to a **DuckDB file checked into git**.

Its purpose is to make the regulatory-reporting architecture demonstrable **by
example**: every click writes the same OLTP shapes the reporting pipeline's
CDC landing tables capture (`dataform-example/`), so an audience can register,
deposit, bet, play, and then watch that exact data drive submissions, tax,
breach detectors and exception flows. No real money, odds, brand or gambling —
it is a single-user architecture demo.

---

## Setup on a new computer

Prerequisites: **Python 3.14** and git. On Windows:

```powershell
winget install Python.Python.3.14        # or download from python.org
```

Then, from the repository root (`rd-unified-platform/`):

```powershell
# 1. one shared venv at the repo root (further Python work reuses it)
py -3.14 -m venv .venv

# 2. install the (tiny) requirements: flask, duckdb, pytz
.venv\Scripts\python -m pip install -r requirements.txt

# 3. run the website
.venv\Scripts\python dataform-website\app.py
```

macOS / Linux:

```bash
python3.14 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python dataform-website/app.py
```

Open **http://127.0.0.1:5001** — that's it. Starting the app also starts, in
the same process, the **fictitious regulator SAFE** (a SOAP web service on
**http://127.0.0.1:5002** — one endpoint per jurisdiction per record type) and
the **near-realtime submission engine**, which polls the database every few
seconds and SOAPs every newly-reportable record into the SAFE. Both stop when
the app stops. The persistent database
(`dataform-website/data/betnova.duckdb`) ships in git already seeded, so the
site works immediately with:

| Login | Role |
|---|---|
| `demo` / `demo` | A verified, funded Malta player (€200 balance, limits set) |
| `admin` / `admin` | Customer services / back office / demo control |

To wipe everything back to the seed state:

```powershell
.venv\Scripts\python dataform-website\reset_db.py
```

---

## What you can demonstrate

**As a player** (join as a new one, or use `demo`):

- **Register** — pick one of the seven pipeline markets (MT/ES/DK/BG/GR/NL/DE),
  provide a made-up national id, accept the fictitious T&Cs.
- **Account** — save an address (each market shows its own postcode format —
  save a deliberately *bad* one and the reporting pipeline quarantines just
  that account), payment details, and deposit / loss / **casino-stake**
  limits. Set *Stake — casino* to €2 and a €5 slots spin is refused on the
  spot; statutory age-banded slots caps (see
  `requirements/max-stake-limits/`) ship date-armed and start refusing
  automatically on their effective dates.
- **Verify identity** — simulated KYC. Until verified, withdrawals are **held
  at REQUESTED** (the pipeline's unverified-withdrawal control, seen live).
- **Deposit / withdraw** — fictitious funds; deposits that would break a limit
  are refused and recorded as FAILED with the reason.
- **Bet on sports** — football / tennis / basketball / ice hockey with
  invented teams and prices. A fixture settles **~40 seconds** after the first
  bet lands, so the audience watches the full lifecycle on *My Bets*: PLACED →
  **WIN**, **LOSS**, or **VOID** (abandoned event, palpable-odds error, or a
  customer-services void) with the stake refunded on voids.
- **Play casino** — NovaSlots, Blackjack (hit/stand, dealer to 17) and
  Showdown Poker. Every round is gaming activity on the same unified wallet.
- **Golden chips** (see `requirements/golden-chips/`) — deposit €50+ and a €5
  promotional chip lands on your account (admin can award them too). Play it
  on blackjack or poker (never slots): a win pays the **winnings only** as
  cash — the chip is never returned — and a loss costs nothing. The SAFE sees
  the round's funding, and the reconciliation treats bonus stakes per each
  market's `deduct`/`gross` GGR policy.
- **Operator jackpot + gaming sessions** (see `requirements/operator-jackpots/`)
  — every login mints a **gaming session id** (ended by logout or a 30-minute
  inactivity timeout) that is stamped on every gaming round and reported to
  the SAFE. **Opt in** from your Account page and 1% of every cash casino
  stake joins the shared pool (live on the casino lobby); every play runs an
  RNG draw — win and a celebration flash credits the **whole pot** to your
  balance instantly, the pool re-seeds, and the contribution/win rounds are
  recorded as their own jackpot game (`operator-jackpots`, game type **7077**
  — a configurable magic number deducible from the gaming data).
- **One balance** — the header balance is derived from the ledger (payments ±
  stakes ± returns across sports *and* gaming), never stored — the same
  unified-wallet idea as the pipeline's `fct_wallet_ledger`.

**As `admin`** (customer services + demo control):

- **Dashboard** — players, **in-flight bets** (live), online users (last 5
  minutes), fixtures armed to settle, recent payments.
- **Player 360** — any player's profile, address, limits, bets, payments and
  casino rounds, with balance.
- **Actions** — verify KYC; **void any bet** (drives the void/refund cascade);
  **self-exclude / un-exclude** a player (their deposits then FAIL and wagers
  block — show the pipeline's activity-while-excluded detector staying clean
  because the platform refused); complete a held withdrawal (refused while the
  player is unverified); **settle a fixture NOW** (never wait for the timer
  mid-demo).

**The regulator SAFE + submission engine** (runs automatically with the app):

- `safe.py` — a single SOAP 1.1 web service impersonating all seven regulators'
  record stores (in real life one per regulator — Denmark's is literally
  called the SAFE). Endpoints: `POST /safe/<MKT>/<type>` for `<MKT>` in
  MT/ES/DK/BG/GR/NL/DE and `<type>` in `bets` / `payments` / `players`, plus
  `?wsdl` per endpoint and a browsable status page at
  **http://127.0.0.1:5002/**. Every accepted record is stored pretty-printed,
  one XML file per record, under `dataform-safe/<MKT>/<type>/` with a
  per-endpoint receipt sequence. Unknown jurisdictions/types get a SOAP Fault.
- `submission.py` — the near-realtime submission engine: every ~3 seconds it
  pulls newly-reportable records (new/KYC-changed **players**, **completed
  payments**, **settled or voided bets**) and delivers each one as a SOAP
  `SubmitRecord` call, logging receipts in `safe_submissions` so nothing is
  sent twice. Market variance is data here too: MT/DK report voids with a
  status column, ES/BG/GR/NL never do and pseudonymise the player
  (SHA-256 of the national id).
- Watch it live: place a bet, and within ~45 seconds the settlement lands as
  XML in `dataform-safe/` — the admin dashboard shows delivered counts and
  receipts, and links to the SAFE's own status page.
- Both are importable modules started as daemon threads by `app.py` (DuckDB
  allows one writer process, so the engine shares the app's connection). They
  can also run standalone: `python safe.py` any time;
  `python submission.py` (one-shot drain) only while the app is stopped.

**Financial reconciliation** (`reconciliation.py`): daily + monthly **PDF per
jurisdiction** under `dataform-reconciliation/`, reconciling the OLTP against
what was reported to the SAFE — the cash view (player transactions) vs the
settlement view (the GGR tax base) bridged by the open-bets movement,
three-way reported completeness with itemised breaks, and the GGR duty at
each day's effective-dated rate. Generate from **Admin → Financial
reconciliation** (pick market, daily/monthly, day or month; download the PDFs
from the same page), or from the CLI while the site is stopped (exit code 0 =
reconciled and fully reported, so it can gate a scheduled finance close).
Process documented in `financial-reconciliations.md` (repo root).

## How it maps onto the reporting architecture

Each website table mirrors a CDC landing table in `dataform-example/`:

| Website (OLTP) | Pipeline landing table | Demonstrates |
|---|---|---|
| `accounts` | `cdc_accounts` | jurisdictions, KYC status |
| `account_addresses` | `cdc_account_addresses` | postcode validation → DATA exceptions |
| `bet_slips` / `bet_slip_events` | `cdc_bet_slips` / `cdc_bet_slip_events` | append-only lifecycle: PLACED/SETTLED/VOIDED |
| `payments` | `cdc_payments` | deposit/withdrawal lifecycle, blocked & held payments |
| `player_limits` | `cdc_player_limits` | limit set/revoke lifecycle |
| `self_exclusions` | `cdc_self_exclusions` | exclusion windows |
| `verifications` | `cdc_verifications` | KYC before withdrawal |
| `game_rounds` | `cdc_*_rounds` / `cdc_poker_activity` | gaming activity, unified loss base |
| `fixtures` / `fixture_odds` | `cdc_fixtures` | sport nomenclature feeds |

The rules the website *enforces at the front door* (limits, exclusions, KYC,
sufficient balance) are exactly the invariants the pipeline *proves after the
fact* with its breach detectors — the demo story is that both layers exist and
agree.

## Layout & notes

```
dataform-website/
  app.py            Flask routes (player + admin)      python app.py
  engine.py         settlement, limits, games logic
  db.py             DuckDB schema + connection + wallet ledger
  safe.py           the fictitious regulator SAFE (SOAP, port 5002)
  submission.py     near-realtime submission engine (polls -> SOAP)
  reset_db.py       rebuild data/betnova.duckdb from seed (+ clear the SAFE)
  templates/ static/  the UI
  data/betnova.duckdb  the persistent database (committed to git)
dataform-safe/      records the SAFE has accepted (pretty-printed XML,
                    one folder per jurisdiction per record type; gitignored)
```

- **Single-user demo**: Flask dev server on `127.0.0.1:5001`, one process.
  Don't run two copies — DuckDB allows one writer process per file.
- **Settlement without background jobs**: due fixtures settle lazily on the
  next request (and the admin can settle any fixture immediately).
- A `data/betnova.duckdb.wal` file may appear while the server runs; it is
  gitignored and disappears on clean shutdown.
- Python 3.14 / Flask 3.1 / DuckDB 1.5 (`requirements.txt` at the repo root;
  `pytz` is required by duckdb for timezone-aware timestamps).
