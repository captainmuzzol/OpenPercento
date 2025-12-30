import json
import ssl
import sqlite3
import urllib.request
import urllib.error
import base64
import os
import tempfile
import email.utils
import xml.etree.ElementTree as ET
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse, urlunparse, quote
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Tuple


ROOT_DIR = Path(__file__).resolve().parent
DB_PATH = ROOT_DIR / "openpercento.db"
DB_IO_LOCK = threading.RLock()


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
    DB_IO_LOCK.acquire()
    raw = sqlite3.connect(DB_PATH)
    raw.row_factory = sqlite3.Row
    raw.execute("PRAGMA foreign_keys = ON;")

    class _LockedConn:
        def __init__(self, conn, lock):
            self._conn = conn
            self._lock = lock

        def __getattr__(self, name):
            return getattr(self._conn, name)

        def close(self):
            try:
                return self._conn.close()
            finally:
                try:
                    self._lock.release()
                except Exception:
                    pass

    return _LockedConn(raw, DB_IO_LOCK)


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


def _webdav_ssl_context():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _webdav_auth_header(username: str, password: str) -> str:
    return "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()


def _webdav_encode_url(url: str) -> str:
    parsed = urlparse(url)
    encoded_path = quote(parsed.path or "/", safe="/%")
    return urlunparse((parsed.scheme, parsed.netloc, encoded_path, parsed.params, parsed.query, parsed.fragment))


def _webdav_join(base_url: str, *parts: str) -> str:
    if not base_url:
        return ""
    url = base_url
    if not url.endswith("/"):
        url += "/"
    for p in parts:
        if p is None:
            continue
        p2 = str(p).lstrip("/")
        if not p2:
            continue
        url += p2
        if not url.endswith("/"):
            url += "/"
    return url


def _webdav_candidates(base_url: str) -> List[str]:
    if not base_url:
        return []
    candidates = []
    base = base_url if base_url.endswith("/") else base_url + "/"
    candidates.append(base)
    try:
        parsed = urlparse(base)
        host = (parsed.netloc or "").lower()
        path = (parsed.path or "/").rstrip("/")
        if "jianguoyun.com" in host and path == "/dav":
            candidates.append(_webdav_join(base, "我的坚果云"))
    except Exception:
        pass
    out = []
    seen = set()
    for c in candidates:
        c2 = c if c.endswith("/") else c + "/"
        if c2 not in seen:
            seen.add(c2)
            out.append(c2)
    return out


def _webdav_request(method: str, url: str, username: str, password: str, data: Optional[bytes] = None, headers: Optional[Dict[str, str]] = None, timeout: int = 30) -> Tuple[Optional[int], Optional[bytes], Optional[str]]:
    request_headers = {
        "Authorization": _webdav_auth_header(username, password),
        "User-Agent": "OpenPercento/1.0",
        "Accept": "*/*",
        **(headers or {}),
    }
    req = urllib.request.Request(_webdav_encode_url(url), data=data, method=method, headers=request_headers)
    ctx = _webdav_ssl_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as response:
            return response.status, response.read(), None
    except urllib.error.HTTPError as e:
        try:
            body = e.read()
        except Exception:
            body = b""
        return e.code, body, None
    except urllib.error.URLError as e:
        return None, None, str(e.reason)


def _parse_http_date(value: str) -> Optional[float]:
    if not value:
        return None
    try:
        dt = email.utils.parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except Exception:
        return None


def _webdav_parse_propfind(resp_xml: str) -> Dict[str, Optional[float]]:
    out: Dict[str, Optional[float]] = {"size": None, "mtime": None}
    if not resp_xml:
        return out
    try:
        root = ET.fromstring(resp_xml)
    except Exception:
        return out

    def local_name(tag: str) -> str:
        return tag.split("}", 1)[1] if "}" in tag else tag

    size_val = None
    mtime_val = None
    for el in root.iter():
        name = local_name(el.tag).lower()
        if name == "getcontentlength" and el.text and size_val is None:
            try:
                size_val = float(int(el.text.strip()))
            except Exception:
                pass
        if name == "getlastmodified" and el.text and mtime_val is None:
            mtime_val = _parse_http_date(el.text.strip())

    out["size"] = size_val
    out["mtime"] = mtime_val
    return out


