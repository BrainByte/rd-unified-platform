# ============================================================================
# BetNova demo — the "operator platform" logic.
#
# Everything here is deliberately simple and FICTITIOUS: random outcomes,
# fake teams, demo-speed settlement. Its only job is to generate realistic
# OLTP data (accounts, bets, lifecycle events, payments, limits, game
# rounds) so the reporting architecture can be demonstrated end to end.
# ============================================================================
import random
from datetime import timedelta
from db import next_id, now, slip_status, balance

# Fixtures settle this long after the FIRST bet lands on them — the audience
# places a bet, refreshes "My bets", and sees the outcome within a minute.
SETTLE_SECONDS = 40
ABANDON_CHANCE = 0.07     # fixture abandoned -> every slip voided
PALP_VOID_CHANCE = 0.05   # single-slip void at settlement ("palpable error")
MIN_OPEN_FIXTURES = 8

# The six markets the reporting pipeline implements — including each one's
# postcode format (the pipeline validates these; see includes/exceptions.js).
JURISDICTIONS = {
    "MT": {"name": "Malta",       "postcode_hint": "LLL 9999 (e.g. VLT 1117)"},
    "ES": {"name": "Spain",       "postcode_hint": "5 digits (e.g. 28001)"},
    "DK": {"name": "Denmark",     "postcode_hint": "4 digits (e.g. 2100)"},
    "BG": {"name": "Bulgaria",    "postcode_hint": "4 digits (e.g. 1000)"},
    "GR": {"name": "Greece",      "postcode_hint": "999 99 (e.g. 105 58)"},
    "NL": {"name": "Netherlands", "postcode_hint": "9999 LL (e.g. 1012 AB)"},
    "DE": {"name": "Germany",     "postcode_hint": "5 digits (e.g. 10115)"},  # REQ: de-regulator-addition
}

TERMS_VERSION = "1.0-demo"

# Statutory online-slots stake caps, mirroring the reporting pipeline's config
# (REQ: requirements/max-stake-limits, REQ-MSL-1/4). UKGC-modelled: age-banded
# and effective-dated — each band starts refusing stakes automatically on its
# date. A player's personal STAKE_CASINO limit (set in Account -> limits)
# additionally caps EVERY casino game, immediately.
SLOTS_STAKE_LIMITS = {
    "MT": [{"max_stake": 5.00, "min_age": 18, "from": "2026-08-01"},
           {"max_stake": 2.00, "min_age": 18, "max_age": 24, "from": "2026-09-15"}],
    "ES": [{"max_stake": 10.00, "min_age": 18, "from": "2026-08-01"}],
    "DK": [{"max_stake": 7.50, "min_age": 18, "from": "2026-08-01"}],
    "NL": [{"max_stake": 5.00, "min_age": 18, "from": "2026-08-01"}],
    # DE (REQ: de-regulator-addition) — the REAL GGL progression: EUR 1 flat
    # since GlueStV 2021, graduated from 1 Jul 2026 (EUR 1 under-21, EUR 3
    # for 21+; the EUR 5 clean-90-days tier needs a behavioural flag).
    "DE": [{"max_stake": 1.00, "min_age": 18, "from": "2021-07-01", "to": "2026-07-01"},
           {"max_stake": 1.00, "min_age": 18, "max_age": 20, "from": "2026-07-01"},
           {"max_stake": 3.00, "min_age": 21, "from": "2026-07-01"}],
    # BG / GR: no statutory cap yet — player-set only.
}

# ---- fictitious sports content ----
TEAMS = {
    "Football": (["Avondale FC", "Rovers United", "Northgate Town", "Eastbrook City",
                  "Kestrel Athletic", "Harborview FC", "Silverlake SC", "Marwick Wanderers"],
                 ["Nova Premier League", "Continental Cup"], True),
    "Tennis": (["I. Petrova", "M. Lindqvist", "T. Okafor", "R. Castellanos",
                "J. Whitfield", "A. Nakamura"], ["Nova Open", "Harbour Masters"], False),
    "Basketball": (["Bayline Hawks", "Iron Ridge Giants", "Solaris 76", "Vertex Flyers",
                    "Duneport Kings", "Gritstone Bears"], ["NBL Nova"], False),
    "Ice Hockey": (["Polar Wolves", "Glacier Knights", "Steelport Storm", "Aurora Blades"],
                   ["Frost League"], True),
}


