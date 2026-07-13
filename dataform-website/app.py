# ============================================================================
# BetNova — a FICTITIOUS online gaming website for architecture demos.
#
#   python app.py           -> http://127.0.0.1:5001
#
# No real money, no real odds, no real brand. Its purpose is to generate
# realistic operator OLTP data (the same shapes the reporting pipeline's
# cdc_* landing tables capture) so an audience can watch the regulatory
# reporting architecture work end to end. Single-user local demo.
# ============================================================================
import os
from datetime import datetime, timezone
from functools import wraps
from flask import (Flask, render_template, request, redirect, url_for,
                   session, flash, g, send_from_directory)
from werkzeug.security import generate_password_hash, check_password_hash

import db
import engine
import reconciliation as recon
import submission
from db import next_id, now

app = Flask(__name__)
app.secret_key = "betnova-demo-only-not-a-secret"   # local demo — fine


# ---- per-request plumbing -------------------------------------------------
@app.before_request
def before():
    g.cur = db.cursor()
    engine.settle_due(g.cur)          # demo-speed settlement, no threads
    engine.top_up_fixtures(g.cur)     # home page never runs dry
    g.session_id = None
    if session.get("account_id"):
        g.cur.execute("UPDATE accounts SET last_seen = ? WHERE account_id = ?",
                      [now(), session["account_id"]])
        # gaming session: touch on activity; a gap beyond the timeout ends
        # the stale session (INACTIVITY) and mints a new one.
        # REQ: requirements/operator-jackpots (REQ-OJ-1)
        g.session_id = engine.ensure_gaming_session(
            g.cur, session["account_id"], session.get("gs"))
        session["gs"] = g.session_id


@app.teardown_request
def teardown(exc):
    cur = g.pop("cur", None)
    if cur is not None:
        cur.close()


def current_user():
    if not session.get("account_id"):
        return None
    g.cur.execute("SELECT account_id, username, jurisdiction, kyc_status, is_admin FROM accounts WHERE account_id = ?",
                  [session["account_id"]])
    row = g.cur.fetchone()
    if row is None:
        return None
    return {"account_id": row[0], "username": row[1], "jurisdiction": row[2],
            "kyc_status": row[3], "is_admin": bool(row[4])}


@app.context_processor
def inject_user():
    user = current_user()
    bal = db.balance(g.cur, user["account_id"]) if user and not user["is_admin"] else None
    return {"user": user, "wallet_balance": bal, "jurisdictions": engine.JURISDICTIONS}


def login_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if not current_user():
            flash("Please log in first.", "warn")
            return redirect(url_for("login"))
        return fn(*a, **kw)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        user = current_user()
        if not user or not user["is_admin"]:
            flash("Admin access required.", "error")
            return redirect(url_for("home"))
        return fn(*a, **kw)
    return wrapper


# ---- public / home ----------------------------------------------------------
@app.route("/")
def home():
    fixtures = engine.open_fixtures(g.cur)
    sports = {}
    for f in fixtures:
        sports.setdefault(f[1], []).append(f)
    return render_template("home.html", sports=sports)


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        f = request.form
        username = f.get("username", "").strip()
        if not username or not f.get("password"):
            flash("Username and password are required.", "error")
        elif not f.get("accept_terms"):
            flash("You must accept the (fictitious) terms and conditions.", "error")
        else:
            g.cur.execute("SELECT 1 FROM accounts WHERE username = ?", [username])
            if g.cur.fetchone():
                flash("That username is taken.", "error")
            else:
                aid = next_id(g.cur, "account", "W")
                # date_of_birth: REQ requirements/max-stake-limits (age-banded caps)
                g.cur.execute(
                    "INSERT INTO accounts VALUES (?, ?, ?, ?, ?, ?, 'PENDING', FALSE, ?, ?)",
                    [aid, username, generate_password_hash(f["password"]),
                     f.get("jurisdiction", "MT"), f.get("national_id") or None,
                     f.get("date_of_birth") or "1990-01-01", now(), now()])
                g.cur.execute("INSERT INTO terms_acceptances VALUES (?, ?, ?)",
                              [aid, engine.TERMS_VERSION, now()])
                vid = next_id(g.cur, "verification", "V")
                g.cur.execute("INSERT INTO verifications VALUES (?, ?, 'IDENTITY', 'PENDING', ?)",
                              [vid, aid, now()])
                session["account_id"] = aid
                session["gs"] = engine.start_gaming_session(g.cur, aid)
                flash(f"Welcome to BetNova, {username}! Your account is {aid}. "
                      "Verify your identity to enable withdrawals.", "ok")
                return redirect(url_for("account"))
    return render_template("register.html", terms_version=engine.TERMS_VERSION)


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        g.cur.execute("SELECT account_id, password_hash FROM accounts WHERE username = ?",
                      [request.form.get("username", "").strip()])
        row = g.cur.fetchone()
        if row and check_password_hash(row[1], request.form.get("password", "")):
            session["account_id"] = row[0]
            # login mints a gaming session (REQ: requirements/operator-jackpots)
            session["gs"] = engine.start_gaming_session(g.cur, row[0])
            flash(f"Logged in — gaming session {session['gs']}.", "ok")
            return redirect(url_for("home"))
        flash("Invalid username or password.", "error")
    return render_template("login.html")


