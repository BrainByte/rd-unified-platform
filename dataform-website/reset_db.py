# ============================================================================
# Rebuild data/betnova.duckdb from scratch with demo seed data.
#
#   python reset_db.py
#
# Creates: admin/admin (customer services), demo/demo (a funded, verified MT
# player with an address and limits) and a fresh set of open fixtures.
# ============================================================================
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import db          # noqa: E402
import engine      # noqa: E402
from db import next_id, now  # noqa: E402
from werkzeug.security import generate_password_hash  # noqa: E402


def main():
    if os.path.exists(db.DB_PATH):
        os.remove(db.DB_PATH)
    wal = db.DB_PATH + ".wal"
    if os.path.exists(wal):
        os.remove(wal)

    # clear the regulator SAFE's stored records too (fresh demo)
    import safe
    cleared = 0
    for mkt in safe.JURISDICTIONS:
        for rtype in safe.RECORD_TYPES:
            d = os.path.join(safe.SAFE_ROOT, mkt, rtype)
            if os.path.isdir(d):
                for f in os.listdir(d):
                    if f.endswith(".xml"):
                        os.remove(os.path.join(d, f))
                        cleared += 1
    if cleared:
        print(f"cleared {cleared} stored SAFE record(s) from dataform-safe/")

    # clear generated financial reconciliation reports too
    recon_root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                              "dataform-reconciliation")
    cleared_pdf = 0
    if os.path.isdir(recon_root):
        for dirpath, _dirs, files in os.walk(recon_root):
            for f in files:
                if f.endswith(".pdf"):
                    os.remove(os.path.join(dirpath, f))
                    cleared_pdf += 1
    if cleared_pdf:
        print(f"cleared {cleared_pdf} reconciliation report(s) from dataform-reconciliation/")

    cur = db.cursor()
    db.init_schema(cur)

    # customer-services account (never bets; sees everything). Seeded rows
    # predate any login, so they carry no session stamp (NULL).
    aid = next_id(cur, "account", "W")
    cur.execute("INSERT INTO accounts VALUES (?, 'admin', ?, 'MT', NULL, DATE '1980-01-01', 'VERIFIED', TRUE, NULL, ?, NULL)",
                [aid, generate_password_hash("admin"), now()])

    # a ready-to-play demo player: MT, verified, funded, sensible limits
    pid = next_id(cur, "account", "W")
    cur.execute("INSERT INTO accounts VALUES (?, 'demo', ?, 'MT', 'MT-ID-70011', DATE '1990-05-10', 'VERIFIED', FALSE, NULL, ?, NULL)",
                [pid, generate_password_hash("demo"), now()])
    cur.execute("INSERT INTO terms_acceptances VALUES (?, ?, ?)", [pid, engine.TERMS_VERSION, now()])
    vid = next_id(cur, "verification", "V")
    cur.execute("INSERT INTO verifications VALUES (?, ?, 'IDENTITY', 'VERIFIED', ?)", [vid, pid, now()])
    cur.execute("INSERT INTO account_addresses VALUES (?, '4 Merchant Street', 'Valletta', 'VLT 1171', ?)",
                [pid, now()])
    cur.execute("INSERT INTO payment_methods VALUES (?, 'CARD', '1111', ?)", [pid, now()])
    for ltype, amount in [("DEPOSIT_DAILY", 500.0), ("LOSS_DAILY", 200.0)]:
        lid = next_id(cur, "limit", "L")
        cur.execute("INSERT INTO player_limits VALUES (?, ?, ?, ?, ?, NULL)",
                    [lid, pid, ltype, amount, now()])
    dep = next_id(cur, "payment", "P")
    cur.execute("INSERT INTO payments VALUES (?, ?, 'DEPOSIT', 200.00, 'CARD', 'COMPLETED', NULL, NULL, ?, ?)",
                [dep, pid, now(), now()])

    engine.top_up_fixtures(cur)
    cur.execute("SELECT COUNT(*) FROM fixtures")
    n_fix = cur.fetchone()[0]
    cur.close()
    db.connect().close()   # checkpoint so the .duckdb file is clean for git

    print(f"betnova.duckdb rebuilt: admin/admin + demo/demo (balance 200.00), {n_fix} open fixtures")
    print(f"  -> {db.DB_PATH}")


if __name__ == "__main__":
    main()
