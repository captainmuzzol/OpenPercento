import json
import sqlite3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).resolve().parent
DB_PATH = ROOT_DIR / "openpercento.db"


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def is_leap_year(year: int) -> bool:
    return (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0)


def clamp_year_day(year: int, year_day: int) -> int:
    max_day = 366 if is_leap_year(year) else 365
    return max(1, min(int(year_day), max_day))


def parse_date_str(date_str: str):
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    except Exception:
        return None


def to_date_str(d):
    return d.isoformat()


def compute_initial_next_run(rule: dict, today):
    freq = (rule.get("frequency") or "").lower()
    if freq == "daily":
        return to_date_str(today)

    if freq == "weekly":
        target = int(rule.get("weekday") if rule.get("weekday") is not None else 1)
        d = today
        for _ in range(8):
            if d.weekday() == (target - 1 if target != 0 else 6):
                return to_date_str(d)
            d = d + timedelta(days=1)
        return to_date_str(today)

    if freq == "monthly":
        day = max(1, min(31, int(rule.get("monthDay") or 1)))
        last = (today.replace(day=1) + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        run_day = min(day, last.day)
        d = today.replace(day=run_day)
        if d < today:
            first_next = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
            last2 = (first_next + timedelta(days=32)).replace(day=1) - timedelta(days=1)
            d = first_next.replace(day=min(day, last2.day))
        return to_date_str(d)

    year_day_input = int(rule.get("yearDay") or 1)
    y = today.year
    day_for_y = clamp_year_day(y, year_day_input)
    d = datetime(y, 1, 1).date() + timedelta(days=day_for_y - 1)
    if d < today:
        y2 = y + 1
        day_for_y2 = clamp_year_day(y2, year_day_input)
        d = datetime(y2, 1, 1).date() + timedelta(days=day_for_y2 - 1)
    return to_date_str(d)


def compute_next_run(rule: dict, current_date_str: str):
    base = parse_date_str(current_date_str)
    if not base:
        return ""
    freq = (rule.get("frequency") or "").lower()
    if freq == "daily":
        return to_date_str(base + timedelta(days=1))
    if freq == "weekly":
        return to_date_str(base + timedelta(days=7))
    if freq == "monthly":
        day = max(1, min(31, int(rule.get("monthDay") or 1)))
        first_next = (base.replace(day=1) + timedelta(days=32)).replace(day=1)
        last = (first_next + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        return to_date_str(first_next.replace(day=min(day, last.day)))
    year_day_input = int(rule.get("yearDay") or 1)
    y = base.year + 1
    day_for_y = clamp_year_day(y, year_day_input)
    d = datetime(y, 1, 1).date() + timedelta(days=day_for_y - 1)
    return to_date_str(d)


def execute_recurring_rule(conn, rule: dict, date_str: str) -> bool:
    action = (rule.get("action") or "").lower()
    amount = float(rule.get("amount") or 0)
    if not amount or amount <= 0:
        return False

    if action == "income" and rule.get("accountId"):
        account_id = int(rule.get("accountId"))
        row = conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
        if not row:
            return False
        prev = float(row["balance"] or 0)
        new_bal = prev + amount
        conn.execute("UPDATE accounts SET balance = ?, updatedAt = ? WHERE id = ?", (new_bal, now_iso(), account_id))
        conn.execute(
            """
            INSERT INTO transactions (accountId, type, previousBalance, newBalance, amount, reason, date, note, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                account_id,
                "recurring_income",
                prev,
                new_bal,
                amount,
                rule.get("note") or "Recurring income",
                date_str,
                rule.get("note"),
                now_iso(),
                now_iso(),
            ),
        )
        return True

    if action == "transfer" and (rule.get("fromAccountId") or rule.get("accountId")) and rule.get("toAccountId"):
        from_id = int(rule.get("fromAccountId") or rule.get("accountId"))
        to_id = int(rule.get("toAccountId"))
        if from_id == to_id:
            return False
        from_row = conn.execute("SELECT * FROM accounts WHERE id = ?", (from_id,)).fetchone()
        to_row = conn.execute("SELECT * FROM accounts WHERE id = ?", (to_id,)).fetchone()
        if not from_row or not to_row:
            return False
        from_prev = float(from_row["balance"] or 0)
        to_prev = float(to_row["balance"] or 0)
        from_new = from_prev - amount
        to_new = to_prev + amount
        now = now_iso()
        conn.execute("UPDATE accounts SET balance = ?, updatedAt = ? WHERE id = ?", (from_new, now, from_id))
        conn.execute("UPDATE accounts SET balance = ?, updatedAt = ? WHERE id = ?", (to_new, now, to_id))

        from_name = from_row["name"] or "-"
        to_name = to_row["name"] or "-"
        reason = rule.get("note") or f"Recurring transfer: {from_name} → {to_name}"
        conn.execute(
            """
            INSERT INTO transactions (accountId, type, previousBalance, newBalance, amount, reason, date, note, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (from_id, "recurring_transfer_out", from_prev, from_new, -amount, reason, date_str, rule.get("note"), now, now),
        )
        conn.execute(
            """
            INSERT INTO transactions (accountId, type, previousBalance, newBalance, amount, reason, date, note, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (to_id, "recurring_transfer_in", to_prev, to_new, amount, reason, date_str, rule.get("note"), now, now),
        )
        return True

    if action == "dca" and rule.get("fromAccountId") and rule.get("investmentId"):
        from_id = int(rule.get("fromAccountId"))
        inv_id = int(rule.get("investmentId"))
        from_row = conn.execute("SELECT * FROM accounts WHERE id = ?", (from_id,)).fetchone()
        inv_row = conn.execute("SELECT * FROM investments WHERE id = ?", (inv_id,)).fetchone()
        if not from_row or not inv_row:
            return False
        price = float(inv_row["currentPrice"] or 0) or float(inv_row["costPrice"] or 0)
        if not price or price <= 0:
            return False

        qty_add = amount / price
        old_qty = float(inv_row["quantity"] or 0)
        old_cost = float(inv_row["costPrice"] or 0)
        new_qty = old_qty + qty_add
        new_cost = ((old_qty * old_cost) + (qty_add * price)) / new_qty if new_qty > 0 else old_cost

        from_prev = float(from_row["balance"] or 0)
        from_new = from_prev - amount
        now = now_iso()
        conn.execute("UPDATE accounts SET balance = ?, updatedAt = ? WHERE id = ?", (from_new, now, from_id))
        conn.execute(
            """
            INSERT INTO transactions (accountId, type, previousBalance, newBalance, amount, reason, date, note, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                from_id,
                "dca_out",
                from_prev,
                from_new,
                -amount,
                rule.get("note") or f"DCA: {(from_row['name'] or '-') } → {(inv_row['name'] or '-')}",
                date_str,
                rule.get("note"),
                now,
                now,
            ),
        )
        conn.execute(
            "UPDATE investments SET quantity = ?, costPrice = ?, updatedAt = ? WHERE id = ?",
            (new_qty, new_cost, now, inv_id),
        )
        return True

    return False


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db():
    conn = connect()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            "group" TEXT NOT NULL,
            balance REAL NOT NULL DEFAULT 0,
            icon TEXT,
            includeInNetWorth INTEGER NOT NULL DEFAULT 1,
            billingDay INTEGER,
            repaymentDay INTEGER,
            note TEXT,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            accountId INTEGER NOT NULL,
            type TEXT,
            previousBalance REAL,
            newBalance REAL,
            amount REAL NOT NULL DEFAULT 0,
            reason TEXT,
            date TEXT,
            note TEXT,
            createdAt TEXT NOT NULL,
            updatedAt TEXT
        );

        CREATE TABLE IF NOT EXISTS investments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            symbol TEXT NOT NULL,
            quantity REAL NOT NULL DEFAULT 0,
            costPrice REAL NOT NULL DEFAULT 0,
            currentPrice REAL NOT NULL DEFAULT 0,
            purchaseDate TEXT,
            wealthProductType TEXT,
            annualInterestRate REAL NOT NULL DEFAULT 0,
            maturityDate TEXT,
            lastAccruedDate TEXT,
            note TEXT,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS priceHistory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            investmentId INTEGER NOT NULL,
            date TEXT NOT NULL,
            price REAL NOT NULL DEFAULT 0,
            type TEXT,
            symbol TEXT,
            createdAt TEXT NOT NULL,
            updatedAt TEXT,
            UNIQUE(investmentId, date)
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL UNIQUE,
            netWorth REAL NOT NULL DEFAULT 0,
            assets REAL NOT NULL DEFAULT 0,
            liabilities REAL NOT NULL DEFAULT 0,
            investments REAL NOT NULL DEFAULT 0,
            totalAssets REAL NOT NULL DEFAULT 0,
            totalLiabilities REAL NOT NULL DEFAULT 0,
            totalInvestmentValue REAL NOT NULL DEFAULT 0,
            totalInvestmentCost REAL NOT NULL DEFAULT 0,
            investmentProfit REAL NOT NULL DEFAULT 0,
            investmentProfitRate REAL NOT NULL DEFAULT 0,
            createdAt TEXT NOT NULL,
            updatedAt TEXT
        );

        CREATE TABLE IF NOT EXISTS recurringRules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            action TEXT NOT NULL,
            accountId INTEGER,
            fromAccountId INTEGER,
            toAccountId INTEGER,
            investmentId INTEGER,
            frequency TEXT NOT NULL,
            weekday INTEGER,
            monthDay INTEGER,
            yearDay INTEGER,
            amount REAL NOT NULL DEFAULT 0,
            note TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            nextRun TEXT NOT NULL,
            lastRun TEXT,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );
        """
    )
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(accounts)").fetchall()}
    for col, col_type in (("icon", "TEXT"), ("billingDay", "INTEGER"), ("repaymentDay", "INTEGER"), ("includeInNetWorth", "INTEGER NOT NULL DEFAULT 1")):
        if col not in cols:
            conn.execute(f"ALTER TABLE accounts ADD COLUMN {col} {col_type}")

    inv_cols = {r["name"] for r in conn.execute("PRAGMA table_info(investments)").fetchall()}
    for col, col_type in (
        ("wealthProductType", "TEXT"),
        ("annualInterestRate", "REAL NOT NULL DEFAULT 0"),
        ("maturityDate", "TEXT"),
        ("lastAccruedDate", "TEXT"),
    ):
        if col not in inv_cols:
            conn.execute(f"ALTER TABLE investments ADD COLUMN {col} {col_type}")
    conn.commit()
    conn.close()


def row_to_dict(row):
    if row is None:
        return None
    return {k: row[k] for k in row.keys()}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def _send_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return None
        raw = self.rfile.read(length)
        if not raw:
            return None
        return json.loads(raw.decode("utf-8"))

    def _not_found(self):
        self._send_json(404, {"error": "not_found"})

    def _bad_request(self, message="bad_request"):
        self._send_json(400, {"error": message})

    def _method_not_allowed(self):
        self._send_json(405, {"error": "method_not_allowed"})

    def _handle_api(self):
        global DB_PATH
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/api/health":
            if self.command != "GET":
                return self._method_not_allowed()
            return self._send_json(200, {"ok": True})

        if path == "/api/config":
            if self.command != "GET":
                return self._method_not_allowed()
            return self._send_json(200, {"dbPath": str(DB_PATH)})

        if path == "/api/config/dbPath":
            if self.command != "POST":
                return self._method_not_allowed()
            body = self._read_json() or {}
            raw = body.get("dbPath")
            if not raw or not isinstance(raw, str):
                return self._bad_request("invalid_db_path")

            try:
                p = Path(raw).expanduser()
            except Exception:
                return self._bad_request("invalid_db_path")

            if not p.is_absolute():
                return self._bad_request("db_path_must_be_absolute")

            if p.suffix.lower() != ".db":
                return self._bad_request("db_path_must_end_with_db")

            try:
                p.parent.mkdir(parents=True, exist_ok=True)
            except Exception:
                return self._bad_request("db_path_parent_unwritable")

            DB_PATH = p
            init_db()
            return self._send_json(200, {"ok": True, "dbPath": str(DB_PATH)})

        def parse_id(segment):
            try:
                return int(segment)
            except Exception:
                return None

        conn = connect()
        try:
            if path == "/api/recurring":
                if self.command == "GET":
                    kind = (query.get("kind") or [None])[0]
                    account_id = parse_id((query.get("accountId") or [None])[0])
                    investment_id = parse_id((query.get("investmentId") or [None])[0])

                    where = []
                    params = []
                    if kind:
                        where.append("kind = ?")
                        params.append(kind)
                    if account_id:
                        where.append("accountId = ?")
                        params.append(account_id)
                    if investment_id:
                        where.append("investmentId = ?")
                        params.append(investment_id)

                    sql = "SELECT * FROM recurringRules"
                    if where:
                        sql += " WHERE " + " AND ".join(where)
                    sql += " ORDER BY id DESC"

                    rows = conn.execute(sql, tuple(params)).fetchall()
                    return self._send_json(200, [row_to_dict(r) for r in rows])

                if self.command == "POST":
                    body = self._read_json() or {}
                    created_at = body.get("createdAt") or now_iso()
                    updated_at = body.get("updatedAt") or now_iso()
                    cur = conn.execute(
                        """
                        INSERT INTO recurringRules (
                            kind, action, accountId, fromAccountId, toAccountId, investmentId,
                            frequency, weekday, monthDay, yearDay, amount, note, enabled, nextRun, lastRun,
                            createdAt, updatedAt
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            body.get("kind") or "",
                            body.get("action") or "",
                            body.get("accountId"),
                            body.get("fromAccountId"),
                            body.get("toAccountId"),
                            body.get("investmentId"),
                            body.get("frequency") or "",
                            body.get("weekday"),
                            body.get("monthDay"),
                            body.get("yearDay"),
                            float(body.get("amount") or 0),
                            body.get("note"),
                            1 if body.get("enabled") else 0,
                            body.get("nextRun") or "",
                            body.get("lastRun"),
                            created_at,
                            updated_at,
                        ),
                    )
                    conn.commit()
                    return self._send_json(200, {"id": cur.lastrowid})
                return self._method_not_allowed()

            if path == "/api/recurring/runDue":
                if self.command != "POST":
                    return self._method_not_allowed()
                today = datetime.now().date()
                today_str = today.isoformat()
                rows = conn.execute("SELECT * FROM recurringRules WHERE enabled = 1 ORDER BY id ASC").fetchall()
                processed = 0
                executed = 0
                updated_at = now_iso()
                for row in rows:
                    rule = row_to_dict(row)
                    next_run = str(rule.get("nextRun") or "")
                    if not next_run:
                        next_run = compute_initial_next_run(rule, today)
                        rule["nextRun"] = next_run
                        conn.execute(
                            "UPDATE recurringRules SET nextRun = ?, updatedAt = ? WHERE id = ?",
                            (next_run, updated_at, int(rule["id"])),
                        )

                    guard = 0
                    while next_run and next_run <= today_str and guard < 366:
                        processed += 1
                        ran = execute_recurring_rule(conn, rule, next_run)
                        if not ran:
                            break
                        executed += 1
                        rule["lastRun"] = next_run
                        rule["nextRun"] = compute_next_run(rule, next_run)
                        next_run = str(rule.get("nextRun") or "")
                        conn.execute(
                            "UPDATE recurringRules SET lastRun = ?, nextRun = ?, updatedAt = ? WHERE id = ?",
                            (rule["lastRun"], rule["nextRun"], updated_at, int(rule["id"])),
                        )
                        guard += 1

                conn.commit()
                return self._send_json(200, {"processed": processed, "executed": executed})

            if path.startswith("/api/recurring/"):
                rule_id = parse_id(path.split("/")[-1])
                if not rule_id:
                    return self._bad_request("invalid_id")
                if self.command == "GET":
                    row = conn.execute("SELECT * FROM recurringRules WHERE id = ?", (rule_id,)).fetchone()
                    if not row:
                        return self._not_found()
                    return self._send_json(200, row_to_dict(row))
                if self.command == "PUT":
                    body = self._read_json() or {}
                    updated_at = now_iso()
                    conn.execute(
                        """
                        UPDATE recurringRules SET
                            kind = ?, action = ?, accountId = ?, fromAccountId = ?, toAccountId = ?, investmentId = ?,
                            frequency = ?, weekday = ?, monthDay = ?, yearDay = ?, amount = ?, note = ?, enabled = ?,
                            nextRun = ?, lastRun = ?, updatedAt = ?
                        WHERE id = ?
                        """,
                        (
                            body.get("kind") or "",
                            body.get("action") or "",
                            body.get("accountId"),
                            body.get("fromAccountId"),
                            body.get("toAccountId"),
                            body.get("investmentId"),
                            body.get("frequency") or "",
                            body.get("weekday"),
                            body.get("monthDay"),
                            body.get("yearDay"),
                            float(body.get("amount") or 0),
                            body.get("note"),
                            1 if body.get("enabled") else 0,
                            body.get("nextRun") or "",
                            body.get("lastRun"),
                            updated_at,
                            rule_id,
                        ),
                    )
                    conn.commit()
                    return self._send_json(200, {"id": rule_id})
                if self.command == "DELETE":
                    conn.execute("DELETE FROM recurringRules WHERE id = ?", (rule_id,))
                    conn.commit()
                    return self._send_json(200, {"ok": True})
                return self._method_not_allowed()

            if path == "/api/accounts":
                if self.command == "GET":
                    rows = conn.execute("SELECT * FROM accounts ORDER BY id ASC").fetchall()
                    return self._send_json(200, [row_to_dict(r) for r in rows])
                if self.command == "POST":
                    body = self._read_json() or {}
                    created_at = body.get("createdAt") or now_iso()
                    updated_at = body.get("updatedAt") or now_iso()
                    cur = conn.execute(
                        'INSERT INTO accounts (name, "group", balance, icon, includeInNetWorth, billingDay, repaymentDay, note, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        (
                            body.get("name") or "",
                            body.get("group") or "",
                            float(body.get("balance") or 0),
                            body.get("icon"),
                            1 if body.get("includeInNetWorth", True) else 0,
                            body.get("billingDay"),
                            body.get("repaymentDay"),
                            body.get("note"),
                            created_at,
                            updated_at,
                        ),
                    )
                    conn.commit()
                    return self._send_json(200, {"id": cur.lastrowid})
                return self._method_not_allowed()

            if path.startswith("/api/accounts/"):
                account_id = parse_id(path.split("/")[-1])
                if not account_id:
                    return self._bad_request("invalid_id")
                if self.command == "GET":
                    row = conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
                    if not row:
                        return self._not_found()
                    return self._send_json(200, row_to_dict(row))
                if self.command == "PUT":
                    body = self._read_json() or {}
                    updated_at = now_iso()
                    conn.execute(
                        'UPDATE accounts SET name = ?, "group" = ?, balance = ?, icon = ?, includeInNetWorth = ?, billingDay = ?, repaymentDay = ?, note = ?, updatedAt = ? WHERE id = ?',
                        (
                            body.get("name") or "",
                            body.get("group") or "",
                            float(body.get("balance") or 0),
                            body.get("icon"),
                            1 if body.get("includeInNetWorth", True) else 0,
                            body.get("billingDay"),
                            body.get("repaymentDay"),
                            body.get("note"),
                            updated_at,
                            account_id,
                        ),
                    )
                    conn.commit()
                    return self._send_json(200, {"id": account_id})
                if self.command == "DELETE":
                    conn.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
                    conn.commit()
                    return self._send_json(200, {"ok": True})
                return self._method_not_allowed()

            if path == "/api/transactions":
                if self.command == "GET":
                    account_id = parse_id((query.get("accountId") or [None])[0])
                    if account_id:
                        rows = conn.execute(
                            "SELECT * FROM transactions WHERE accountId = ? ORDER BY date DESC, id DESC",
                            (account_id,),
                        ).fetchall()
                    else:
                        rows = conn.execute("SELECT * FROM transactions ORDER BY date DESC, id DESC").fetchall()
                    return self._send_json(200, [row_to_dict(r) for r in rows])
                if self.command == "POST":
                    body = self._read_json() or {}
                    created_at = body.get("createdAt") or now_iso()
                    cur = conn.execute(
                        """
                        INSERT INTO transactions (accountId, type, previousBalance, newBalance, amount, reason, date, note, createdAt, updatedAt)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            int(body.get("accountId") or 0),
                            body.get("type"),
                            float(body.get("previousBalance") or 0),
                            float(body.get("newBalance") or 0),
                            float(body.get("amount") or 0),
                            body.get("reason"),
                            body.get("date"),
                            body.get("note"),
                            created_at,
                            body.get("updatedAt"),
                        ),
                    )
                    conn.commit()
                    return self._send_json(200, {"id": cur.lastrowid})
                return self._method_not_allowed()

            if path.startswith("/api/transactions/"):
                tx_id = parse_id(path.split("/")[-1])
                if not tx_id:
                    return self._bad_request("invalid_id")
                if self.command == "GET":
                    row = conn.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,)).fetchone()
                    if not row:
                        return self._not_found()
                    return self._send_json(200, row_to_dict(row))
                if self.command == "PUT":
                    body = self._read_json() or {}
                    updated_at = now_iso()
                    conn.execute(
                        """
                        UPDATE transactions SET
                            accountId = ?, type = ?, previousBalance = ?, newBalance = ?, amount = ?, reason = ?, date = ?, note = ?, updatedAt = ?
                        WHERE id = ?
                        """,
                        (
                            int(body.get("accountId") or 0),
                            body.get("type"),
                            float(body.get("previousBalance") or 0),
                            float(body.get("newBalance") or 0),
                            float(body.get("amount") or 0),
                            body.get("reason"),
                            body.get("date"),
                            body.get("note"),
                            updated_at,
                            tx_id,
                        ),
                    )
                    conn.commit()
                    return self._send_json(200, {"id": tx_id})
                if self.command == "DELETE":
                    conn.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
                    conn.commit()
                    return self._send_json(200, {"ok": True})
                return self._method_not_allowed()

            if path == "/api/investments":
                if self.command == "GET":
                    inv_type = (query.get("type") or [None])[0]
                    if inv_type:
                        rows = conn.execute(
                            "SELECT * FROM investments WHERE type = ? ORDER BY id ASC", (inv_type,)
                        ).fetchall()
                    else:
                        rows = conn.execute("SELECT * FROM investments ORDER BY id ASC").fetchall()
                    return self._send_json(200, [row_to_dict(r) for r in rows])
                if self.command == "POST":
                    body = self._read_json() or {}
                    created_at = body.get("createdAt") or now_iso()
                    updated_at = body.get("updatedAt") or now_iso()
                    cur = conn.execute(
                        """
                        INSERT INTO investments (type, name, symbol, quantity, costPrice, currentPrice, purchaseDate, wealthProductType, annualInterestRate, maturityDate, lastAccruedDate, note, createdAt, updatedAt)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            body.get("type") or "",
                            body.get("name") or "",
                            body.get("symbol") or "",
                            float(body.get("quantity") or 0),
                            float(body.get("costPrice") or 0),
                            float(body.get("currentPrice") or 0),
                            body.get("purchaseDate"),
                            body.get("wealthProductType"),
                            float(body.get("annualInterestRate") or 0),
                            body.get("maturityDate"),
                            body.get("lastAccruedDate"),
                            body.get("note"),
                            created_at,
                            updated_at,
                        ),
                    )
                    conn.commit()
                    return self._send_json(200, {"id": cur.lastrowid})
                return self._method_not_allowed()

            if path.startswith("/api/investments/"):
                inv_id = parse_id(path.split("/")[-1])
                if not inv_id:
                    return self._bad_request("invalid_id")
                if self.command == "GET":
                    row = conn.execute("SELECT * FROM investments WHERE id = ?", (inv_id,)).fetchone()
                    if not row:
                        return self._not_found()
                    return self._send_json(200, row_to_dict(row))
                if self.command == "PUT":
                    body = self._read_json() or {}
                    updated_at = now_iso()
                    conn.execute(
                        """
                        UPDATE investments SET
                            type = ?, name = ?, symbol = ?, quantity = ?, costPrice = ?, currentPrice = ?, purchaseDate = ?, wealthProductType = ?, annualInterestRate = ?, maturityDate = ?, lastAccruedDate = ?, note = ?, updatedAt = ?
                        WHERE id = ?
                        """,
                        (
                            body.get("type") or "",
                            body.get("name") or "",
                            body.get("symbol") or "",
                            float(body.get("quantity") or 0),
                            float(body.get("costPrice") or 0),
                            float(body.get("currentPrice") or 0),
                            body.get("purchaseDate"),
                            body.get("wealthProductType"),
                            float(body.get("annualInterestRate") or 0),
                            body.get("maturityDate"),
                            body.get("lastAccruedDate"),
                            body.get("note"),
                            updated_at,
                            inv_id,
                        ),
                    )
                    conn.commit()
                    return self._send_json(200, {"id": inv_id})
                if self.command == "DELETE":
                    conn.execute("DELETE FROM investments WHERE id = ?", (inv_id,))
                    conn.execute("DELETE FROM priceHistory WHERE investmentId = ?", (inv_id,))
                    conn.commit()
                    return self._send_json(200, {"ok": True})
                return self._method_not_allowed()

            if path == "/api/priceHistory":
                if self.command == "GET":
                    inv_id = parse_id((query.get("investmentId") or [None])[0])
                    start = (query.get("startDate") or [None])[0]
                    end = (query.get("endDate") or [None])[0]
                    params = []
                    sql = "SELECT * FROM priceHistory"
                    clauses = []
                    if inv_id:
                        clauses.append("investmentId = ?")
                        params.append(inv_id)
                    if start:
                        clauses.append("date >= ?")
                        params.append(start)
                    if end:
                        clauses.append("date <= ?")
                        params.append(end)
                    if clauses:
                        sql += " WHERE " + " AND ".join(clauses)
                    sql += " ORDER BY date ASC, id ASC"
                    rows = conn.execute(sql, params).fetchall()
                    return self._send_json(200, [row_to_dict(r) for r in rows])
                if self.command == "POST":
                    body = self._read_json() or {}
                    created_at = body.get("createdAt") or now_iso()
                    updated_at = body.get("updatedAt")
                    try:
                        cur = conn.execute(
                            """
                            INSERT INTO priceHistory (investmentId, date, price, type, symbol, createdAt, updatedAt)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                int(body.get("investmentId") or 0),
                                body.get("date"),
                                float(body.get("price") or 0),
                                body.get("type"),
                                body.get("symbol"),
                                created_at,
                                updated_at,
                            ),
                        )
                        conn.commit()
                        return self._send_json(200, {"id": cur.lastrowid})
                    except sqlite3.IntegrityError:
                        conn.execute(
                            """
                            UPDATE priceHistory SET price = ?, type = ?, symbol = ?, updatedAt = ?
                            WHERE investmentId = ? AND date = ?
                            """,
                            (
                                float(body.get("price") or 0),
                                body.get("type"),
                                body.get("symbol"),
                                now_iso(),
                                int(body.get("investmentId") or 0),
                                body.get("date"),
                            ),
                        )
                        conn.commit()
                        row = conn.execute(
                            "SELECT id FROM priceHistory WHERE investmentId = ? AND date = ?",
                            (int(body.get("investmentId") or 0), body.get("date")),
                        ).fetchone()
                        return self._send_json(200, {"id": row["id"] if row else None})
                return self._method_not_allowed()

            if path == "/api/priceHistory/byDate":
                if self.command != "GET":
                    return self._method_not_allowed()
                inv_id = parse_id((query.get("investmentId") or [None])[0])
                date = (query.get("date") or [None])[0]
                if not inv_id or not date:
                    return self._bad_request("missing_params")
                row = conn.execute(
                    "SELECT * FROM priceHistory WHERE investmentId = ? AND date = ?",
                    (inv_id, date),
                ).fetchone()
                if not row:
                    return self._send_json(200, None)
                return self._send_json(200, row_to_dict(row))

            if path.startswith("/api/priceHistory/"):
                segs = path.split("/")
                if len(segs) >= 5 and segs[3] == "byInvestment" and self.command == "DELETE":
                    inv_id = parse_id(segs[4])
                    if not inv_id:
                        return self._bad_request("invalid_id")
                    conn.execute("DELETE FROM priceHistory WHERE investmentId = ?", (inv_id,))
                    conn.commit()
                    return self._send_json(200, {"ok": True})

                history_id = parse_id(segs[-1])
                if not history_id:
                    return self._bad_request("invalid_id")
                if self.command == "PUT":
                    body = self._read_json() or {}
                    updated_at = now_iso()
                    conn.execute(
                        """
                        UPDATE priceHistory SET investmentId = ?, date = ?, price = ?, type = ?, symbol = ?, updatedAt = ?
                        WHERE id = ?
                        """,
                        (
                            int(body.get("investmentId") or 0),
                            body.get("date"),
                            float(body.get("price") or 0),
                            body.get("type"),
                            body.get("symbol"),
                            updated_at,
                            history_id,
                        ),
                    )
                    conn.commit()
                    return self._send_json(200, {"id": history_id})
                return self._method_not_allowed()

            if path == "/api/settings":
                if self.command != "GET":
                    return self._method_not_allowed()
                rows = conn.execute("SELECT key, value FROM settings ORDER BY key ASC").fetchall()
                out = {}
                for r in rows:
                    try:
                        out[r["key"]] = json.loads(r["value"]) if r["value"] is not None else None
                    except Exception:
                        out[r["key"]] = r["value"]
                return self._send_json(200, out)

            if path.startswith("/api/settings/"):
                key = path.split("/", 3)[3]
                if not key:
                    return self._bad_request("missing_key")
                if self.command == "GET":
                    row = conn.execute("SELECT key, value FROM settings WHERE key = ?", (key,)).fetchone()
                    if not row:
                        return self._send_json(200, {"key": key, "value": None})
                    try:
                        val = json.loads(row["value"]) if row["value"] is not None else None
                    except Exception:
                        val = row["value"]
                    return self._send_json(200, {"key": key, "value": val})
                if self.command == "PUT":
                    body = self._read_json() or {}
                    value = body.get("value")
                    value_json = json.dumps(value, ensure_ascii=False)
                    ts = now_iso()
                    conn.execute(
                        """
                        INSERT INTO settings (key, value, createdAt, updatedAt) VALUES (?, ?, ?, ?)
                        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt
                        """,
                        (key, value_json, ts, ts),
                    )
                    conn.commit()
                    return self._send_json(200, {"ok": True})
                if self.command == "DELETE":
                    conn.execute("DELETE FROM settings WHERE key = ?", (key,))
                    conn.commit()
                    return self._send_json(200, {"ok": True})
                return self._method_not_allowed()

            if path == "/api/snapshots":
                if self.command == "GET":
                    start = (query.get("startDate") or [None])[0]
                    end = (query.get("endDate") or [None])[0]
                    params = []
                    sql = "SELECT * FROM snapshots"
                    clauses = []
                    if start:
                        clauses.append("date >= ?")
                        params.append(start)
                    if end:
                        clauses.append("date <= ?")
                        params.append(end)
                    if clauses:
                        sql += " WHERE " + " AND ".join(clauses)
                    sql += " ORDER BY date ASC, id ASC"
                    rows = conn.execute(sql, params).fetchall()
                    return self._send_json(200, [row_to_dict(r) for r in rows])
                if self.command == "POST":
                    body = self._read_json() or {}
                    ts = now_iso()
                    date = body.get("date")
                    if not date:
                        return self._bad_request("missing_date")
                    conn.execute(
                        """
                        INSERT INTO snapshots
                        (date, netWorth, assets, liabilities, investments, totalAssets, totalLiabilities, totalInvestmentValue, totalInvestmentCost, investmentProfit, investmentProfitRate, createdAt, updatedAt)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(date) DO UPDATE SET
                            netWorth = excluded.netWorth,
                            assets = excluded.assets,
                            liabilities = excluded.liabilities,
                            investments = excluded.investments,
                            totalAssets = excluded.totalAssets,
                            totalLiabilities = excluded.totalLiabilities,
                            totalInvestmentValue = excluded.totalInvestmentValue,
                            totalInvestmentCost = excluded.totalInvestmentCost,
                            investmentProfit = excluded.investmentProfit,
                            investmentProfitRate = excluded.investmentProfitRate,
                            updatedAt = excluded.updatedAt
                        """,
                        (
                            date,
                            float(body.get("netWorth") or 0),
                            float(body.get("assets") or 0),
                            float(body.get("liabilities") or 0),
                            float(body.get("investments") or 0),
                            float(body.get("totalAssets") or 0),
                            float(body.get("totalLiabilities") or 0),
                            float(body.get("totalInvestmentValue") or 0),
                            float(body.get("totalInvestmentCost") or 0),
                            float(body.get("investmentProfit") or 0),
                            float(body.get("investmentProfitRate") or 0),
                            ts,
                            ts,
                        ),
                    )
                    conn.commit()
                    row = conn.execute("SELECT id FROM snapshots WHERE date = ?", (date,)).fetchone()
                    return self._send_json(200, {"id": row["id"] if row else None})
                return self._method_not_allowed()

            if path == "/api/snapshots/latest":
                if self.command != "GET":
                    return self._method_not_allowed()
                row = conn.execute("SELECT * FROM snapshots ORDER BY date DESC, id DESC LIMIT 1").fetchone()
                return self._send_json(200, row_to_dict(row))

            if path == "/api/export":
                if self.command != "GET":
                    return self._method_not_allowed()
                accounts = [row_to_dict(r) for r in conn.execute("SELECT * FROM accounts ORDER BY id ASC").fetchall()]
                transactions = [row_to_dict(r) for r in conn.execute("SELECT * FROM transactions ORDER BY date DESC, id DESC").fetchall()]
                investments = [row_to_dict(r) for r in conn.execute("SELECT * FROM investments ORDER BY id ASC").fetchall()]
                settings_rows = conn.execute("SELECT key, value FROM settings ORDER BY key ASC").fetchall()
                settings = {}
                for r in settings_rows:
                    try:
                        settings[r["key"]] = json.loads(r["value"]) if r["value"] is not None else None
                    except Exception:
                        settings[r["key"]] = r["value"]
                snapshots = [row_to_dict(r) for r in conn.execute("SELECT * FROM snapshots ORDER BY date ASC, id ASC").fetchall()]
                payload = {
                    "version": 2,
                    "exportedAt": now_iso(),
                    "accounts": accounts,
                    "transactions": transactions,
                    "investments": investments,
                    "settings": settings,
                    "snapshots": snapshots,
                }
                return self._send_json(200, payload)

            if path == "/api/clear":
                if self.command != "POST":
                    return self._method_not_allowed()
                conn.executescript(
                    """
                    DELETE FROM priceHistory;
                    DELETE FROM snapshots;
                    DELETE FROM transactions;
                    DELETE FROM investments;
                    DELETE FROM accounts;
                    DELETE FROM settings;
                    """
                )
                conn.commit()
                return self._send_json(200, {"ok": True})

            if path == "/api/import":
                if self.command != "POST":
                    return self._method_not_allowed()
                body = self._read_json() or {}
                conn.executescript(
                    """
                    DELETE FROM priceHistory;
                    DELETE FROM snapshots;
                    DELETE FROM transactions;
                    DELETE FROM investments;
                    DELETE FROM accounts;
                    DELETE FROM settings;
                    """
                )
                for a in body.get("accounts") or []:
                    conn.execute(
                        'INSERT INTO accounts (id, name, "group", balance, icon, includeInNetWorth, billingDay, repaymentDay, note, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        (
                            a.get("id"),
                            a.get("name") or "",
                            a.get("group") or "",
                            float(a.get("balance") or 0),
                            a.get("icon"),
                            1 if a.get("includeInNetWorth", True) else 0,
                            a.get("billingDay"),
                            a.get("repaymentDay"),
                            a.get("note"),
                            a.get("createdAt") or now_iso(),
                            a.get("updatedAt") or now_iso(),
                        ),
                    )
                for t in body.get("transactions") or []:
                    conn.execute(
                        """
                        INSERT INTO transactions (id, accountId, type, previousBalance, newBalance, amount, reason, date, note, createdAt, updatedAt)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            t.get("id"),
                            int(t.get("accountId") or 0),
                            t.get("type"),
                            float(t.get("previousBalance") or 0),
                            float(t.get("newBalance") or 0),
                            float(t.get("amount") or 0),
                            t.get("reason"),
                            t.get("date"),
                            t.get("note"),
                            t.get("createdAt") or now_iso(),
                            t.get("updatedAt"),
                        ),
                    )
                for inv in body.get("investments") or []:
                    conn.execute(
                        """
                        INSERT INTO investments (id, type, name, symbol, quantity, costPrice, currentPrice, purchaseDate, wealthProductType, annualInterestRate, maturityDate, lastAccruedDate, note, createdAt, updatedAt)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            inv.get("id"),
                            inv.get("type") or "",
                            inv.get("name") or "",
                            inv.get("symbol") or "",
                            float(inv.get("quantity") or 0),
                            float(inv.get("costPrice") or 0),
                            float(inv.get("currentPrice") or 0),
                            inv.get("purchaseDate"),
                            inv.get("wealthProductType"),
                            float(inv.get("annualInterestRate") or 0),
                            inv.get("maturityDate"),
                            inv.get("lastAccruedDate"),
                            inv.get("note"),
                            inv.get("createdAt") or now_iso(),
                            inv.get("updatedAt") or now_iso(),
                        ),
                    )
                for key, val in (body.get("settings") or {}).items():
                    ts = now_iso()
                    conn.execute(
                        "INSERT INTO settings (key, value, createdAt, updatedAt) VALUES (?, ?, ?, ?)",
                        (key, json.dumps(val, ensure_ascii=False), ts, ts),
                    )
                for s in body.get("snapshots") or []:
                    ts = s.get("createdAt") or now_iso()
                    conn.execute(
                        """
                        INSERT INTO snapshots
                        (id, date, netWorth, assets, liabilities, investments, totalAssets, totalLiabilities, totalInvestmentValue, totalInvestmentCost, investmentProfit, investmentProfitRate, createdAt, updatedAt)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            s.get("id"),
                            s.get("date"),
                            float(s.get("netWorth") or 0),
                            float(s.get("assets") or s.get("totalAssets") or 0),
                            float(s.get("liabilities") or s.get("totalLiabilities") or 0),
                            float(s.get("investments") or s.get("totalInvestmentValue") or 0),
                            float(s.get("totalAssets") or 0),
                            float(s.get("totalLiabilities") or 0),
                            float(s.get("totalInvestmentValue") or 0),
                            float(s.get("totalInvestmentCost") or 0),
                            float(s.get("investmentProfit") or 0),
                            float(s.get("investmentProfitRate") or 0),
                            ts,
                            s.get("updatedAt"),
                        ),
                    )
                conn.commit()
                return self._send_json(200, {"ok": True})

            return self._not_found()
        finally:
            conn.close()

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._handle_api()
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self._handle_api()
        return super().do_POST()

    def do_PUT(self):
        if self.path.startswith("/api/"):
            return self._handle_api()
        return self._not_found()

    def do_DELETE(self):
        if self.path.startswith("/api/"):
            return self._handle_api()
        return self._not_found()


def main():
    init_db()
    import os

    host = "0.0.0.0"
    port_env = os.environ.get("PORT") or os.environ.get("PERCENTO_PORT")
    base_port = int(port_env) if port_env and str(port_env).isdigit() else 9000

    last_error = None
    for port in range(base_port, base_port + 50):
        try:
            server = ThreadingHTTPServer((host, port), Handler)
            print(f"Serving on http://127.0.0.1:{port}/")
            server.serve_forever()
            return
        except OSError as e:
            last_error = e
            continue

    if last_error:
        raise last_error


if __name__ == "__main__":
    main()