@app.route("/logout")
def logout():
    if session.get("gs"):
        engine.end_gaming_session(g.cur, session["gs"], "LOGOUT")
    session.clear()
    flash("Logged out.", "ok")
    return redirect(url_for("home"))


# ---- account: details, address, payment method, limits, KYC ---------------
@app.route("/account")
@login_required
def account():
    user = current_user()
    aid = user["account_id"]
    g.cur.execute("SELECT street, city, postcode FROM account_addresses WHERE account_id = ?", [aid])
    address = g.cur.fetchone()
    g.cur.execute("SELECT method, card_last4 FROM payment_methods WHERE account_id = ?", [aid])
    paymeth = g.cur.fetchone()
    g.cur.execute("""SELECT limit_id, limit_type, amount FROM player_limits
                     WHERE account_id = ? AND revoked_at IS NULL ORDER BY limit_type""", [aid])
    limits = g.cur.fetchall()
    exclusion = engine.active_exclusion(g.cur, aid)
    g.cur.execute("""SELECT payment_id, direction, amount, status, reason, requested_ts
                     FROM payments WHERE account_id = ? ORDER BY requested_ts DESC LIMIT 15""", [aid])
    payments = g.cur.fetchall()
    g.cur.execute("""SELECT chip_id, value, reason, status, awarded_at FROM golden_chips
                     WHERE account_id = ? ORDER BY awarded_at DESC LIMIT 10""", [aid])
    chips = g.cur.fetchall()
    return render_template("account.html", address=address, paymeth=paymeth,
                           limits=limits, exclusion=exclusion, payments=payments, chips=chips,
                           promo=engine.DEPOSIT_PROMO,
                           jackpot_opted=engine.is_opted_in(g.cur, aid),
                           jackpot_pool=engine.jackpot_pool(g.cur),
                           jackpot_cfg=engine.OPERATOR_JACKPOT,
                           postcode_hint=engine.JURISDICTIONS[user["jurisdiction"]]["postcode_hint"])


@app.route("/jackpot/opt-in", methods=["POST"])
@login_required
def jackpot_opt_in():
    """REQ: requirements/operator-jackpots (REQ-OJ-3)."""
    aid = current_user()["account_id"]
    engine.opt_in_jackpot(g.cur, aid)
    rate = engine.OPERATOR_JACKPOT["contribution_rate"] * 100
    flash(f"Opted in to the OPERATOR JACKPOT: {rate:.0f}% of every cash casino "
          "stake joins the pool, and every play could win the whole pot.", "ok")
    return redirect(url_for("account"))


@app.route("/jackpot/opt-out", methods=["POST"])
@login_required
def jackpot_opt_out():
    engine.opt_out_jackpot(g.cur, current_user()["account_id"])
    flash("Opted out of the operator jackpot — no further contributions.", "ok")
    return redirect(url_for("account"))


@app.route("/account/address", methods=["POST"])
@login_required
def save_address():
    aid = current_user()["account_id"]
    f = request.form
    g.cur.execute("DELETE FROM account_addresses WHERE account_id = ?", [aid])
    g.cur.execute("INSERT INTO account_addresses VALUES (?, ?, ?, ?, ?)",
                  [aid, f.get("street"), f.get("city"), f.get("postcode"), now()])
    flash("Address saved. (The reporting pipeline validates this postcode's "
          "format per market — a bad one becomes a DATA exception there, not a crash.)", "ok")
    return redirect(url_for("account"))


@app.route("/account/payment-method", methods=["POST"])
@login_required
def save_payment_method():
    aid = current_user()["account_id"]
    card = request.form.get("card_number", "").replace(" ", "")
    g.cur.execute("DELETE FROM payment_methods WHERE account_id = ?", [aid])
    g.cur.execute("INSERT INTO payment_methods VALUES (?, ?, ?, ?)",
                  [aid, request.form.get("method", "CARD"), card[-4:] if card else None, now()])
    flash("Payment method saved (fictitious — nothing is charged, ever).", "ok")
    return redirect(url_for("account"))


@app.route("/account/limits", methods=["POST"])
@login_required
def save_limit():
    aid = current_user()["account_id"]
    ltype = request.form.get("limit_type")
    try:
        amount = float(request.form.get("amount", ""))
    except ValueError:
        flash("Enter a numeric limit amount.", "error")
        return redirect(url_for("account"))
    # supersede any active limit of the same type (same lifecycle as the pipeline)
    g.cur.execute("""UPDATE player_limits SET revoked_at = ?
                     WHERE account_id = ? AND limit_type = ? AND revoked_at IS NULL""",
                  [now(), aid, ltype])
    lid = next_id(g.cur, "limit", "L")
    g.cur.execute("INSERT INTO player_limits VALUES (?, ?, ?, ?, ?, NULL)",
                  [lid, aid, ltype, amount, now()])
    flash(f"{ltype.replace('_', ' ').title()} limit set to {amount:.2f}.", "ok")
    return redirect(url_for("account"))


