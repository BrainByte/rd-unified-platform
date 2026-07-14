# ============================================================================
# BetNova demo — FINANCIAL RECONCILIATION (daily + monthly, PDF per market).
#
#   python reconciliation.py                     # daily (today) + monthly (this month)
#   python reconciliation.py --date 2026-07-12   # daily for a specific day
#   python reconciliation.py --month 2026-07     # monthly for a specific month
#   python reconciliation.py --jurisdiction MT   # one market only
#
# Reconciles, per jurisdiction, per period (see ../financial-reconciliations.md):
#   1. CASH view (player transactions): deposits - withdrawals - movement in
#      player balance liability  =>  cash-basis GGR
#   2. SETTLEMENT view (the tax base): settled bets (stake - payout, void
#      reversals) + casino rounds  =>  settlement-basis GGR
#   3. THE BRIDGE: the two differ by exactly the movement in the unsettled-
#      stakes (open bets) liability. Any residual = UNRECONCILED (flagged).
#   4. REPORTED view (three-way): every reportable record (bets / gaming /
#      payments) must hold a SAFE receipt in safe_submissions AND its XML
#      must exist in dataform-safe/. Breaks are listed item by item.
#   5. GGR DUTY: settlement GGR x the market's effective-dated tax rate.
#
# Read-only: opens the OLTP DuckDB with read_only=True. Run while the site
# is stopped (DuckDB single-writer); in production this runs on a replica.
# Output: dataform-reconciliation/<MKT>/*.pdf (one per market per period).
# Exit code 0 = everything reconciled and fully reported; 1 = breaks found.
# ============================================================================
import argparse
import calendar
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone

import duckdb
from fpdf import FPDF

import db as dbmod
from submission import MARKETS   # per-market reporting rules (void suppression)

RECON_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                          "dataform-reconciliation")
SAFE_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "dataform-safe")

# GGR duty rates as DATA, effective-dated (mirrors the pipeline's
# jurisdictions.js — BG and NL changed rates on 2026-01-01).
TAX_RATES = {
    "MT": [{"rate": 0.05}],
    "ES": [{"rate": 0.20}],
    "DK": [{"rate": 0.28}],
    "BG": [{"rate": 0.20, "to": "2026-01-01"}, {"rate": 0.25, "from": "2026-01-01"}],
    "GR": [{"rate": 0.35}],
    "NL": [{"rate": 0.342, "to": "2026-01-01"}, {"rate": 0.378, "from": "2026-01-01"}],
    "DE": [{"rate": 0.053}],   # RennwLottG: 5.3% — of STAKES (see TAX_BASIS)
    # FR public levies on the produit brut des jeux; illustrative pending
    # pinning to primary sources. REQ: requirements/fr-new-jurisdiction (REQ-FR-3)
    "FR": [{"rate": 0.549, "to": "2025-07-01"}, {"rate": 0.593, "from": "2025-07-01"}],
    # PT IEJO on fixed-odds STAKES (turnover — see TAX_BASIS); the demo
    # recon models one basis per market, so the 25% GGR gaming duty is a
    # pipeline-side computation (declared simplification).
    # REQ: requirements/pt-new-jurisdiction (REQ-PT-3)
    "PT": [{"rate": 0.08}],
}

# The tax BASE per market (REQ: de-regulator-addition): 'ggr' (default) or
# 'turnover' — Germany taxes STAKES, not stake - payout.
TAX_BASIS = {"DE": "turnover",
             "PT": "turnover"}  # REQ: requirements/pt-new-jurisdiction (REQ-PT-3)

# How each market treats OPERATOR-FUNDED bonus stakes (golden chips) in
# taxable GGR — variance as data, mirroring the pipeline's jackpotPolicy
# (MT deducts, ES gross). REQ: requirements/golden-chips (REQ-GC-7).
#   deduct: bonus stakes excluded — a golden round contributes -winnings
#   gross:  the chip value counts as stake — contributes chip - winnings
BONUS_STAKE_POLICY = {
    "MT": "deduct", "ES": "gross", "DK": "deduct",
    "BG": "gross", "GR": "gross", "NL": "deduct",
    "DE": "gross",   # turnover regime: operator-funded stakes are taxed too
    "FR": "deduct",  # REQ: requirements/fr-new-jurisdiction (REQ-FR-3)
    "PT": "gross",   # turnover regime (REQ: requirements/pt-new-jurisdiction, REQ-PT-3)
}