def gen_fixture(cur):
    sport = random.choice(list(TEAMS))
    names, comps, has_draw = TEAMS[sport]
    home, away = random.sample(names, 2)
    fid = next_id(cur, "fixture", "F")
    cur.execute(
        "INSERT INTO fixtures VALUES (?, ?, ?, ?, ?, ?, 'OPEN', NULL, NULL)",
        [fid, sport, random.choice(comps), home, away, now() + timedelta(minutes=random.randint(2, 20))])
    # plausible-looking odds with an operator margin (purely made up)
    h = round(random.uniform(1.4, 3.6), 2)
    a = round(random.uniform(1.4, 3.6), 2)
    cur.execute("INSERT INTO fixture_odds VALUES (?, 'HOME', ?)", [fid, h])
    cur.execute("INSERT INTO fixture_odds VALUES (?, 'AWAY', ?)", [fid, a])
    if has_draw:
        cur.execute("INSERT INTO fixture_odds VALUES (?, 'DRAW', ?)", [fid, round(random.uniform(3.0, 4.5), 2)])


def top_up_fixtures(cur):
    cur.execute("SELECT COUNT(*) FROM fixtures WHERE status = 'OPEN'")
    for _ in range(max(0, MIN_OPEN_FIXTURES - cur.fetchone()[0])):
        gen_fixture(cur)


def open_fixtures(cur):
    cur.execute("""
        SELECT f.fixture_id, f.sport, f.competition, f.home, f.away, f.start_ts,
               MAX(CASE o.selection WHEN 'HOME' THEN o.odds END) AS home_odds,
               MAX(CASE o.selection WHEN 'DRAW' THEN o.odds END) AS draw_odds,
               MAX(CASE o.selection WHEN 'AWAY' THEN o.odds END) AS away_odds
        FROM fixtures f JOIN fixture_odds o USING (fixture_id)
        WHERE f.status = 'OPEN'
        GROUP BY ALL ORDER BY f.sport, f.start_ts""")
    return cur.fetchall()


# ---- settlement: runs lazily on every request (no background threads) ----
def settle_due(cur):
    cur.execute("SELECT fixture_id FROM fixtures WHERE status = 'OPEN' AND settle_at IS NOT NULL AND settle_at <= ?", [now()])
    for (fid,) in cur.fetchall():
        settle_fixture(cur, fid)


def settle_fixture(cur, fixture_id, force_result=None):
    """Settle one fixture: pick a result weighted by implied probability,
    or abandon it (voiding every slip). Slips get SETTLED/VOIDED lifecycle
    events — the exact shape cdc_bet_slip_events feeds the pipeline."""
    ts = now()
    if force_result is None and random.random() < ABANDON_CHANCE:
        cur.execute("UPDATE fixtures SET status = 'ABANDONED', result = NULL WHERE fixture_id = ?", [fixture_id])
        _void_open_slips(cur, fixture_id, ts, "event abandoned")
        return "ABANDONED"

    cur.execute("SELECT selection, odds FROM fixture_odds WHERE fixture_id = ?", [fixture_id])
    sels = cur.fetchall()
    if force_result:
        result = force_result
    else:
        weights = [1.0 / float(o) for _, o in sels]   # implied probability
        result = random.choices([s for s, _ in sels], weights=weights)[0]
    cur.execute("UPDATE fixtures SET status = 'SETTLED', result = ? WHERE fixture_id = ?", [result, fixture_id])

    cur.execute("SELECT slip_id, selection, odds FROM bet_slips WHERE fixture_id = ?", [fixture_id])
    for slip_id, selection, odds in cur.fetchall():
        if slip_status(cur, slip_id) != "OPEN":
            continue
        if random.random() < PALP_VOID_CHANCE:
            cur.execute("INSERT INTO bet_slip_events VALUES (?, 'VOIDED', ?, NULL, NULL, ?)",
                        [slip_id, ts, "palpable odds error — market voided"])
            continue
        cur.execute("SELECT stake FROM bet_slip_events WHERE slip_id = ? AND event_type = 'PLACED'", [slip_id])
        stake = float(cur.fetchone()[0])
        payout = round(stake * float(odds), 2) if selection == result else 0.0
        cur.execute("INSERT INTO bet_slip_events VALUES (?, 'SETTLED', ?, NULL, ?, NULL)",
                    [slip_id, ts, payout])
    return result


