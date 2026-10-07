"""Local, read-only Toss Securities fee analyzer. Python 3.10+, stdlib only."""
from __future__ import annotations

import csv
import io
import json
import os
import secrets
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation, localcontext
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

BASE = "https://openapi.tossinvest.com"
ROOT = Path(__file__).resolve().parent
KST = timezone(timedelta(hours=9))
LIMITATION = (
    "API가 반환한 주문의 매매 수수료 합계입니다. 장전·장후 시간외 종가 등 미지원 주문, "
    "해지·휴면 계좌, 환전 수수료 및 별도 입출금 비용은 포함되지 않습니다. "
    "계좌 개설 이후 전체 비용은 거래내역서와 대조해야 확정할 수 있습니다."
)


class DataError(ValueError):
    pass


def decimal(value, field, *, nullable=False):
    if value is None and nullable:
        return None
    if not isinstance(value, (str, int)) or isinstance(value, bool):
        raise DataError(f"{field}: 금액·수량 형식이 올바르지 않습니다.")
    try:
        number = Decimal(value)
    except InvalidOperation:
        raise DataError(f"{field}: 숫자로 해석할 수 없습니다.") from None
    if not number.is_finite() or len(number.as_tuple().digits) > 40 or abs(number.as_tuple().exponent) > 20:
        raise DataError(f"{field}: 숫자 범위를 확인하세요.")
    return number


def money(value):
    return format(value, "f")


def analyze(accounts):
    """One aggregate execution per (account, order); never sum partial-fill snapshots."""
    with localcontext() as context:
        context.prec = 80
        return _analyze(accounts)