def rate_for(mkt, day):
    for band in TAX_RATES.get(mkt, []):
        if band.get("from") and str(day) < band["from"]:
            continue
        if band.get("to") and str(day) >= band["to"]:
            continue
        return band["rate"]
    return 0.0


def duty_base(mkt, f):
    """The amount the duty rate applies to: GGR by default; for 'turnover'
    markets (DE), the STAKES — settled sports stakes + casino stakes
    (+ operator-funded bonus stakes, which the turnover regime taxes too)."""
    if TAX_BASIS.get(mkt) == "turnover":
        return f["settled_stakes"] + f["casino_stakes"] + f["golden_stakes"]
    return f["settlement_ggr"]


def q1(cur, sql, params):
    return cur.execute(sql, params).fetchone()


# ---- event-based money flows (the finance-correct timeline) ----------------
# Player balance liability = cumulative signed events:
#   +deposit  -withdrawal  -stake@placed  +refund/clawback@voided
#   +payout@settled  -casino stake  +casino payout  (all at their own instants)
FLOWS_SQL = """
WITH ev AS (
  SELECT p.completed_ts AS ts, p.amount AS amt, 'DEPOSIT' AS kind
  FROM payments p JOIN accounts a USING (account_id)
  WHERE a.jurisdiction = ? AND p.direction = 'DEPOSIT' AND p.status = 'COMPLETED'
  UNION ALL
  SELECT p.completed_ts, -p.amount, 'WITHDRAWAL'
  FROM payments p JOIN accounts a USING (account_id)
  WHERE a.jurisdiction = ? AND p.direction = 'WITHDRAWAL' AND p.status = 'COMPLETED'
  UNION ALL
  SELECT e.event_ts, -e.stake, 'BET_STAKE'
  FROM bet_slip_events e JOIN bet_slips b USING (slip_id) JOIN accounts a USING (account_id)
  WHERE a.jurisdiction = ? AND e.event_type = 'PLACED'
  UNION ALL
  SELECT s.event_ts, s.payout, 'BET_PAYOUT'
  FROM bet_slip_events s JOIN bet_slips b USING (slip_id) JOIN accounts a USING (account_id)
  WHERE a.jurisdiction = ? AND s.event_type = 'SETTLED' AND s.payout > 0
  UNION ALL
  -- void refund: stake back, any previously-settled payout clawed back
  SELECT v.event_ts,
         p.stake - COALESCE((SELECT s2.payout FROM bet_slip_events s2
                             WHERE s2.slip_id = v.slip_id AND s2.event_type = 'SETTLED'
                               AND s2.event_ts <= v.event_ts), 0),
         'VOID_REFUND'
  FROM bet_slip_events v
  JOIN bet_slip_events p ON p.slip_id = v.slip_id AND p.event_type = 'PLACED'
  JOIN bet_slips b ON b.slip_id = v.slip_id
  JOIN accounts a USING (account_id)
  WHERE a.jurisdiction = ? AND v.event_type = 'VOIDED'
  UNION ALL
  -- golden-chip rounds move no player cash at stake time: winnings only
  -- REQ: requirements/golden-chips (REQ-GC-4)
  SELECT r.round_ts,
         CASE WHEN r.funding = 'GOLDEN_CHIP' THEN r.payout ELSE r.payout - r.stake END,
         'CASINO_NET'
  FROM game_rounds r JOIN accounts a USING (account_id)
  WHERE a.jurisdiction = ?
)
SELECT
  COALESCE(SUM(CASE WHEN ts <  CAST(? AS TIMESTAMPTZ) THEN amt END), 0) AS opening_balance,
  COALESCE(SUM(CASE WHEN ts <  CAST(? AS TIMESTAMPTZ) THEN amt END), 0) AS closing_balance
FROM ev
"""