def _webdav_stat_file(base_url: str, username: str, password: str, filename: str) -> Dict:
    last_status = None
    last_message = None
    last_url = None
    for candidate in _webdav_candidates(base_url):
        file_url = _webdav_join(candidate, filename).rstrip("/")
        last_url = file_url
        status, resp_body, url_error = _webdav_request(
            "PROPFIND",
            file_url,
            username,
            password,
            data=b'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>',
            headers={"Depth": "0", "Content-Type": "application/xml"},
            timeout=15,
        )
        if url_error:
            return {"ok": False, "error": "url_error", "message": url_error, "url": file_url}

        last_status = status
        if status == 404:
            continue
        if status in (200, 207):
            xml_text = (resp_body or b"").decode("utf-8", errors="replace")
            props = _webdav_parse_propfind(xml_text)
            return {"ok": True, "exists": True, "url": file_url, "size": props.get("size"), "mtime": props.get("mtime")}

        try:
            last_message = (resp_body or b"")[:4000].decode("utf-8", errors="replace")
        except Exception:
            last_message = None
        return {"ok": False, "error": "http_error", "status": status, "message": last_message, "url": file_url}

    return {"ok": True, "exists": False, "status": last_status, "message": last_message, "url": last_url}


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

        if path == "/api/config/resetDbPath":
            if self.command != "POST":
                return self._method_not_allowed()
            DB_PATH = ROOT_DIR / "openpercento.db"
            init_db()
            return self._send_json(200, {"ok": True, "dbPath": str(DB_PATH)})

        if path in ("/api/webdav/propfind", "/api/webdav/propfind/"):
            if self.command != "POST":
                return self._method_not_allowed()
            
            body = self._read_json() or {}
            webdav_url = body.get("url")
            username = body.get("username")
            password = body.get("password")
            
            if webdav_url is None or username is None or password is None or not str(webdav_url).strip():
                return self._bad_request("missing_credentials")
            
            base = str(webdav_url).strip()
            status, resp_body, url_error = _webdav_request(
                "PROPFIND",
                base if base.endswith("/") else base + "/",
                str(username),
                str(password),
                data=b'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>',
                headers={"Depth": "0", "Content-Type": "application/xml"},
                timeout=10,
            )
            if url_error:
                return self._send_json(200, {"ok": False, "error": "url_error", "message": url_error})
            if status in (200, 207):
                return self._send_json(200, {"ok": True, "status": status})
            msg = None
            try:
                msg = (resp_body or b"")[:2000].decode("utf-8", errors="replace")
            except Exception:
                msg = None
            return self._send_json(200, {"ok": False, "error": "http_error", "status": status, "message": msg})

        if path in ("/api/webdav/upload", "/api/webdav/upload/"):
            if self.command != "POST":
                return self._method_not_allowed()
            
            body = self._read_json() or {}
            webdav_url = body.get("url")
            username = body.get("username")
            password = body.get("password")
            filename = body.get("filename")
            has_content = isinstance(body, dict) and ("content" in body)

            if webdav_url is None or username is None or password is None or not filename or not has_content:
                return self._bad_request("missing_parameters")

            base = str(webdav_url).strip()
            content = body.get("content")
            data = json.dumps(content, ensure_ascii=False).encode("utf-8") if isinstance(content, (dict, list)) else str(content).encode("utf-8")

            last_error = None
            last_status = None
            last_message = None
            last_url = None

            for candidate in _webdav_candidates(base):
                file_url = _webdav_join(candidate, str(filename).lstrip("/")).rstrip("/")
                last_url = file_url
                status, resp_body, url_error = _webdav_request(
                    "PUT",
                    file_url,
                    str(username),
                    str(password),
                    data=data,
                    headers={"Content-Type": "application/json; charset=utf-8"},
                    timeout=30,
                )
                if url_error:
                    last_error = "url_error"
                    last_message = url_error
                    last_status = None
                    break
                if status in (200, 201, 204):
                    return self._send_json(200, {"ok": True, "status": status, "url": file_url})

                last_status = status
                try:
                    last_message = (resp_body or b"")[:4000].decode("utf-8", errors="replace")
                except Exception:
                    last_message = None
                last_error = "http_error"
                if status == 404:
                    continue
                break

            hint = None
            try:
                parsed2 = urlparse(base)
                if "jianguoyun.com" in (parsed2.netloc or "").lower() and (parsed2.path or "").rstrip("/") == "/dav":
                    hint = "坚果云通常需要使用 https://dav.jianguoyun.com/dav/我的坚果云/ 作为保存目录"
            except Exception:
                hint = None

            return self._send_json(
                200,
                {
                    "ok": False,
                    "error": last_error or "sync_failed",
                    "status": last_status,
                    "url": last_url,
                    "message": last_message,
                    "hint": hint,
                },
            )

        if path in ("/api/webdav/download", "/api/webdav/download/"):
            if self.command != "POST":
                return self._method_not_allowed()
            
            body = self._read_json() or {}
            webdav_url = body.get("url")
            username = body.get("username")
            password = body.get("password")
            filename = body.get("filename")
            
            if webdav_url is None or username is None or password is None or not filename:
                return self._bad_request("missing_parameters")

            base = str(webdav_url).strip()
            last_status = None
            last_message = None
            last_url = None
            for candidate in _webdav_candidates(base):
                file_url = _webdav_join(candidate, str(filename).lstrip("/")).rstrip("/")
                last_url = file_url
                status, resp_body, url_error = _webdav_request("GET", file_url, str(username), str(password), timeout=30)
                if url_error:
                    return self._send_json(200, {"ok": False, "error": "url_error", "message": url_error, "url": file_url})
                if status == 200:
                    raw = (resp_body or b"").decode("utf-8", errors="replace")
                    try:
                        data = json.loads(raw)
                        return self._send_json(200, {"ok": True, "data": data, "url": file_url})
                    except Exception:
                        return self._send_json(200, {"ok": True, "data": raw, "url": file_url})
                last_status = status
                try:
                    last_message = (resp_body or b"")[:4000].decode("utf-8", errors="replace")
                except Exception:
                    last_message = None
                if status == 404:
                    continue
                break

            hint = None
            try:
                parsed2 = urlparse(base)
                if "jianguoyun.com" in (parsed2.netloc or "").lower() and (parsed2.path or "").rstrip("/") == "/dav":
                    hint = "坚果云通常需要使用 https://dav.jianguoyun.com/dav/我的坚果云/ 作为保存目录"
            except Exception:
                hint = None

            return self._send_json(200, {"ok": False, "error": "http_error", "status": last_status, "message": last_message, "url": last_url, "hint": hint})

        if path in ("/api/webdav/db/sync", "/api/webdav/db/sync/"):
            if self.command != "POST":
                return self._method_not_allowed()

            body = self._read_json() or {}
            webdav_url = body.get("url")
            username = body.get("username")
            password = body.get("password")
            remote_filename = body.get("filename") or "openpercento.db"
            force = body.get("force")

            if webdav_url is None or username is None or password is None or not str(webdav_url).strip():
                return self._bad_request("missing_parameters")

            local_path = ROOT_DIR / "openpercento.db"
            local_exists = local_path.exists()
            local_size = None
            local_mtime = None
            if local_exists:
                try:
                    st = local_path.stat()
                    local_size = int(st.st_size)
                    local_mtime = float(st.st_mtime)
                except Exception:
                    local_exists = False

            remote_stat = _webdav_stat_file(str(webdav_url).strip(), str(username), str(password), str(remote_filename).lstrip("/"))
            if not remote_stat.get("ok"):
                hint = remote_stat.get("hint")
                if not hint:
                    try:
                        parsed2 = urlparse(str(webdav_url).strip())
                        if "jianguoyun.com" in (parsed2.netloc or "").lower() and (parsed2.path or "").rstrip("/") == "/dav":
                            hint = "坚果云通常需要使用 https://dav.jianguoyun.com/dav/我的坚果云/ 作为保存目录"
                    except Exception:
                        hint = None
                return self._send_json(200, {**remote_stat, "hint": hint})

            remote_exists = bool(remote_stat.get("exists"))
            remote_size = remote_stat.get("size")
            remote_mtime = remote_stat.get("mtime")

            def choose_action():
                if force == "upload":
                    return "upload"
                if force == "download":
                    return "download"
                if local_exists and not remote_exists:
                    return "upload"
                if remote_exists and not local_exists:
                    return "download"
                if not local_exists and not remote_exists:
                    return "noop"

                try:
                    ls = int(local_size or 0)
                    rs = int(remote_size or 0)
                except Exception:
                    ls, rs = 0, 0
                if ls != rs:
                    return "upload" if ls > rs else "download"

                lm = float(local_mtime or 0)
                rm = float(remote_mtime or 0)
                if lm == 0 and rm == 0:
                    return "noop"
                return "upload" if lm >= rm else "download"

            action = choose_action()

            if action == "upload":
                if not local_exists:
                    return self._send_json(200, {"ok": False, "error": "local_db_missing"})
                try:
                    DB_IO_LOCK.acquire()
                    try:
                        data = local_path.read_bytes()
                    finally:
                        try:
                            DB_IO_LOCK.release()
                        except Exception:
                            pass
                except Exception as e:
                    return self._send_json(200, {"ok": False, "error": "read_local_failed", "message": str(e)})

                last_error = None
                last_status = None
                last_message = None
                last_url = None
                for candidate in _webdav_candidates(str(webdav_url).strip()):
                    file_url = _webdav_join(candidate, str(remote_filename).lstrip("/")).rstrip("/")
                    last_url = file_url
                    status, resp_body, url_error = _webdav_request(
                        "PUT",
                        file_url,
                        str(username),
                        str(password),
                        data=data,
                        headers={"Content-Type": "application/octet-stream"},
                        timeout=60,
                    )
                    if url_error:
                        last_error = "url_error"
                        last_message = url_error
                        last_status = None
                        break
                    if status in (200, 201, 204):
                        return self._send_json(
                            200,
                            {
                                "ok": True,
                                "action": "upload",
                                "url": file_url,
                                "local": {"exists": local_exists, "size": local_size, "mtime": local_mtime},
                                "remote": {"exists": remote_exists, "size": remote_size, "mtime": remote_mtime},
                            },
                        )
                    last_status = status
                    try:
                        last_message = (resp_body or b"")[:4000].decode("utf-8", errors="replace")
                    except Exception:
                        last_message = None
                    last_error = "http_error"
                    if status == 404:
                        continue
                    break

                hint = None
                try:
                    parsed2 = urlparse(str(webdav_url).strip())
                    if "jianguoyun.com" in (parsed2.netloc or "").lower() and (parsed2.path or "").rstrip("/") == "/dav":
                        hint = "坚果云通常需要使用 https://dav.jianguoyun.com/dav/我的坚果云/ 作为保存目录"
                except Exception:
                    hint = None
                return self._send_json(200, {"ok": False, "error": last_error, "status": last_status, "message": last_message, "url": last_url, "hint": hint})

            if action == "download":
                if not remote_exists:
                    return self._send_json(200, {"ok": False, "error": "remote_db_missing"})

                remote_file_url = remote_stat.get("url")
                status, resp_body, url_error = _webdav_request("GET", str(remote_file_url), str(username), str(password), timeout=60)
                if url_error:
                    return self._send_json(200, {"ok": False, "error": "url_error", "message": url_error, "url": remote_file_url})
                if status != 200:
                    msg = None
                    try:
                        msg = (resp_body or b"")[:4000].decode("utf-8", errors="replace")
                    except Exception:
                        msg = None
                    return self._send_json(200, {"ok": False, "error": "http_error", "status": status, "message": msg, "url": remote_file_url})

                DB_IO_LOCK.acquire()
                try:
                    tmp = None
                    try:
                        with tempfile.NamedTemporaryFile(prefix="openpercento_", suffix=".db", dir=str(ROOT_DIR), delete=False) as f:
                            tmp = f.name
                            f.write(resp_body or b"")
                        os.replace(tmp, str(local_path))
                        tmp = None
                        if remote_mtime:
                            try:
                                os.utime(str(local_path), (float(remote_mtime), float(remote_mtime)))
                            except Exception:
                                pass
                        init_db()
                    finally:
                        if tmp:
                            try:
                                os.unlink(tmp)
                            except Exception:
                                pass
                finally:
                    try:
                        DB_IO_LOCK.release()
                    except Exception:
                        pass

                return self._send_json(
                    200,
                    {
                        "ok": True,
                        "action": "download",
                        "url": remote_file_url,
                        "local": {"exists": True, "size": local_size, "mtime": local_mtime},
                        "remote": {"exists": remote_exists, "size": remote_size, "mtime": remote_mtime},
                    },
                )

            return self._send_json(
                200,
                {
                    "ok": True,
                    "action": "noop",
                    "local": {"exists": local_exists, "size": local_size, "mtime": local_mtime},
                    "remote": {"exists": remote_exists, "size": remote_size, "mtime": remote_mtime},
                },
            )

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
                priceHistory = [row_to_dict(r) for r in conn.execute("SELECT * FROM priceHistory ORDER BY id ASC").fetchall()]
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
                    "priceHistory": priceHistory,
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
                for ph in body.get("priceHistory") or []:
                    conn.execute(
                        """
                        INSERT INTO priceHistory (id, investmentId, date, price, type, symbol, createdAt, updatedAt)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            ph.get("id"),
                            int(ph.get("investmentId") or 0),
                            ph.get("date"),
                            float(ph.get("price") or 0),
                            ph.get("type"),
                            ph.get("symbol"),
                            ph.get("createdAt") or now_iso(),
                            ph.get("updatedAt") or now_iso(),
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
            print(f"Serving on http://{host}:{port}/")
            server.serve_forever()
            return
        except OSError as e:
            last_error = e
            continue

    if last_error:
        raise last_error


if __name__ == "__main__":
    main()