@app.route("/account/verify", methods=["POST"])
@login_required
def verify_identity():
    aid = current_user()["account_id"]
    vid = next_id(g.cur, "verification", "V")
    g.cur.execute("INSERT INTO verifications VALUES (?, ?, 'IDENTITY', 'VERIFIED', ?)", [vid, aid, now()])
    g.cur.execute("UPDATE accounts SET kyc_status = 'VERIFIED' WHERE account_id = ?", [aid])
    flash("Identity verified (simulated document check). Withdrawals are now enabled.", "ok")
    return redirect(url_for("account"))


# ---- wallet ----------------------------------------------------------------
@app.route("/wallet", methods=["GET"])
@login_required
def wallet():
    return redirect(url_for("account"))


@app.route("/deposit", methods=["POST"])
@login_required
def deposit():
    user = current_user()
    aid = user["account_id"]
    try:
        amount = float(request.form.get("amount", ""))
    except ValueError:
        flash("Enter a numeric deposit amount.", "error")
        return redirect(url_for("account"))
    pid = next_id(g.cur, "payment", "P")
    excl = engine.active_exclusion(g.cur, aid)
    block = engine.deposit_limit_block(g.cur, aid, amount) if amount > 0 else "invalid amount"
    if excl:
        g.cur.execute("INSERT INTO payments VALUES (?, ?, 'DEPOSIT', ?, 'CARD', 'FAILED', ?, ?, NULL)",
                      [pid, aid, amount, f"blocked: self-excluded ({excl})", now()])
        flash("Deposit BLOCKED: your account is self-excluded. "
              "(In the pipeline, a completed deposit here would be a compliance breach — "
              "the platform correctly refuses it.)", "error")
    elif block:
        g.cur.execute("INSERT INTO payments VALUES (?, ?, 'DEPOSIT', ?, 'CARD', 'FAILED', ?, ?, NULL)",
                      [pid, aid, amount, f"blocked: {block}", now()])
        flash(f"Deposit BLOCKED: it {block}.", "error")
    else:
        g.cur.execute("INSERT INTO payments VALUES (?, ?, 'DEPOSIT', ?, 'CARD', 'COMPLETED', NULL, ?, ?)",
                      [pid, aid, amount, now(), now()])
        flash(f"Deposited {amount:.2f} (fictitious funds).", "ok")
        # the homepage deal, for real: a golden chip for qualifying deposits
        # REQ: requirements/golden-chips (REQ-GC-1)
        if amount >= engine.DEPOSIT_PROMO["min_deposit"]:
            chip_value = engine.DEPOSIT_PROMO["chip_value"]
            engine.award_golden_chip(g.cur, aid, chip_value, "deposit promotion")
            flash(f"Promotion: a {chip_value:.2f} GOLDEN CHIP was added to your account — "
                  "play it on blackjack or poker; winnings (only) come back as cash.", "ok")
    return redirect(url_for("account"))


@app.route("/withdraw", methods=["POST"])
@login_required
def withdraw():
    user = current_user()
    aid = user["account_id"]
    try:
        amount = float(request.form.get("amount", ""))
    except ValueError:
        flash("Enter a numeric withdrawal amount.", "error")
        return redirect(url_for("account"))
    if amount <= 0 or amount > db.balance(g.cur, aid):
        flash("Withdrawal exceeds your balance.", "error")
        return redirect(url_for("account"))
    pid = next_id(g.cur, "payment", "P")
    if user["kyc_status"] != "VERIFIED":
        g.cur.execute("INSERT INTO payments VALUES (?, ?, 'WITHDRAWAL', ?, 'BANK', 'REQUESTED', ?, ?, NULL)",
                      [pid, aid, amount, "held: identity not verified (KYC)", now()])
        flash("Withdrawal HELD at REQUESTED — identity not verified. "
              "(A completed withdrawal without KYC would breach the pipeline's "
              "unverified-withdrawal detector; the platform holds it instead.)", "warn")
    else:
        g.cur.execute("INSERT INTO payments VALUES (?, ?, 'WITHDRAWAL', ?, 'BANK', 'COMPLETED', NULL, ?, ?)",
                      [pid, aid, amount, now(), now()])
        flash(f"Withdrew {amount:.2f} (fictitious funds).", "ok")
    return redirect(url_for("account"))