def _void_open_slips(cur, fixture_id, ts, reason):
    cur.execute("SELECT slip_id FROM bet_slips WHERE fixture_id = ?", [fixture_id])
    for (slip_id,) in cur.fetchall():
        if slip_status(cur, slip_id) == "OPEN":
            cur.execute("INSERT INTO bet_slip_events VALUES (?, 'VOIDED', ?, NULL, NULL, ?)",
                        [slip_id, ts, reason])


# ---- responsible-gambling checks (mirror the pipeline's breach detectors) ----
def active_exclusion(cur, account_id):
    cur.execute("""SELECT source FROM self_exclusions
                   WHERE account_id = ? AND start_ts <= ? AND (end_ts IS NULL OR end_ts > ?)""",
                [account_id, now(), now()])
    row = cur.fetchone()
    return row[0] if row else None


def _window_start(period):
    ts = now()
    if period == "DAILY":
        return ts - timedelta(days=1)
    if period == "WEEKLY":
        return ts - timedelta(days=7)
    return ts - timedelta(days=30)


def limit_for(cur, account_id, limit_type):
    cur.execute("""SELECT MIN(amount) FROM player_limits
                   WHERE account_id = ? AND limit_type = ? AND revoked_at IS NULL""",
                [account_id, limit_type])
    row = cur.fetchone()
    return float(row[0]) if row and row[0] is not None else None


def deposit_limit_block(cur, account_id, amount):
    """Would this deposit breach an active deposit limit? -> reason or None."""
    for period in ("DAILY", "WEEKLY", "MONTHLY"):
        lim = limit_for(cur, account_id, f"DEPOSIT_{period}")
        if lim is None:
            continue
        cur.execute("""SELECT COALESCE(SUM(amount), 0) FROM payments
                       WHERE account_id = ? AND direction = 'DEPOSIT'
                         AND status = 'COMPLETED' AND completed_ts >= ?""",
                    [account_id, _window_start(period)])
        if float(cur.fetchone()[0]) + amount > lim:
            return f"would exceed your {period.lower()} deposit limit of {lim:.2f}"
    return None


def loss_limit_block(cur, account_id, stake):
    """Would this stake push net loss (stakes - returns, bets AND gaming —
    the same unified grain as fct_player_gambling_activity) over a limit?"""
    for period in ("DAILY", "WEEKLY", "MONTHLY"):
        lim = limit_for(cur, account_id, f"LOSS_{period}")
        if lim is None:
            continue
        ws = _window_start(period)
        cur.execute("""
            SELECT COALESCE(SUM(net), 0) FROM (
              SELECT p.stake - s.payout AS net
              FROM bet_slips b
              JOIN bet_slip_events p ON p.slip_id = b.slip_id AND p.event_type = 'PLACED'
              JOIN bet_slip_events s ON s.slip_id = b.slip_id AND s.event_type = 'SETTLED'
              WHERE b.account_id = ? AND s.event_ts >= ?
                AND NOT EXISTS (SELECT 1 FROM bet_slip_events v
                                WHERE v.slip_id = b.slip_id AND v.event_type = 'VOIDED')
              UNION ALL
              -- golden-chip rounds never count toward loss limits: the
              -- player risked nothing (REQ: requirements/golden-chips, GC-5)
              SELECT stake - payout FROM game_rounds
              WHERE account_id = ? AND round_ts >= ? AND funding = 'CASH'
            )""", [account_id, ws, account_id, ws])
        if float(cur.fetchone()[0]) + stake > lim:
            return f"would risk exceeding your {period.lower()} loss limit of {lim:.2f}"
    return None


def casino_stake_block(cur, account_id, stake, game):
    """Max-stake-limit gate for casino play (REQ: requirements/max-stake-limits).
    Personal STAKE_CASINO cap applies to every casino game immediately;
    statutory age-banded caps apply to SLOTS only, each from its own date."""
    personal = limit_for(cur, account_id, "STAKE_CASINO")
    if personal is not None and stake > personal:
        return (f"exceeds your personal casino stake limit of {personal:.2f} "
                "(set in Account)")
    if game == "SLOTS":
        cur.execute("SELECT jurisdiction, date_of_birth FROM accounts WHERE account_id = ?",
                    [account_id])
        mkt, dob = cur.fetchone()
        today = now().date()
        age = int((today - dob).days / 365.2425) if dob else None
        caps = []
        for band in SLOTS_STAKE_LIMITS.get(mkt, []):
            if str(today) < band["from"]:
                continue                      # band not in force yet
            if "to" in band and str(today) >= band["to"]:
                continue                      # band superseded (e.g. DE's flat EUR 1)
            if age is None or age < band.get("min_age", 18):
                continue
            if "max_age" in band and age > band["max_age"]:
                continue
            caps.append(band["max_stake"])
        if caps and stake > min(caps):
            return (f"exceeds the statutory {mkt} online-slots stake limit of "
                    f"{min(caps):.2f} in force for your age band")
    return None