def _analyze(accounts):
    totals = {}
    months = defaultdict(lambda: {"commission": Decimal(0), "tax": Decimal(0), "count": 0})
    rows, seen, duplicates, dates = [], {}, 0, []
    for account in accounts:
        for order in account["orders"]:
            order_id = order.get("orderId")
            if not isinstance(order_id, str) or not order_id:
                raise DataError("주문 식별자가 없어 중복을 검사할 수 없습니다.")
            key = (str(account["accountSeq"]), order_id)
            if key in seen:
                if seen[key] != order:
                    raise DataError("조회 도중 같은 주문의 정보가 변경됐습니다. 잠시 후 다시 조회하세요.")
                duplicates += 1
                continue
            seen[key] = order
            ex = order.get("execution")
            if not isinstance(ex, dict):
                raise DataError("주문의 체결 정보가 없습니다.")
            quantity = decimal(ex.get("filledQuantity"), "체결 수량")
            if quantity < 0:
                raise DataError("체결 수량이 음수입니다.")
            if quantity == 0:
                continue
            currency = order.get("currency")
            if currency not in ("KRW", "USD"):
                raise DataError("지원되지 않는 통화입니다. 원본 거래내역을 확인하세요.")
            commission = decimal(ex.get("commission"), "수수료", nullable=True)
            tax = decimal(ex.get("tax"), "세금", nullable=True)
            filled_at = ex.get("filledAt")
            month = "날짜 미확인"
            if filled_at:
                try:
                    dt = datetime.fromisoformat(filled_at.replace("Z", "+00:00"))
                    if dt.tzinfo is None:
                        raise ValueError()
                    day = dt.astimezone(KST).date().isoformat()
                except (ValueError, AttributeError):
                    raise DataError("체결 일시 형식이 올바르지 않습니다.") from None
                month = day[:7]
                dates.append(day)
            settled = bool(ex.get("settlementDate"))
            bucket = totals.setdefault(currency, {
                "commission": Decimal(0), "tax": Decimal(0),
                "settledCommission": Decimal(0), "unsettledCommission": Decimal(0),
                "missingCommission": 0, "missingTax": 0, "count": 0,
            })
            bucket["count"] += 1
            monthly = months[(month, currency)]
            monthly["count"] += 1
            if commission is None:
                bucket["missingCommission"] += 1
            else:
                bucket["commission"] += commission
                bucket["settledCommission" if settled else "unsettledCommission"] += commission
                monthly["commission"] += commission
            if tax is None:
                bucket["missingTax"] += 1
            else:
                bucket["tax"] += tax
                monthly["tax"] += tax
            rows.append({
                "account": account["label"], "orderId": order_id,
                "symbol": order.get("symbol", ""), "side": order.get("side", ""),
                "status": order.get("status", ""), "currency": currency,
                "filledAt": filled_at or "", "filledQuantity": money(quantity),
                "commission": None if commission is None else money(commission),
                "tax": None if tax is None else money(tax),
                "settlementDate": ex.get("settlementDate") or "",
            })
    def serial(bucket):
        return {k: money(v) if isinstance(v, Decimal) else v for k, v in bucket.items()}
    return {
        "source": "Toss Securities Open API", "lifetimeVerified": False,
        "limitation": LIMITATION, "accountCount": len(accounts),
        "orderCount": len(seen), "filledCount": len(rows), "duplicatesRemoved": duplicates,
        "firstFill": min(dates) if dates else None, "lastFill": max(dates) if dates else None,
        "totals": {currency: serial(bucket) for currency, bucket in totals.items()},
        "months": [{"month": month, "currency": currency, **serial(bucket)}
                   for (month, currency), bucket in sorted(months.items(), reverse=True)],
        "rows": sorted(rows, key=lambda row: row["filledAt"], reverse=True),
        "queriedAt": datetime.now(KST).isoformat(),
    }


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class TossClient:
    def __init__(self, client_id, client_secret):
        self.client_id, self.client_secret = client_id, client_secret
        self.token = None
        self.next_request = 0.0
        self.opener = build_opener(NoRedirect())

    def _request(self, path, *, account=None, query=None, form=None):
        # No order placement/modification/cancellation endpoint is implemented.
        if path not in ("/oauth2/token", "/api/v1/accounts", "/api/v1/orders", "/api/v1/exchange-rate"):
            raise DataError("허용되지 않은 API 경로입니다.")
        if (form is not None) != (path == "/oauth2/token"):
            raise DataError("허용되지 않은 API 요청 방식입니다.")
        headers = {"Accept": "application/json", "User-Agent": "Local-Toss-Fee-Analyzer/1.0"}
        data = None
        if form is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            data = urlencode(form).encode()
        else:
            headers["Authorization"] = f"Bearer {self.token}"
        if account is not None:
            headers["X-Tossinvest-Account"] = str(account)
        url = BASE + path + ("?" + urlencode(query) if query else "")
        for attempt in range(4):
            time.sleep(max(0, self.next_request - time.monotonic()))
            self.next_request = time.monotonic() + 0.3
            try:
                with self.opener.open(Request(url, data=data, headers=headers), timeout=30) as response:
                    payload = json.load(response)
                if not isinstance(payload, dict) or "error" in payload:
                    raise DataError("토스 API가 오류를 반환했습니다. 합계를 확정하지 않았습니다.")
                if form is not None:
                    return payload
                if "result" not in payload:
                    raise DataError("API 응답에 result가 없습니다.")
                return payload["result"]
            except HTTPError as error:
                if error.code == 429 and attempt < 3:
                    try:
                        delay = min(30, max(1, float(error.headers.get("Retry-After", 2 ** attempt))))
                    except ValueError:
                        delay = 2 ** attempt
                    time.sleep(delay)
                    continue
                messages = {
                    400: "API 요청이 거절됐습니다. 입력값과 API 명세를 확인하세요.",
                    401: "인증에 실패했거나 토큰이 만료됐습니다. 키를 확인하고 다시 조회하세요.",
                    403: "접근이 거절됐습니다. 토스 Open API 이용 상태와 허용 IP를 확인하세요.",
                    429: "API 호출 제한에 도달했습니다. 잠시 후 다시 조회하세요.",
                }
                raise DataError(messages.get(error.code, f"토스 API HTTP {error.code} 오류입니다. 다시 조회하세요.")) from None
            except (URLError, TimeoutError, OSError):
                raise DataError("토스 API에 연결할 수 없습니다. 네트워크를 확인하세요.") from None
            except (json.JSONDecodeError, UnicodeError):
                raise DataError("토스 API가 올바른 JSON을 반환하지 않았습니다.") from None

    def collect(self, progress=lambda value: None, *, include_rates=False):
        auth = self._request("/oauth2/token", form={
            "grant_type": "client_credentials", "client_id": self.client_id,
            "client_secret": self.client_secret,
        })
        self.token = auth.get("access_token")
        if not isinstance(self.token, str) or not self.token:
            raise DataError("액세스 토큰을 받지 못했습니다.")
        accounts = self._request("/api/v1/accounts")
        if not isinstance(accounts, list):
            raise DataError("계좌 목록 형식이 올바르지 않습니다.")
        result = []
        account_ids = set()
        for index, account in enumerate(accounts, 1):
            account_seq = account.get("accountSeq")
            if account_seq is None or account_seq in account_ids:
                raise DataError("계좌 식별자가 없거나 중복됐습니다.")
            account_ids.add(account_seq)
            item = {"accountSeq": account_seq, "label": f"계좌 {index}", "orders": []}
            for status in ("CLOSED", "OPEN"):
                query = {"status": status, "limit": 100}
                cursors = set()
                while True:
                    page = self._request("/api/v1/orders", account=account_seq, query=query)
                    if (not isinstance(page, dict) or not isinstance(page.get("orders"), list)
                            or type(page.get("hasNext")) is not bool or "nextCursor" not in page):
                        raise DataError("페이지 응답이 불완전합니다. 합계를 확정하지 않았습니다.")
                    item["orders"].extend(page["orders"])
                    progress(f"계좌 {index}/{len(accounts)} · 주문 {len(item['orders']):,}건 조회 중")
                    if not page["hasNext"]:
                        if page["nextCursor"] is not None:
                            raise DataError("페이지 종료 정보가 서로 일치하지 않습니다.")
                        break
                    cursor = page["nextCursor"]
                    if status == "OPEN" or not isinstance(cursor, str) or not cursor or cursor in cursors:
                        raise DataError("페이지 커서가 없거나 반복됩니다. 전체 조회에 실패했습니다.")
                    cursors.add(cursor)
                    query["cursor"] = cursor
            result.append(item)
        report = analyze(result)
        if include_rates:
            from reference_rates import add_reference_rates
            add_reference_rates(report, self._request, progress)
        return report