# ---- sports betting ---------------------------------------------------------
@app.route("/bet", methods=["POST"])
@login_required
def place_bet():
    user = current_user()
    aid = user["account_id"]
    fid = request.form.get("fixture_id")
    selection = request.form.get("selection")
    try:
        stake = float(request.form.get("stake", ""))
    except ValueError:
        flash("Enter a numeric stake.", "error")
        return redirect(url_for("home"))

    g.cur.execute("SELECT status FROM fixtures WHERE fixture_id = ?", [fid])
    row = g.cur.fetchone()
    if not row or row[0] != "OPEN":
        flash("That market has closed.", "error")
        return redirect(url_for("home"))
    g.cur.execute("SELECT odds FROM fixture_odds WHERE fixture_id = ? AND selection = ?", [fid, selection])
    orow = g.cur.fetchone()
    if not orow:
        flash("Unknown selection.", "error")
        return redirect(url_for("home"))

    err = engine.stake_gate(g.cur, aid, stake)
    if err:
        flash(err, "error")
        return redirect(url_for("home"))

    odds = float(orow[0])
    slip_id = next_id(g.cur, "slip", "S")
    g.cur.execute("INSERT INTO bet_slips VALUES (?, ?, ?, ?, ?, 'sports', ?)",
                  [slip_id, aid, fid, selection, odds, now()])
    g.cur.execute("INSERT INTO bet_slip_events VALUES (?, 'PLACED', ?, ?, NULL, NULL)",
                  [slip_id, now(), stake])
    # demo speed: first bet arms the fixture to settle shortly
    g.cur.execute("""UPDATE fixtures SET settle_at = ?
                     WHERE fixture_id = ? AND settle_at IS NULL""",
                  [now() + __import__("datetime").timedelta(seconds=engine.SETTLE_SECONDS), fid])
    flash(f"Bet {slip_id} placed: {stake:.2f} @ {odds:.2f}. The event settles in about "
          f"{engine.SETTLE_SECONDS} seconds — watch My Bets.", "ok")
    return redirect(url_for("my_bets"))


@app.route("/bets")
@login_required
def my_bets():
    aid = current_user()["account_id"]
    g.cur.execute("""
        SELECT b.slip_id, f.sport, f.home, f.away, b.selection, b.odds,
               p.stake,
               CASE WHEN v.slip_id IS NOT NULL THEN 'VOIDED'
                    WHEN s.slip_id IS NOT NULL THEN 'SETTLED' ELSE 'OPEN' END AS status,
               COALESCE(s.payout, 0) AS payout, v.reason, f.result, b.created_at
        FROM bet_slips b
        JOIN fixtures f USING (fixture_id)
        JOIN bet_slip_events p ON p.slip_id = b.slip_id AND p.event_type = 'PLACED'
        LEFT JOIN bet_slip_events s ON s.slip_id = b.slip_id AND s.event_type = 'SETTLED'
        LEFT JOIN bet_slip_events v ON v.slip_id = b.slip_id AND v.event_type = 'VOIDED'
        WHERE b.account_id = ?
        ORDER BY b.created_at DESC""", [aid])
    return render_template("bets.html", bets=g.cur.fetchall())


# ---- casino -----------------------------------------------------------------
@app.route("/casino")
@login_required
def casino():
    return render_template("casino.html",
                           jackpot_pool=engine.jackpot_pool(g.cur),
                           jackpot_opted=engine.is_opted_in(g.cur, current_user()["account_id"]))