def stake_gate(cur, account_id, stake, casino_game=None, golden=False):
    """Common checks before any wager (sports or casino). -> error or None.
    golden=True (REQ: requirements/golden-chips): the stake is an operator-
    funded chip — no balance to spend and no possible loss, so those two
    checks don't apply; exclusion and stake caps (on the chip VALUE) do."""
    if stake <= 0:
        return "Stake must be positive."
    src = active_exclusion(cur, account_id)
    if src:
        return f"Your account is self-excluded ({src}) — wagering is blocked."
    if golden and casino_game not in GOLDEN_CHIP_GAMES:
        return "Golden chips play on table games only (blackjack, poker)."
    if not golden:
        # opted-in casino play also debits the jackpot contribution, so the
        # gate reserves stake + contribution — the pool can never overdraw
        # the wallet. REQ: requirements/operator-jackpots (REQ-OJ-4)
        required = stake
        if casino_game and is_opted_in(cur, account_id):
            required += jackpot_contribution(stake)
        if required > balance(cur, account_id):
            return "Insufficient balance — the wallet never goes negative."
        reason = loss_limit_block(cur, account_id, stake)
        if reason:
            return f"Blocked: this stake {reason}."
    if casino_game:
        reason = casino_stake_block(cur, account_id, stake, casino_game)
        if reason:
            return f"Stake refused: it {reason}."
    return None


# ==================== GAMING SESSIONS ======================================
# REQ: requirements/operator-jackpots (REQ-OJ-1/2). Minted at login, ended by
# logout or inactivity. Every gaming play carries its session id, and the id
# is reported on every gaming record delivered to the regulator SAFE.
SESSION_TIMEOUT_MINUTES = 30


def start_gaming_session(cur, account_id):
    from db import next_id
    session_id = next_id(cur, "gsession", "GS")
    cur.execute("INSERT INTO gaming_sessions VALUES (?, ?, ?, ?, NULL, NULL)",
                [session_id, account_id, now(), now()])
    return session_id


def end_gaming_session(cur, session_id, reason):
    cur.execute("""UPDATE gaming_sessions SET ended_at = ?, end_reason = ?
                   WHERE session_id = ? AND ended_at IS NULL""",
                [now(), reason, session_id])


def ensure_gaming_session(cur, account_id, session_id):
    """Touch the session on activity. A gap beyond the timeout means the
    player was disconnected: the stale session ends (INACTIVITY) and a new
    one is minted for the returning activity. Returns the live session id."""
    cur.execute("""SELECT last_activity_ts FROM gaming_sessions
                   WHERE session_id = ? AND account_id = ? AND ended_at IS NULL""",
                [session_id or "", account_id])
    row = cur.fetchone()
    if row is None:                                  # none live -> start one
        return start_gaming_session(cur, account_id)
    if (now() - row[0]).total_seconds() > SESSION_TIMEOUT_MINUTES * 60:
        end_gaming_session(cur, session_id, "INACTIVITY")
        return start_gaming_session(cur, account_id)
    cur.execute("UPDATE gaming_sessions SET last_activity_ts = ? WHERE session_id = ?",
                [now(), session_id])
    return session_id


# ==================== OPERATOR JACKPOTS (opt-in play incentive) ============
# REQ: requirements/operator-jackpots. Opted-in players contribute a
# percentage of every CASH casino stake into a shared pool and every
# contributing play runs an RNG draw for the whole pot. Contributions and
# wins are gaming rounds in their own right (game id below), with a
# configurable magic-number game type so jackpot activity is deducible from
# the gaming data — the operator-side twin of the pipeline's phantom game
# OJ1/OJACK (see dataform-example/ARCHITECTURE.md, operator-driven products).
OPERATOR_JACKPOT = {
    "game_id": "operator-jackpots",   # REQ-OJ-7: the jackpot's own game id
    "contribution_rate": 0.01,        # 1% of every cash casino stake
    "win_probability": 0.05,          # RNG per contributing play (demo-friendly)
    "seed": 100.00,                   # operator-funded starting pool
}
# REQ-OJ-8: game types as configurable data; 7077 is the jackpot magic number.
GAME_TYPE_CODES = {"SLOTS": 1, "BLACKJACK": 2, "POKER": 3, "operator-jackpots": 7077}