def period_flows(cur, mkt, start, end):
    """All the per-period money numbers for one market. start/end: '...+00' strings."""
    j6 = [mkt] * 6
    opening, closing = q1(cur, FLOWS_SQL, j6 + [start, end])

    def total(sql, params):
        return float(q1(cur, sql, params)[0] or 0)

    in_p = "AND %s >= CAST(? AS TIMESTAMPTZ) AND %s < CAST(? AS TIMESTAMPTZ)"
    deposits = total(f"""SELECT COALESCE(SUM(p.amount),0) FROM payments p
        JOIN accounts a USING (account_id)
        WHERE a.jurisdiction = ? AND p.direction='DEPOSIT' AND p.status='COMPLETED'
        {in_p % ('p.completed_ts','p.completed_ts')}""", [mkt, start, end])
    withdrawals = total(f"""SELECT COALESCE(SUM(p.amount),0) FROM payments p
        JOIN accounts a USING (account_id)
        WHERE a.jurisdiction = ? AND p.direction='WITHDRAWAL' AND p.status='COMPLETED'
        {in_p % ('p.completed_ts','p.completed_ts')}""", [mkt, start, end])

    # settlement view: settled bets in period + void reversals in period
    row = q1(cur, f"""SELECT COUNT(*), COALESCE(SUM(p.stake),0), COALESCE(SUM(s.payout),0)
        FROM bet_slip_events s
        JOIN bet_slip_events p ON p.slip_id = s.slip_id AND p.event_type='PLACED'
        JOIN bet_slips b ON b.slip_id = s.slip_id JOIN accounts a USING (account_id)
        WHERE a.jurisdiction = ? AND s.event_type='SETTLED'
        {in_p % ('s.event_ts','s.event_ts')}""", [mkt, start, end])
    settled_n, settled_stakes, settled_payouts = int(row[0]), float(row[1]), float(row[2])

    # voids in period: split refunds of open stakes vs reversals of settled GGR
    row = q1(cur, f"""SELECT COUNT(*), COALESCE(SUM(p.stake),0),
               COALESCE(SUM(CASE WHEN s.slip_id IS NOT NULL THEN p.stake - s.payout END),0)
        FROM bet_slip_events v
        JOIN bet_slip_events p ON p.slip_id = v.slip_id AND p.event_type='PLACED'
        LEFT JOIN bet_slip_events s ON s.slip_id = v.slip_id AND s.event_type='SETTLED'
             AND s.event_ts <= v.event_ts
        JOIN bet_slips b ON b.slip_id = v.slip_id JOIN accounts a USING (account_id)
        WHERE a.jurisdiction = ? AND v.event_type='VOIDED'
        {in_p % ('v.event_ts','v.event_ts')}""", [mkt, start, end])
    void_n, void_stakes, void_ggr_reversal = int(row[0]), float(row[1]), float(row[2])

    row = q1(cur, f"""SELECT COUNT(*), COALESCE(SUM(r.stake),0), COALESCE(SUM(r.payout),0)
        FROM game_rounds r JOIN accounts a USING (account_id)
        WHERE a.jurisdiction = ? AND r.funding = 'CASH'
        {in_p % ('r.round_ts','r.round_ts')}""", [mkt, start, end])
    rounds_n, casino_stakes, casino_payouts = int(row[0]), float(row[1]), float(row[2])

    # bonus-funded (golden chip) rounds — operator money staked, cash
    # winnings paid. REQ: requirements/golden-chips (REQ-GC-7)
    row = q1(cur, f"""SELECT COUNT(*), COALESCE(SUM(r.stake),0), COALESCE(SUM(r.payout),0)
        FROM game_rounds r JOIN accounts a USING (account_id)
        WHERE a.jurisdiction = ? AND r.funding = 'GOLDEN_CHIP'
        {in_p % ('r.round_ts','r.round_ts')}""", [mkt, start, end])
    golden_n, golden_stakes, golden_winnings = int(row[0]), float(row[1]), float(row[2])

    # open-bet (unsettled stakes) liability at an instant
    open_sql = """SELECT COALESCE(SUM(p.stake),0) FROM bet_slip_events p
        JOIN bet_slips b USING (slip_id) JOIN accounts a USING (account_id)
        WHERE a.jurisdiction = ? AND p.event_type='PLACED' AND p.event_ts < CAST(? AS TIMESTAMPTZ)
          AND NOT EXISTS (SELECT 1 FROM bet_slip_events t WHERE t.slip_id = p.slip_id
                          AND t.event_type IN ('SETTLED','VOIDED')
                          AND t.event_ts < CAST(? AS TIMESTAMPTZ))"""
    open_start = total(open_sql, [mkt, start, start])
    open_end = total(open_sql, [mkt, end, end])

    cash_ggr = deposits - withdrawals - (float(closing) - float(opening))
    sports_ggr = settled_stakes - settled_payouts - void_ggr_reversal
    casino_ggr = casino_stakes - casino_payouts
    # golden-chip GGR contribution per the market's bonus-stake policy
    policy = BONUS_STAKE_POLICY.get(mkt, "deduct")
    golden_ggr = (golden_stakes - golden_winnings) if policy == "gross" else -golden_winnings
    settlement_ggr = sports_ggr + casino_ggr + golden_ggr
    open_movement = open_end - open_start
    # bridge: gross markets count operator-funded chip value as revenue the
    # cash view never saw — it is the second (fully explained) bridge item
    bonus_bridge = golden_stakes if policy == "gross" else 0.0
    residual = round(cash_ggr - open_movement + bonus_bridge - settlement_ggr, 2)

    return {
        "deposits": deposits, "withdrawals": withdrawals,
        "opening_balance": float(opening), "closing_balance": float(closing),
        "cash_ggr": cash_ggr,
        "settled_n": settled_n, "settled_stakes": settled_stakes,
        "settled_payouts": settled_payouts, "sports_ggr": sports_ggr,
        "void_n": void_n, "void_stakes": void_stakes, "void_ggr_reversal": void_ggr_reversal,
        "rounds_n": rounds_n, "casino_stakes": casino_stakes,
        "casino_payouts": casino_payouts, "casino_ggr": casino_ggr,
        "golden_n": golden_n, "golden_stakes": golden_stakes,
        "golden_winnings": golden_winnings, "golden_ggr": golden_ggr,
        "bonus_policy": policy, "bonus_bridge": bonus_bridge,
        "settlement_ggr": settlement_ggr,
        "open_start": open_start, "open_end": open_end, "open_movement": open_movement,
        "residual": residual,
    }