def _record_round(aid, game, stake, payout, detail, funding="CASH"):
    rid = next_id(g.cur, "round", "R")
    # every play carries its gaming session (REQ: requirements/operator-jackpots, OJ-2)
    g.cur.execute("INSERT INTO game_rounds VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                  [rid, aid, game, stake, payout, funding, g.session_id, detail, now()])
    return rid


def _jackpot_after_play(aid, stake, funding):
    """Operator-jackpot hook, run after every casino round.
    REQ: requirements/operator-jackpots (REQ-OJ-4/5/7)."""
    win = engine.operator_jackpot_play(
        g.cur, aid, g.session_id, stake, funding,
        lambda game, s, p, detail: _record_round(aid, game, s, p, detail))
    if win is not None:
        flash(f"🎰 OPERATOR JACKPOT! You won EUR {win:,.2f} — "
              "added to your balance right now.", "jackpot")


@app.route("/casino/slots", methods=["GET", "POST"])
@login_required
def slots():
    result = None
    if request.method == "POST":
        aid = current_user()["account_id"]
        try:
            stake = float(request.form.get("stake", ""))
        except ValueError:
            stake = -1
        err = engine.stake_gate(g.cur, aid, stake, casino_game="SLOTS")
        if err:
            flash(err, "error")
        else:
            reels, payout = engine.play_slots(stake)
            _record_round(aid, "SLOTS", stake, payout, "".join(reels))
            _jackpot_after_play(aid, stake, "CASH")
            result = {"reels": reels, "payout": payout, "stake": stake}
    return render_template("slots.html", result=result)


@app.route("/casino/blackjack", methods=["GET", "POST"])
@login_required
def blackjack():
    aid = current_user()["account_id"]
    state = session.get("bj")
    if request.method == "POST":
        action = request.form.get("action")
        if action == "deal":
            # golden-chip play: the chip's value IS the stake, no cash moves
            # REQ: requirements/golden-chips (REQ-GC-2/3)
            chip = None
            if request.form.get("use_chip"):
                chip = engine.available_golden_chip(g.cur, aid)
                if not chip:
                    flash("No golden chip available.", "error")
                    return redirect(url_for("blackjack"))
                stake = chip[1]
            else:
                try:
                    stake = float(request.form.get("stake", ""))
                except ValueError:
                    stake = -1
            err = engine.stake_gate(g.cur, aid, stake, casino_game="BLACKJACK",
                                    golden=bool(chip))
            if err:
                flash(err, "error")
            else:
                deck = engine.new_deck()
                state = {"deck": deck, "player": [deck.pop(), deck.pop()],
                         "dealer": [deck.pop(), deck.pop()], "stake": stake,
                         "chip_id": chip[0] if chip else None}
                if engine.bj_value(state["player"]) == 21:      # instant blackjack
                    return _bj_finish(aid, state)
                session["bj"] = state
        elif state and action == "hit":
            state["player"].append(state["deck"].pop())
            if engine.bj_value(state["player"]) >= 21:
                return _bj_finish(aid, state)
            session["bj"] = state
        elif state and action == "stand":
            return _bj_finish(aid, state)
    return render_template("blackjack.html", state=state,
                           value=engine.bj_value(state["player"]) if state else None,
                           chip=engine.available_golden_chip(g.cur, aid))


def _bj_finish(aid, state):
    engine.bj_dealer_play(state["deck"], state["dealer"])
    payout, text = engine.bj_settle(state["stake"], state["player"], state["dealer"])
    golden = bool(state.get("chip_id"))
    if golden:
        # winnings only — the chip is consumed win, lose or push (REQ-GC-3)
        payout = engine.golden_winnings(state["stake"], payout)
        text += f" - GOLDEN CHIP: winnings only ({payout:.2f} cash), chip consumed"
    rid = _record_round(aid, "BLACKJACK", state["stake"], payout,
                        f"P:{'/'.join(state['player'])} D:{'/'.join(state['dealer'])}",
                        funding="GOLDEN_CHIP" if golden else "CASH")
    if golden:
        engine.consume_golden_chip(g.cur, state["chip_id"], rid)
    _jackpot_after_play(aid, state["stake"], "GOLDEN_CHIP" if golden else "CASH")
    session.pop("bj", None)
    return render_template("blackjack.html", state=None, value=None,
                           chip=engine.available_golden_chip(g.cur, aid),
                           done={"player": state["player"], "dealer": state["dealer"],
                                 "payout": payout, "text": text, "stake": state["stake"]})


@app.route("/casino/poker", methods=["GET", "POST"])
@login_required
def poker():
    aid = current_user()["account_id"]
    result = None
    if request.method == "POST":
        chip = None
        if request.form.get("use_chip"):     # REQ: requirements/golden-chips
            chip = engine.available_golden_chip(g.cur, aid)
            if not chip:
                flash("No golden chip available.", "error")
                return redirect(url_for("poker"))
            stake = chip[1]
        else:
            try:
                stake = float(request.form.get("stake", ""))
            except ValueError:
                stake = -1
        err = engine.stake_gate(g.cur, aid, stake, casino_game="POKER", golden=bool(chip))
        if err:
            flash(err, "error")
        else:
            player, house, payout, text = engine.play_poker(stake)
            if chip:
                payout = engine.golden_winnings(stake, payout)
                text += f" - GOLDEN CHIP: winnings only ({payout:.2f} cash), chip consumed"
            rid = _record_round(aid, "POKER", stake, payout,
                                f"P:{'/'.join(player)} H:{'/'.join(house)}",
                                funding="GOLDEN_CHIP" if chip else "CASH")
            if chip:
                engine.consume_golden_chip(g.cur, chip[0], rid)
            _jackpot_after_play(aid, stake, "GOLDEN_CHIP" if chip else "CASH")
            result = {"player": player, "house": house, "payout": payout,
                      "text": text, "stake": stake}
    return render_template("poker.html", result=result,
                           chip=engine.available_golden_chip(g.cur, aid))


# ---- admin / customer services ---------------------------------------------
@app.route("/admin")
@admin_required
def admin():
    c = g.cur
    c.execute("SELECT COUNT(*) FROM accounts WHERE NOT is_admin")
    players = c.fetchone()[0]
    c.execute("""SELECT COUNT(*) FROM bet_slips b
                 WHERE NOT EXISTS (SELECT 1 FROM bet_slip_events e
                   WHERE e.slip_id = b.slip_id AND e.event_type IN ('SETTLED','VOIDED'))""")
    open_bets = c.fetchone()[0]
    c.execute("""SELECT COALESCE(SUM(amount),0) FROM payments
                 WHERE direction='DEPOSIT' AND status='COMPLETED' AND completed_ts >= ?""",
              [now() - __import__("datetime").timedelta(days=1)])
    deposits24 = float(c.fetchone()[0])
    # in-flight: open slips, oldest first (what a demonstrator shows live)
    c.execute("""
        SELECT b.slip_id, a.username, f.home, f.away, b.selection, b.odds, p.stake,
               b.created_at, f.settle_at
        FROM bet_slips b
        JOIN accounts a USING (account_id)
        JOIN fixtures f USING (fixture_id)
        JOIN bet_slip_events p ON p.slip_id = b.slip_id AND p.event_type = 'PLACED'
        WHERE NOT EXISTS (SELECT 1 FROM bet_slip_events e
          WHERE e.slip_id = b.slip_id AND e.event_type IN ('SETTLED','VOIDED'))
        ORDER BY b.created_at""")
    inflight = c.fetchall()
    # online = seen in the last 5 minutes
    c.execute("""SELECT account_id, username, jurisdiction, last_seen FROM accounts
                 WHERE NOT is_admin AND last_seen >= ? ORDER BY last_seen DESC""",
              [now() - __import__("datetime").timedelta(minutes=5)])
    online = c.fetchall()
    c.execute("""SELECT payment_id, account_id, direction, amount, status, reason, requested_ts
                 FROM payments ORDER BY requested_ts DESC LIMIT 12""")
    recent_payments = c.fetchall()
    c.execute("""SELECT fixture_id, sport, home, away, settle_at FROM fixtures
                 WHERE status = 'OPEN' AND settle_at IS NOT NULL ORDER BY settle_at""")
    arming = c.fetchall()
    # regulator SAFE feed: latest submissions + per-market/type counts
    c.execute("""SELECT jurisdiction, record_type, COUNT(*) FROM safe_submissions
                 WHERE receipt_id != 'SUPPRESSED-VOID'
                 GROUP BY 1, 2 ORDER BY 1, 2""")
    safe_counts = c.fetchall()
    c.execute("""SELECT record_type, record_key, jurisdiction, receipt_id, submitted_at
                 FROM safe_submissions WHERE receipt_id != 'SUPPRESSED-VOID'
                 ORDER BY submitted_at DESC LIMIT 12""")
    safe_recent = c.fetchall()
    return render_template("admin/dashboard.html", players=players, open_bets=open_bets,
                           deposits24=deposits24, inflight=inflight, online=online,
                           recent_payments=recent_payments, arming=arming,
                           safe_counts=safe_counts, safe_recent=safe_recent)


@app.route("/admin/players")
@admin_required
def admin_players():
    g.cur.execute("""SELECT account_id, username, jurisdiction, kyc_status, opened_at, last_seen
                     FROM accounts WHERE NOT is_admin ORDER BY account_id""")
    rows = g.cur.fetchall()
    players = [(r + (db.balance(g.cur, r[0]),)) for r in rows]
    return render_template("admin/players.html", players=players)


@app.route("/admin/player/<account_id>")
@admin_required
def admin_player(account_id):
    c = g.cur
    c.execute("""SELECT account_id, username, jurisdiction, national_id, kyc_status, opened_at
                 FROM accounts WHERE account_id = ?""", [account_id])
    acct = c.fetchone()
    if not acct:
        flash("No such account.", "error")
        return redirect(url_for("admin_players"))
    c.execute("SELECT street, city, postcode FROM account_addresses WHERE account_id = ?", [account_id])
    address = c.fetchone()
    c.execute("""SELECT limit_type, amount FROM player_limits
                 WHERE account_id = ? AND revoked_at IS NULL""", [account_id])
    limits = c.fetchall()
    exclusion = engine.active_exclusion(c, account_id)
    c.execute("""
        SELECT b.slip_id, f.home, f.away, b.selection, b.odds, p.stake,
               CASE WHEN v.slip_id IS NOT NULL THEN 'VOIDED'
                    WHEN s.slip_id IS NOT NULL THEN 'SETTLED' ELSE 'OPEN' END,
               COALESCE(s.payout, 0), b.created_at
        FROM bet_slips b JOIN fixtures f USING (fixture_id)
        JOIN bet_slip_events p ON p.slip_id = b.slip_id AND p.event_type = 'PLACED'
        LEFT JOIN bet_slip_events s ON s.slip_id = b.slip_id AND s.event_type = 'SETTLED'
        LEFT JOIN bet_slip_events v ON v.slip_id = b.slip_id AND v.event_type = 'VOIDED'
        WHERE b.account_id = ? ORDER BY b.created_at DESC""", [account_id])
    bets = c.fetchall()
    c.execute("""SELECT payment_id, direction, amount, status, reason, requested_ts
                 FROM payments WHERE account_id = ? ORDER BY requested_ts DESC""", [account_id])
    payments = c.fetchall()
    c.execute("""SELECT round_id, game, stake, payout, funding, detail, round_ts
                 FROM game_rounds WHERE account_id = ? ORDER BY round_ts DESC LIMIT 25""", [account_id])
    rounds = c.fetchall()
    c.execute("""SELECT chip_id, value, reason, status, awarded_at FROM golden_chips
                 WHERE account_id = ? ORDER BY awarded_at DESC LIMIT 15""", [account_id])
    chips = c.fetchall()
    c.execute("""SELECT session_id, started_at, last_activity_ts, ended_at, end_reason
                 FROM gaming_sessions WHERE account_id = ?
                 ORDER BY started_at DESC LIMIT 10""", [account_id])
    sessions = c.fetchall()
    return render_template("admin/player.html", acct=acct, address=address, limits=limits,
                           exclusion=exclusion, bets=bets, payments=payments, rounds=rounds,
                           chips=chips, sessions=sessions,
                           jackpot_opted=engine.is_opted_in(c, account_id),
                           bal=db.balance(c, account_id))


@app.route("/admin/award-chip/<account_id>", methods=["POST"])
@admin_required
def admin_award_chip(account_id):
    """Customer-services golden chip award. REQ: requirements/golden-chips (GC-1)."""
    try:
        value = float(request.form.get("value", ""))
        assert 0 < value <= 100
    except (ValueError, AssertionError):
        flash("Chip value must be a number between 0 and 100.", "error")
        return redirect(url_for("admin_player", account_id=account_id))
    chip_id = engine.award_golden_chip(g.cur, account_id, value, "customer services award")
    flash(f"Golden chip {chip_id} ({value:.2f}) awarded to {account_id}.", "ok")
    return redirect(url_for("admin_player", account_id=account_id))


@app.route("/admin/verify/<account_id>", methods=["POST"])
@admin_required
def admin_verify(account_id):
    vid = next_id(g.cur, "verification", "V")
    g.cur.execute("INSERT INTO verifications VALUES (?, ?, 'IDENTITY', 'VERIFIED', ?)",
                  [vid, account_id, now()])
    g.cur.execute("UPDATE accounts SET kyc_status = 'VERIFIED' WHERE account_id = ?", [account_id])
    flash(f"{account_id} verified by customer services.", "ok")
    return redirect(url_for("admin_player", account_id=account_id))


@app.route("/admin/exclude/<account_id>", methods=["POST"])
@admin_required
def admin_exclude(account_id):
    if engine.active_exclusion(g.cur, account_id):
        g.cur.execute("""UPDATE self_exclusions SET end_ts = ?
                         WHERE account_id = ? AND (end_ts IS NULL OR end_ts > ?)""",
                      [now(), account_id, now()])
        flash(f"{account_id}'s exclusion ended.", "ok")
    else:
        xid = next_id(g.cur, "exclusion", "X")
        g.cur.execute("INSERT INTO self_exclusions VALUES (?, ?, 'OPERATOR', ?, NULL)",
                      [xid, account_id, now()])
        flash(f"{account_id} self-excluded (operator source). Deposits and wagers now block.", "ok")
    return redirect(url_for("admin_player", account_id=account_id))


@app.route("/admin/void/<slip_id>", methods=["POST"])
@admin_required
def admin_void(slip_id):
    g.cur.execute("SELECT account_id FROM bet_slips WHERE slip_id = ?", [slip_id])
    row = g.cur.fetchone()
    if not row:
        flash("No such bet.", "error")
        return redirect(url_for("admin"))
    if db.slip_status(g.cur, slip_id) == "VOIDED":
        flash("Already voided.", "warn")
    else:
        g.cur.execute("INSERT INTO bet_slip_events VALUES (?, 'VOIDED', ?, NULL, NULL, ?)",
                      [slip_id, now(), "customer services adjustment"])
        flash(f"Bet {slip_id} voided — stake refunded, any payout reversed. "
              "(In the pipeline this drives the void/refund cascade.)", "ok")
    return redirect(url_for("admin_player", account_id=row[0]))


@app.route("/admin/complete-withdrawal/<payment_id>", methods=["POST"])
@admin_required
def admin_complete_withdrawal(payment_id):
    g.cur.execute("""SELECT p.account_id, a.kyc_status FROM payments p
                     JOIN accounts a USING (account_id)
                     WHERE p.payment_id = ? AND p.direction = 'WITHDRAWAL' AND p.status = 'REQUESTED'""",
                  [payment_id])
    row = g.cur.fetchone()
    if not row:
        flash("No held withdrawal with that id.", "error")
        return redirect(url_for("admin"))
    if row[1] != "VERIFIED":
        flash("Refused: the player is still unverified — completing this would be "
              "a KYC breach (the pipeline's unverified-withdrawal detector would fire).", "error")
    else:
        g.cur.execute("""UPDATE payments SET status = 'COMPLETED', completed_ts = ?, reason = NULL
                         WHERE payment_id = ?""", [now(), payment_id])
        flash(f"Withdrawal {payment_id} completed.", "ok")
    return redirect(url_for("admin_player", account_id=row[0]))


@app.route("/admin/settle/<fixture_id>", methods=["POST"])
@admin_required
def admin_settle(fixture_id):
    outcome = engine.settle_fixture(g.cur, fixture_id)
    flash(f"Fixture {fixture_id} settled now: {outcome}.", "ok")
    return redirect(url_for("admin"))


# ---- financial reconciliation (see ../financial-reconciliations.md) --------
def _recon_reports():
    """Existing generated reports: [(mkt, filename, size_kb, mtime)] newest first."""
    reports = []
    if os.path.isdir(recon.RECON_ROOT):
        for mkt in sorted(os.listdir(recon.RECON_ROOT)):
            d = os.path.join(recon.RECON_ROOT, mkt)
            if not os.path.isdir(d):
                continue
            for f in sorted(os.listdir(d)):
                if f.endswith(".pdf"):
                    p = os.path.join(d, f)
                    reports.append((mkt, f, os.path.getsize(p) // 1024,
                                    datetime.fromtimestamp(os.path.getmtime(p), timezone.utc)))
    reports.sort(key=lambda r: r[3], reverse=True)
    return reports


@app.route("/admin/reconciliation")
@admin_required
def admin_reconciliation():
    today = datetime.now(timezone.utc)
    return render_template("admin/reconciliation.html", reports=_recon_reports(),
                           default_date=today.strftime("%Y-%m-%d"),
                           default_month=today.strftime("%Y-%m"),
                           markets=list(recon.MARKETS))


@app.route("/admin/reconciliation/generate", methods=["POST"])
@admin_required
def admin_reconciliation_generate():
    period = request.form.get("period", "daily")
    only = request.form.get("jurisdiction") or None
    if only == "ALL":
        only = None
    try:
        if period == "monthly":
            year, month = map(int, request.form.get("month", "").split("-"))
            results = recon.run_monthly(g.cur, year, month, only)
        else:
            from datetime import date as date_cls
            day = date_cls.fromisoformat(request.form.get("date", ""))
            results = recon.run_daily(g.cur, day, only)
    except (ValueError, TypeError):
        flash("Enter a valid date (daily) or month (monthly).", "error")
        return redirect(url_for("admin_reconciliation"))

    if not results:
        flash("No activity in that period for the selected market(s) — nothing to reconcile.", "warn")
        return redirect(url_for("admin_reconciliation"))
    for mkt, plabel, f, checked, reported_n, breaks, ok, _out in results:
        line = (f"{mkt} {plabel}: cash GGR {f['cash_ggr']:.2f} / settlement GGR "
                f"{f['settlement_ggr']:.2f} / residual {f['residual']:.2f} / "
                f"reported {reported_n}/{checked}")
        if ok:
            flash(f"RECONCILED — {line}. PDF ready below.", "ok")
        else:
            flash(f"BREAKS FOUND — {line}. See the flagged PDF below.", "error")
    return redirect(url_for("admin_reconciliation"))


# ---- periodic regulator registers (DGOJ-style RUD/RUT) ---------------------
# On-demand trigger so a demo never waits for a period to close.
# REQ: requirements/dgoj-periodic-reporting (REQ-DGOJ-5)
@app.route("/admin/periodic")
@admin_required
def admin_periodic():
    today = datetime.now(timezone.utc)
    regs = submission.PERIODIC_REPORTS
    rtypes = sorted({r["id"].lower() for rs in regs.values() for r in rs})
    g.cur.execute(f"""SELECT record_type, record_key, jurisdiction, receipt_id, submitted_at
                      FROM safe_submissions
                      WHERE record_type IN ({",".join("?" * len(rtypes))})
                      ORDER BY submitted_at DESC LIMIT 25""", rtypes)
    filings = g.cur.fetchall()
    return render_template("admin/periodic.html", registers=regs, filings=filings,
                           default_date=today.strftime("%Y-%m-%d"),
                           default_month=today.strftime("%Y-%m"))


@app.route("/admin/periodic/generate", methods=["POST"])
@admin_required
def admin_periodic_generate():
    from datetime import date as date_cls
    mkt = request.form.get("jurisdiction", "")
    registers = submission.PERIODIC_REPORTS.get(mkt)
    if not registers:
        flash("That market files no periodic registers.", "error")
        return redirect(url_for("admin_periodic"))
    cadence = request.form.get("cadence", "daily")
    try:
        if cadence == "monthly":
            year, month = map(int, request.form.get("month", "").split("-"))
            period = date_cls(year, month, 1)
        else:
            period = date_cls.fromisoformat(request.form.get("date", ""))
    except (ValueError, TypeError):
        flash("Enter a valid day (daily) or month (monthly).", "error")
        return redirect(url_for("admin_periodic"))

    due = [r for r in registers if r["cadence"] == cadence]
    if not due:
        flash(f"{mkt} files no {cadence} register.", "warn")
        return redirect(url_for("admin_periodic"))
    filed = 0
    for reg in due:
        try:
            results = submission.submit_periodic(g.cur, mkt, reg, period)
        except Exception as exc:                      # e.g. SAFE not reachable
            flash(f"{mkt} {reg['id']}: submission failed ({exc}).", "error")
            continue
        if results:
            filed += len(results)
            receipts = ", ".join(r for _, r in results)
            flash(f"{mkt} {reg['id']} ({cadence}) for {period:%Y-%m-%d}: {len(results)} "
                  f"register row(s) filed with the SAFE — receipts {receipts}.", "ok")
    if not filed:
        flash("No settled activity in that period — nothing to file.", "warn")
    return redirect(url_for("admin_periodic"))


@app.route("/admin/reconciliation/file/<mkt>/<filename>")
@admin_required
def admin_reconciliation_file(mkt, filename):
    if mkt not in recon.MARKETS or not filename.endswith(".pdf") or "/" in filename or "\\" in filename:
        flash("No such report.", "error")
        return redirect(url_for("admin_reconciliation"))
    return send_from_directory(os.path.join(recon.RECON_ROOT, mkt), filename)


if __name__ == "__main__":
    import threading
    import safe
    import submission

    cur = db.cursor()
    db.init_schema(cur)
    cur.close()

    # The fictitious regulator SAFE (SOAP, port 5002) and the near-realtime
    # submission engine run as daemon threads: they start with the demo app
    # and stop with it. The engine shares this process's DuckDB connection
    # (via cursors) because DuckDB permits only one writer process.
    threading.Thread(target=safe.serve, daemon=True, name="safe").start()
    threading.Thread(target=submission.run_loop, daemon=True, name="submission").start()

    app.run(host="127.0.0.1", port=5001, debug=False)