def opt_in_jackpot(cur, account_id):
    from db import next_id
    if is_opted_in(cur, account_id):
        return
    cur.execute("INSERT INTO jackpot_optins VALUES (?, ?, ?, NULL)",
                [next_id(cur, "optin", "OPT"), account_id, now()])


def opt_out_jackpot(cur, account_id):
    cur.execute("""UPDATE jackpot_optins SET opted_out_at = ?
                   WHERE account_id = ? AND opted_out_at IS NULL""", [now(), account_id])


def is_opted_in(cur, account_id):
    cur.execute("""SELECT 1 FROM jackpot_optins
                   WHERE account_id = ? AND opted_out_at IS NULL""", [account_id])
    return cur.fetchone() is not None


def jackpot_pool(cur):
    """REQ-OJ-6: the pool is DERIVED, never stored. The operator seeds the
    pool and RE-SEEDS it after every win (like real wide-area progressives
    and the pipeline's liability model), so:
        pool = seed x (1 + wins) + contributions - win payouts
    A win pays exactly this number, leaving the pool back at seed."""
    cur.execute("""SELECT COALESCE(SUM(stake), 0), COALESCE(SUM(payout), 0),
                          COALESCE(SUM(CASE WHEN payout > 0 THEN 1 ELSE 0 END), 0)
                   FROM game_rounds WHERE game = ?""", [OPERATOR_JACKPOT["game_id"]])
    contribs, wins_paid, win_count = cur.fetchone()
    return round(OPERATOR_JACKPOT["seed"] * (1 + int(win_count))
                 + float(contribs) - float(wins_paid), 2)


def jackpot_contribution(stake):
    return round(float(stake) * OPERATOR_JACKPOT["contribution_rate"], 2)


def operator_jackpot_play(cur, account_id, session_id, stake, funding, record_round):
    """Run after EVERY casino round (REQ-OJ-4/5/7): opted-in cash play
    contributes and draws; golden-chip rounds do neither (operator money).
    record_round(game, stake, payout, detail) persists a round and returns
    its id. Returns the win amount, or None."""
    if funding != "CASH" or not is_opted_in(cur, account_id):
        return None
    contribution = jackpot_contribution(stake)
    if contribution <= 0:
        return None
    record_round(OPERATOR_JACKPOT["game_id"], contribution, 0.0,
                 f"contribution ({OPERATOR_JACKPOT['contribution_rate'] * 100:.0f}% of {float(stake):.2f})")
    if random.random() < OPERATOR_JACKPOT["win_probability"]:
        amount = jackpot_pool(cur)          # the whole pot, derived right now
        record_round(OPERATOR_JACKPOT["game_id"], 0.0, amount, "OPERATOR JACKPOT WIN")
        return amount
    return None


# ==================== GOLDEN CHIPS (promotional table-game chips) ==========
# REQ: requirements/golden-chips. Operator-funded stakes for TABLE games:
# the chip is consumed win/lose/push, and only the WINNINGS come back — as
# cash. A losing chip costs the player nothing.
GOLDEN_CHIP_GAMES = ("BLACKJACK", "POKER")      # table games only (never slots)
DEPOSIT_PROMO = {"min_deposit": 50.0, "chip_value": 5.0}   # the homepage deal, as data


def award_golden_chip(cur, account_id, value, reason):
    from db import next_id
    chip_id = next_id(cur, "chip", "GC")
    cur.execute("INSERT INTO golden_chips VALUES (?, ?, ?, ?, 'AVAILABLE', ?, NULL, NULL)",
                [chip_id, account_id, value, reason, now()])
    return chip_id


def available_golden_chip(cur, account_id):
    """The oldest AVAILABLE chip, or None -> (chip_id, value)."""
    cur.execute("""SELECT chip_id, value FROM golden_chips
                   WHERE account_id = ? AND status = 'AVAILABLE'
                   ORDER BY awarded_at LIMIT 1""", [account_id])
    row = cur.fetchone()
    return (row[0], float(row[1])) if row else None


def consume_golden_chip(cur, chip_id, round_id):
    cur.execute("""UPDATE golden_chips SET status = 'USED', used_at = ?, used_round_id = ?
                   WHERE chip_id = ? AND status = 'AVAILABLE'""",
                [now(), round_id, chip_id])