# ---- three-way reported completeness: OLTP <-> receipts <-> SAFE XML -------
def reported_breaks(cur, mkt, start, end):
    """Every reportable record in the period must hold a receipt and its XML.
    Returns (checked, reported, breaks[])  — a break is (type, id, problem)."""
    include_voided = MARKETS[mkt]["include_voided"]
    expected = []   # (rtype, record_key, record_id)

    for (slip_id,) in cur.execute(f"""SELECT s.slip_id FROM bet_slip_events s
            JOIN bet_slips b USING (slip_id) JOIN accounts a USING (account_id)
            WHERE a.jurisdiction=? AND s.event_type='SETTLED'
              AND s.event_ts >= CAST(? AS TIMESTAMPTZ) AND s.event_ts < CAST(? AS TIMESTAMPTZ)""",
            [mkt, start, end]).fetchall():
        expected.append(("bets", f"{slip_id}|SETTLED", slip_id))
    if include_voided:
        for (slip_id,) in cur.execute(f"""SELECT v.slip_id FROM bet_slip_events v
                JOIN bet_slips b USING (slip_id) JOIN accounts a USING (account_id)
                WHERE a.jurisdiction=? AND v.event_type='VOIDED'
                  AND v.event_ts >= CAST(? AS TIMESTAMPTZ) AND v.event_ts < CAST(? AS TIMESTAMPTZ)""",
                [mkt, start, end]).fetchall():
            expected.append(("bets", f"{slip_id}|VOIDED", slip_id))
    # markets that license only some gaming verticals (FR: poker only)
    # never report the others — mirror the submission engine's suppression.
    # REQ: requirements/fr-new-jurisdiction (REQ-FR-2)
    # Markets reporting rounds VIA per-game sessions (NL) expect the
    # session records instead of individual rounds.
    # REQ: requirements/session-tracking (REQ-ST-6)
    verticals = MARKETS[mkt].get("gaming_verticals")
    smeta = MARKETS[mkt].get("sessions") or {}
    if not smeta.get("gaming_via_sessions"):
        for (round_id, game) in cur.execute(f"""SELECT r.round_id, r.game FROM game_rounds r
                JOIN accounts a USING (account_id)
                WHERE a.jurisdiction=? AND r.round_ts >= CAST(? AS TIMESTAMPTZ)
                  AND r.round_ts < CAST(? AS TIMESTAMPTZ)""", [mkt, start, end]).fetchall():
            if verticals is not None and game not in verticals:
                continue
            expected.append(("gaming", round_id, round_id))
    if smeta:
        if smeta["granularity"] == "platform":
            for (session_id,) in cur.execute(f"""SELECT s.session_id
                    FROM gaming_sessions s JOIN accounts a USING (account_id)
                    WHERE a.jurisdiction=? AND s.ended_at IS NOT NULL
                      AND s.ended_at >= CAST(? AS TIMESTAMPTZ)
                      AND s.ended_at < CAST(? AS TIMESTAMPTZ)""",
                    [mkt, start, end]).fetchall():
                expected.append(("sessions", session_id, session_id))
        else:   # per_game: one expected record per (session x game) played
            for (session_id, game) in cur.execute(f"""SELECT DISTINCT s.session_id, r.game
                    FROM gaming_sessions s
                    JOIN accounts a USING (account_id)
                    JOIN game_rounds r ON r.session_id = s.session_id
                    WHERE a.jurisdiction=? AND s.ended_at IS NOT NULL
                      AND s.ended_at >= CAST(? AS TIMESTAMPTZ)
                      AND s.ended_at < CAST(? AS TIMESTAMPTZ)""",
                    [mkt, start, end]).fetchall():
                key = f"{session_id}-{game}"
                expected.append(("sessions", key, key))
    for (payment_id,) in cur.execute(f"""SELECT p.payment_id FROM payments p
            JOIN accounts a USING (account_id)
            WHERE a.jurisdiction=? AND p.status='COMPLETED'
              AND p.completed_ts >= CAST(? AS TIMESTAMPTZ) AND p.completed_ts < CAST(? AS TIMESTAMPTZ)""",
            [mkt, start, end]).fetchall():
        expected.append(("payments", payment_id, payment_id))

    breaks, reported = [], 0
    for rtype, key, rid in expected:
        row = q1(cur, """SELECT receipt_id FROM safe_submissions
                         WHERE record_type=? AND record_key=?""", [rtype, key])
        if row is None:
            breaks.append((rtype, rid, "NOT SUBMITTED to the regulator SAFE"))
            continue
        receipt = row[0]
        folder = os.path.join(SAFE_ROOT, mkt, rtype)
        # event-log regimes deposit several documents per record under
        # suffixed keys (S1001-MISE, S1001-GAIN): any of them proves the
        # record reached the SAFE. REQ: requirements/fr-new-jurisdiction (REQ-FR-4)
        name_re = re.compile(rf"-{re.escape(rid)}(-[A-Z]+)?\.xml$")
        found = os.path.isdir(folder) and any(
            name_re.search(f) for f in os.listdir(folder))
        if not found:
            breaks.append((rtype, rid, f"receipt {receipt} but XML missing from SAFE store"))
        else:
            reported += 1
    return len(expected), reported, breaks