def csv_report(report):
    stream = io.StringIO(newline="")
    fields = ["account", "orderId", "symbol", "side", "status", "currency", "filledAt",
              "filledQuantity", "commission", "tax", "settlementDate"]
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    for row in report["rows"]:
        # Prevent spreadsheet formula execution when exporting untrusted strings.
        writer.writerow({k: ("'" + str(v) if k not in ("commission", "tax", "filledQuantity")
                              and str(v).startswith(("=", "+", "-", "@", "\t", "\r", "\n")) else v)
                         for k, v in row.items()})
    return stream.getvalue().encode("utf-8-sig")


class FeeServer(ThreadingHTTPServer):
    def __init__(self, address, *, load_saved=True):
        super().__init__(address, Handler)
        self.csrf = secrets.token_urlsafe(32)
        self.lock = threading.Lock()
        self.state = {"status": "idle", "message": "API 연결을 기다리고 있어요."}
        self.report = None
        saved = ROOT / 'reports' / 'ui-observations.json'
        if load_saved and saved.exists() and saved.stat().st_size <= 16000000:
            try:
                from ui_import import analyze_observations
                self.report = analyze_observations(json.loads(saved.read_text(encoding='utf-8')))
                self.state = {"status":"done", "message":"이 PC에 저장된 거래 분석을 불러왔어요."}
            except (ValueError, TypeError, KeyError, OSError):
                self.state = {"status":"error", "message":"저장된 내역을 검증하지 못했어요. 원본을 다시 가져오세요."}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, data, content_type="application/json; charset=utf-8"):
        if isinstance(data, dict):
            data = json.dumps(data, ensure_ascii=False).encode()
        elif isinstance(data, str):
            data = data.encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(data)

    def trusted(self):
        host = f"127.0.0.1:{self.server.server_port}"
        if self.headers.get("Host") != host:
            self.reply(403, {"error": "로컬 주소로 접속하세요."})
            return False
        if self.headers.get("Origin") not in (None, f"http://{host}"):
            self.reply(403, {"error": "외부 페이지의 접근은 허용하지 않습니다."})
            return False
        return True

    def do_GET(self):
        if not self.trusted():
            return
        path = urlsplit(self.path).path
        static = {"/": ("index.html", "text/html; charset=utf-8"),
                  "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                  "/style.css": ("style.css", "text/css; charset=utf-8")}
        if path.startswith('/audit/'):
            name = path[len('/audit/'):] or 'index.html'
            allowed = {'index.html':'text/html', 'app.js':'text/javascript', 'engine.js':'text/javascript', 'audit.js':'text/javascript', 'audit-ui.js':'text/javascript', 'bridge.js':'text/javascript', 'style.css':'text/css'}
            if name not in allowed:
                return self.reply(404, {"error":"없는 경로입니다."})
            return self.reply(200, (ROOT / 'audit' / name).read_bytes(), allowed[name]+'; charset=utf-8')
        if path in static:
            name, content_type = static[path]
            return self.reply(200, (ROOT / "web" / name).read_bytes(), content_type)
        if path == "/api/state":
            with self.server.lock:
                return self.reply(200, {**self.server.state, "csrf": self.server.csrf})
        if path in ("/api/report", "/api/export.csv"):
            with self.server.lock:
                report = self.server.report
            if report is None:
                return self.reply(404, {"error": "아직 완료된 분석이 없습니다."})
            if path.endswith(".csv"):
                return self.reply(200, csv_report(report), "text/csv; charset=utf-8")
            return self.reply(200, report)
        self.reply(404, {"error": "없는 경로입니다."})

    def do_POST(self):
        if not self.trusted():
            return
        if self.path not in ("/api/analyze", "/api/import-ui"):
            return self.reply(404, {"error": "없는 경로입니다."})
        if self.headers.get("X-CSRF-Token") != self.server.csrf:
            return self.reply(403, {"error": "페이지를 새로고침하세요."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= (16000000 if self.path == "/api/import-ui" else 16384):
                raise ValueError()
            payload = json.loads(self.rfile.read(length))
            if self.path == "/api/import-ui":
                from ui_import import analyze_observations
                folder = ROOT / 'reports'
                folder.mkdir(exist_ok=True)
                (folder / 'ui-observations.pending.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
                try:
                    report = analyze_observations(payload)
                except ValueError as error:
                    return self.reply(400, {"error": str(error)})
                with self.server.lock:
                    if self.server.state['status'] == 'running':
                        return self.reply(409, {"error": "이미 조회 중입니다."})
                    folder = ROOT / 'reports'
                    folder.mkdir(exist_ok=True)
                    (folder / 'ui-observations.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
                    (folder / 'ui-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
                    self.server.report = report
                    self.server.state = {"status":"done", "message":"조회된 주식·환전 목록의 금액 대조를 완료했어요." if report.get('listCoverageVerified') else "화면에서 확인한 내역을 내 PC에 저장했어요. 부분 합계입니다."}
                return self.reply(200, {"status":"done"})
            client_id = payload.get("clientId", "").strip() or os.environ.get("TOSSINVEST_CLIENT_ID", "")
            client_secret = payload.get("clientSecret", "").strip() or os.environ.get("TOSSINVEST_CLIENT_SECRET", "")
            if not client_id or not client_secret:
                return self.reply(400, {"error": "Client ID와 Client Secret을 입력하세요. 채팅에 보내지 않아도 됩니다."})
        except (ValueError, AttributeError, TypeError):
            return self.reply(400, {"error": "입력 형식이 올바르지 않습니다."})
        with self.server.lock:
            if self.server.state["status"] == "running":
                return self.reply(409, {"error": "이미 조회 중입니다."})
            self.server.report = None
            self.server.state = {"status": "running", "message": "토스 API에 연결하고 있어요."}
        def run():
            client = TossClient(client_id, client_secret)
            def progress(message):
                with self.server.lock:
                    self.server.state = {"status": "running", "message": message}
            try:
                report = client.collect(progress, include_rates=payload.get("referenceRates") is True)
                with self.server.lock:
                    self.server.report = report
                    self.server.state = {"status": "done", "message": "조회 가능한 모든 페이지를 분석했어요."}
            except Exception as error:
                # Never emit raw API bodies, tokens, or exception details to logs/UI.
                message = str(error) if isinstance(error, DataError) else "예상하지 못한 응답입니다. 합계를 확정하지 않았습니다."
                with self.server.lock:
                    self.server.state = {"status": "error", "message": message}
            finally:
                client.token = client.client_id = client.client_secret = None
        threading.Thread(target=run, daemon=True).start()
        self.reply(202, {"status": "running"})


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="토스증권 수수료 분석기")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    server = FeeServer(("127.0.0.1", args.port))
    print(f"Toss fee analyzer: http://127.0.0.1:{server.server_port}", flush=True)
    print("Stop: Ctrl+C. Credentials and reports are kept in memory only.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