def golden_winnings(stake, payout):
    """THE golden-chip rule, in one place (REQ-GC-3): the chip is never
    returned — a winning round pays winnings only; a push pays nothing."""
    return round(max(float(payout) - float(stake), 0.0), 2)


# ============================ CASINO GAMES =================================
SLOT_SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣"]
SLOT_WEIGHTS = [32, 26, 18, 12, 8, 4]
SLOT_PAYS = {"🍒": 4, "🍋": 5, "🔔": 8, "⭐": 10, "💎": 15, "7️⃣": 25}


def play_slots(stake):
    reels = random.choices(SLOT_SYMBOLS, weights=SLOT_WEIGHTS, k=3)
    if reels[0] == reels[1] == reels[2]:
        mult = SLOT_PAYS[reels[0]]
    elif reels.count("🍒") == 2:
        mult = 1.5
    else:
        mult = 0
    return reels, round(stake * mult, 2)


# ---- cards (blackjack + poker) ----
RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
SUITS = ["♠", "♥", "♦", "♣"]


def new_deck():
    deck = [r + s for r in RANKS for s in SUITS]
    random.shuffle(deck)
    return deck


def bj_value(hand):
    total, aces = 0, 0
    for card in hand:
        r = card[:-1]
        if r == "A":
            total, aces = total + 11, aces + 1
        elif r in ("K", "Q", "J", "10"):
            total += 10
        else:
            total += int(r)
    while total > 21 and aces:
        total, aces = total - 10, aces - 1
    return total


def bj_dealer_play(deck, dealer):
    while bj_value(dealer) < 17:
        dealer.append(deck.pop())
    return dealer


def bj_settle(stake, player, dealer):
    """-> (payout, outcome_text). Blackjack pays 3:2, push refunds."""
    pv, dv = bj_value(player), bj_value(dealer)
    if pv > 21:
        return 0.0, "Bust — house wins"
    player_bj = pv == 21 and len(player) == 2
    dealer_bj = dv == 21 and len(dealer) == 2
    if player_bj and not dealer_bj:
        return round(stake * 2.5, 2), "Blackjack! Pays 3:2"
    if dv > 21:
        return round(stake * 2, 2), "Dealer busts — you win"
    if pv > dv:
        return round(stake * 2, 2), "You win"
    if pv == dv:
        return float(stake), "Push — stake returned"
    return 0.0, "Dealer wins"


POKER_HANDS = ["High card", "Pair", "Two pair", "Three of a kind", "Straight",
               "Flush", "Full house", "Four of a kind", "Straight flush"]


def poker_rank(hand):
    """Classic 5-card ranking -> (category, tiebreakers...)."""
    vals = sorted((RANKS.index(c[:-1]) + 2 for c in hand), reverse=True)
    suits = [c[-1] for c in hand]
    flush = len(set(suits)) == 1
    straight = vals == list(range(vals[0], vals[0] - 5, -1))
    if vals == [14, 5, 4, 3, 2]:                      # A-2-3-4-5 wheel
        straight, vals = True, [5, 4, 3, 2, 1]
    counts = sorted(((vals.count(v), v) for v in set(vals)), reverse=True)
    shape = [c for c, _ in counts]
    key = [v for _, v in counts]
    if straight and flush:
        return (8, vals)
    if shape[0] == 4:
        return (7, key)
    if shape[:2] == [3, 2]:
        return (6, key)
    if flush:
        return (5, vals)
    if straight:
        return (4, vals)
    if shape[0] == 3:
        return (3, key)
    if shape[:2] == [2, 2]:
        return (2, key)
    if shape[0] == 2:
        return (1, key)
    return (0, vals)


def play_poker(stake):
    """Heads-up 5-card showdown vs the house: win pays 2x, tie pushes."""
    deck = new_deck()
    player, house = deck[:5], deck[5:10]
    pr, hr = poker_rank(player), poker_rank(house)
    if pr > hr:
        payout, text = round(stake * 2, 2), f"You win — {POKER_HANDS[pr[0]]} beats {POKER_HANDS[hr[0]]}"
    elif pr == hr:
        payout, text = float(stake), "Dead heat — stake returned"
    else:
        payout, text = 0.0, f"House wins — {POKER_HANDS[hr[0]]} beats {POKER_HANDS[pr[0]]}"
    return player, house, payout, text