# ============================ PDF rendering =================================
class ReconPDF(FPDF):
    def header(self):
        self.set_fill_color(18, 48, 39)
        self.rect(0, 0, 210, 24, "F")
        self.set_xy(10, 5)
        self.set_font("Helvetica", "B", 14)
        self.set_text_color(255, 210, 94)
        self.cell(0, 7, "BetNova (fictitious) - Financial Reconciliation", new_x="LMARGIN", new_y="NEXT")
        self.set_font("Helvetica", "", 8)
        self.set_text_color(220, 230, 222)
        self.cell(0, 5, "FICTITIOUS DEMO - no real money. Process: financial-reconciliations.md",
                  new_x="LMARGIN", new_y="NEXT")
        self.set_y(28)
        self.set_text_color(20, 20, 20)

    def section(self, title):
        self.set_font("Helvetica", "B", 11)
        self.set_fill_color(234, 241, 248)
        self.cell(0, 7, f"  {title}", fill=True, new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def row(self, label, value, bold=False, indent=4, color=None):
        self.set_font("Helvetica", "B" if bold else "", 9.5)
        if color:
            self.set_text_color(*color)
        self.cell(indent)
        self.cell(120, 5.5, label)
        self.cell(50, 5.5, value, align="R", new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(20, 20, 20)


def eur(x):
    return f"EUR {x:,.2f}"


def render_pdf(mkt, period_label, f, checked, reported_n, breaks, duty_rows, out_path,
               daily_breakdown=None):
    pdf = ReconPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 7, f"Jurisdiction: {mkt}    Period: {period_label}",
             new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 8.5)
    pdf.cell(0, 5, f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} "
                   "from the operator OLTP (read-only) and the regulator SAFE submission log.",
             new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    pdf.section("1 - Cash view (player transactions)")
    pdf.row("Deposits completed", eur(f["deposits"]))
    pdf.row("Withdrawals completed", f"({eur(f['withdrawals'])})")
    pdf.row("Player balance liability - opening", eur(f["opening_balance"]))
    pdf.row("Player balance liability - closing", eur(f["closing_balance"]))
    pdf.row("Cash-basis GGR  (deposits - withdrawals - balance movement)",
            eur(f["cash_ggr"]), bold=True)
    pdf.ln(2)

    pdf.section("2 - Settlement view (the GGR tax base)")
    pdf.row(f"Sports: {f['settled_n']} bets settled - stakes", eur(f["settled_stakes"]))
    pdf.row("Sports: payouts", f"({eur(f['settled_payouts'])})")
    if f["void_n"]:
        pdf.row(f"Sports: {f['void_n']} void(s) - GGR reversal", f"({eur(f['void_ggr_reversal'])})")
    pdf.row("Sports GGR", eur(f["sports_ggr"]))
    pdf.row(f"Gaming (cash-funded): {f['rounds_n']} rounds - stakes", eur(f["casino_stakes"]))
    pdf.row("Gaming (cash-funded): payouts", f"({eur(f['casino_payouts'])})")
    pdf.row("Gaming (cash-funded) GGR", eur(f["casino_ggr"]))
    if f["golden_n"]:
        pdf.row(f"Golden chips: {f['golden_n']} bonus-funded round(s) - chip value",
                eur(f["golden_stakes"]))
        pdf.row("Golden chips: cash winnings paid", f"({eur(f['golden_winnings'])})")
        pdf.row(f"Golden chips GGR - policy '{f['bonus_policy']}' "
                f"({'chip counts as stake' if f['bonus_policy'] == 'gross' else 'operator cost deducted'})",
                eur(f["golden_ggr"]))
    pdf.row("Settlement-basis GGR", eur(f["settlement_ggr"]), bold=True)
    pdf.ln(2)

    pdf.section("3 - Reconciliation bridge (cash vs settlement)")
    pdf.row("Cash-basis GGR", eur(f["cash_ggr"]))
    pdf.row("Less: movement in unsettled-stakes liability (open bets)",
            f"({eur(f['open_movement'])})")
    pdf.row(f"    open bets: opening {eur(f['open_start'])} -> closing {eur(f['open_end'])}", "")
    if f["bonus_bridge"]:
        pdf.row("Add: operator-funded bonus stakes (golden chips, 'gross' market)",
                eur(f["bonus_bridge"]))
    pdf.row("Equals settlement-basis GGR",
            eur(f["cash_ggr"] - f["open_movement"] + f["bonus_bridge"]))
    ok = abs(f["residual"]) < 0.005
    pdf.row("UNRECONCILED RESIDUAL", eur(f["residual"]), bold=True,
            color=(29, 122, 79) if ok else (140, 47, 47))
    pdf.row("STATUS", "RECONCILED" if ok else "*** UNRECONCILED - INVESTIGATE ***",
            bold=True, color=(29, 122, 79) if ok else (140, 47, 47))
    pdf.ln(2)

    pdf.section("4 - Reported to regulator (three-way completeness)")
    pdf.row("Reportable records in period (bets / gaming / payments)", str(checked))
    pdf.row("Held SAFE receipt AND stored XML", str(reported_n))
    complete = not breaks
    pdf.row("Completeness", "100%" if complete else f"{reported_n}/{checked} - BREAKS BELOW",
            bold=True, color=(29, 122, 79) if complete else (140, 47, 47))
    for rtype, rid, problem in breaks[:12]:
        pdf.row(f"BREAK: {rtype} {rid}", problem, color=(140, 47, 47))
    if len(breaks) > 12:
        pdf.row(f"... and {len(breaks) - 12} more", "", color=(140, 47, 47))
    pdf.ln(2)

    pdf.section("5 - GGR duty payable")
    total_duty = 0.0
    for day_label, ggr, rate, duty in duty_rows:
        pdf.row(f"{day_label}  duty base {eur(ggr)}  @ {rate * 100:.1f}%", eur(duty))
        total_duty += duty
    pdf.row("TOTAL DUTY PAYABLE", eur(total_duty), bold=True)
    pdf.ln(2)

    if daily_breakdown:
        pdf.section("Appendix - daily settlement GGR within the month")
        for day_label, ggr in daily_breakdown:
            pdf.row(day_label, eur(ggr))

    pdf.set_font("Helvetica", "I", 8)
    pdf.ln(3)
    pdf.cell(0, 5, "Prepared for finance sign-off. Basis and bridge are defined in "
                   "financial-reconciliations.md (repo root).", new_x="LMARGIN", new_y="NEXT")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    pdf.output(out_path)
    return ok and complete


# ============================ orchestration =================================
def market_active(cur, mkt, start, end):
    n = q1(cur, """SELECT
        (SELECT COUNT(*) FROM payments p JOIN accounts a USING (account_id)
          WHERE a.jurisdiction=? AND p.completed_ts >= CAST(? AS TIMESTAMPTZ) AND p.completed_ts < CAST(? AS TIMESTAMPTZ))
      + (SELECT COUNT(*) FROM bet_slip_events e JOIN bet_slips b USING (slip_id)
          JOIN accounts a USING (account_id)
          WHERE a.jurisdiction=? AND e.event_ts >= CAST(? AS TIMESTAMPTZ) AND e.event_ts < CAST(? AS TIMESTAMPTZ))
      + (SELECT COUNT(*) FROM game_rounds r JOIN accounts a USING (account_id)
          WHERE a.jurisdiction=? AND r.round_ts >= CAST(? AS TIMESTAMPTZ) AND r.round_ts < CAST(? AS TIMESTAMPTZ))""",
        [mkt, start, end, mkt, start, end, mkt, start, end])[0]
    return int(n) > 0


def run_daily(cur, day, only=None):
    start = f"{day} 00:00:00+00"
    end = f"{day + timedelta(days=1)} 00:00:00+00"
    results = []
    for mkt in MARKETS:
        if only and mkt != only:
            continue
        if not market_active(cur, mkt, start, end):
            continue
        f = period_flows(cur, mkt, start, end)
        checked, reported_n, breaks = reported_breaks(cur, mkt, start, end)
        rate = rate_for(mkt, day)
        base = duty_base(mkt, f)
        duty_rows = [(str(day), base, rate, round(base * rate, 2))]
        out = os.path.join(RECON_ROOT, mkt, f"BetNova-{mkt}-daily-{day}.pdf")
        ok = render_pdf(mkt, f"DAILY {day} (UTC)", f, checked, reported_n, breaks, duty_rows, out)
        results.append((mkt, f"daily {day}", f, checked, reported_n, breaks, ok, out))
    return results


def run_monthly(cur, year, month, only=None):
    first = date(year, month, 1)
    days_in_month = calendar.monthrange(year, month)[1]
    nxt = first + timedelta(days=days_in_month)
    start, end = f"{first} 00:00:00+00", f"{nxt} 00:00:00+00"
    results = []
    for mkt in MARKETS:
        if only and mkt != only:
            continue
        if not market_active(cur, mkt, start, end):
            continue
        f = period_flows(cur, mkt, start, end)
        checked, reported_n, breaks = reported_breaks(cur, mkt, start, end)
        # duty accrues per day at that DAY's effective rate (a rate change
        # mid-month is applied to each day's own GGR, never averaged)
        duty_rows, daily_breakdown = [], []
        for i in range(days_in_month):
            d = first + timedelta(days=i)
            ds, de = f"{d} 00:00:00+00", f"{d + timedelta(days=1)} 00:00:00+00"
            if not market_active(cur, mkt, ds, de):
                continue
            df = period_flows(cur, mkt, ds, de)
            rate = rate_for(mkt, d)
            dbase = duty_base(mkt, df)
            duty_rows.append((str(d), dbase, rate, round(dbase * rate, 2)))
            daily_breakdown.append((str(d), df["settlement_ggr"]))
        label = f"{year}-{month:02d}"
        out = os.path.join(RECON_ROOT, mkt, f"BetNova-{mkt}-monthly-{label}.pdf")
        ok = render_pdf(mkt, f"MONTHLY {label} (UTC)", f, checked, reported_n, breaks,
                        duty_rows, out, daily_breakdown=daily_breakdown)
        results.append((mkt, f"monthly {label}", f, checked, reported_n, breaks, ok, out))
    return results


def main():
    ap = argparse.ArgumentParser(description="BetNova financial reconciliation (demo)")
    ap.add_argument("--date", help="daily run for YYYY-MM-DD (default: today UTC)")
    ap.add_argument("--month", help="monthly run for YYYY-MM (default: current month)")
    ap.add_argument("--jurisdiction", help="one market only (MT/ES/DK/BG/GR/NL)")
    args = ap.parse_args()

    con = duckdb.connect(dbmod.DB_PATH, read_only=True)
    cur = con.cursor()

    today = datetime.now(timezone.utc).date()
    results = []
    if args.month and not args.date:
        y, m = map(int, args.month.split("-"))
        results += run_monthly(cur, y, m, args.jurisdiction)
    elif args.date and not args.month:
        d = date.fromisoformat(args.date)
        results += run_daily(cur, d, args.jurisdiction)
    else:
        d = date.fromisoformat(args.date) if args.date else today
        y, m = map(int, args.month.split("-")) if args.month else (today.year, today.month)
        results += run_daily(cur, d, args.jurisdiction)
        results += run_monthly(cur, y, m, args.jurisdiction)
    con.close()

    if not results:
        print("[RECON] no activity in the requested period(s) — nothing to reconcile")
        return

    all_ok = True
    print(f"{'market':<7}{'period':<18}{'cash GGR':>12}{'settle GGR':>12}{'residual':>10}"
          f"{'reported':>10}  status")
    for mkt, period, f, checked, reported_n, breaks, ok, out in results:
        all_ok &= ok
        status = "RECONCILED" if ok else "BREAKS"
        print(f"{mkt:<7}{period:<18}{f['cash_ggr']:>12.2f}{f['settlement_ggr']:>12.2f}"
              f"{f['residual']:>10.2f}{f'{reported_n}/{checked}':>10}  {status}  -> {os.path.relpath(out)}")
    print("[RECON] " + ("ALL RECONCILED — reports ready for finance sign-off"
                        if all_ok else "BREAKS FOUND — see the flagged PDFs"))
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
