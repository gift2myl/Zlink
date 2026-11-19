#!/usr/bin/env python3
"""Public Beijing/Lingzhi inventory collector with explicit provenance and stop states.

The current verified installation can parse with Scrapling Selector and perform
ordinary urllib GETs. Native Scrapling Fetcher is unavailable until its optional
dependencies can be installed within the approved scope. No browser is used.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

from scrapling.parser import Selector

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
DEFAULT_URL = "https://ditu.ziroom.com/map?city_code=110000&page_source=homepage_map"
UA = "LingzhiPublicInventory/1.0"
TZ = timezone(timedelta(hours=8))
ALLOWED_HOSTS = {"ditu.ziroom.com", "www.ziroom.com", "ziroom.com"}
SCALAR_FIELDS = {
    "id", "name", "district", "area", "bedrooms", "floor", "totalFloors",
    "orientation", "station", "distance", "product", "sourceUrl", "listingLabel",
    "roomLabel", "areaScope", "bedroomsScope", "longitude", "latitude", "coordinateSystem",
}
NUMERIC_FIELDS = {"area", "bedrooms", "floor", "totalFloors", "distance"}
CHALLENGE_MARKERS = (
    "EO_Bot_Ssid", "__tst_status", "cf-chl-", "captcha", "验证码", "人机验证",
    "访问过于频繁", "安全验证", "verify you are human", "access denied",
)


def now():
    return datetime.now(TZ).isoformat(timespec="seconds")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def safe_url(url):
    u = urllib.parse.urlsplit(str(url))
    if u.scheme != "https" or u.hostname not in ALLOWED_HOSTS or u.username or u.password or u.port not in (None, 443):
        raise ValueError("URL must be a public HTTPS Ziroom URL without credentials.")
    forbidden = re.compile(r"token|cookie|session|auth|password|secret|mobile|phone|email", re.I)
    if any(forbidden.search(k) for k, _ in urllib.parse.parse_qsl(u.query)):
        raise ValueError("Do not place credentials or personal contact fields in a source URL.")
    return urllib.parse.urlunsplit((u.scheme, u.netloc, u.path, u.query, ""))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def native_fetcher_state():
    try:
        from scrapling.fetchers import Fetcher
        return Fetcher, None
    except (ImportError, ModuleNotFoundError) as exc:
        return None, type(exc).__name__ + ": " + str(exc)


class PublicHttp:
    def __init__(self, transport="urllib", timeout=25):
        self.timeout = timeout
        self.fetcher, self.import_error = native_fetcher_state()
        if transport == "native" and self.fetcher is None:
            raise RuntimeError("Native Fetcher is unavailable. Do not install browser/fingerprint dependencies without authorization.")
        self.transport = transport

    @property
    def engine(self):
        return {
            "name": "Scrapling",
            "version": importlib.metadata.version("scrapling"),
            "transport": "urllib" if self.transport == "urllib" else "Scrapling Fetcher",
            "parser": "Scrapling Selector",
            "fetcherAvailable": self.fetcher is not None,
            "fallbackReason": "native_fetcher_dependency_blocked" if self.fetcher is None else None,
            "browserUsed": False,
            "impersonationEnabled": False,
            "stealthHeadersEnabled": False,
        }

    def get(self, url):
        """Exactly one GET, no authentication, cookie jar, redirect, retry, or JS."""
        url = safe_url(url)
        headers = {"User-Agent": UA, "Accept": "text/html,application/json;q=0.9"}
        if self.transport == "native":
            response = self.fetcher.get(
                url, impersonate=None, stealthy_headers=False, headers=headers,
                retries=1, follow_redirects=False, verify=True, timeout=self.timeout,
            )
            body = response.body
            if isinstance(body, str):
                body = body.encode("utf-8")
            return int(response.status), bytes(body), str(response.url), dict(response.headers)
        request = urllib.request.Request(url, headers=headers, method="GET")
        opener = urllib.request.build_opener(NoRedirect())
        try:
            with opener.open(request, timeout=self.timeout) as response:
                body = response.read(8 * 1024 * 1024 + 1)
                if len(body) > 8 * 1024 * 1024:
                    raise ValueError("Response exceeds the 8 MiB public-listing limit.")
                return response.status, body, response.url, dict(response.headers)
        except urllib.error.HTTPError as exc:
            # The status is evidence, not an instruction to try another identity.
            return exc.code, exc.read(8 * 1024 * 1024), url, dict(exc.headers)


def inspect_response(status, body, url, headers):
    html = body.decode("utf-8", errors="replace")
    markers = [marker for marker in CHALLENGE_MARKERS if marker.lower() in html.lower()]
    title = Selector(html).css("title::text").get() or ""
    title = re.sub(r"\s+", " ", title).strip()[:180]
    result = {
        "httpStatus": status, "bodyBytes": len(body), "sha256": hashlib.sha256(body).hexdigest(),
        "title": title or None, "challengeMarkers": markers,
    }
    if markers:
        return result, "challenge_page", "公开地图返回访问校验页，已停止；未执行校验脚本或使用验证 Cookie。"
    if status in (401, 403, 429):
        return result, "access_restricted", "来源返回登录、访问限制或频率限制，已停止且未重试。"
    if 300 <= status < 400:
        return result, "redirect_requires_review", "来源要求跳转，需人工确认目标与访问范围；未自动跟随。"
    if status != 200:
        return result, "http_error", "来源没有返回有效的 HTTP 200 列表内容，已停止。"
    if not body:
        return result, "empty_response", "来源返回空内容，不能认定为房源数量为零。"
    return result, None, None


def base_status(http):
    return {
        "schemaVersion": 1, "engine": http.engine,
        "scope": {"city": "北京", "cityCode": "110000", "filter": "灵之智能"},
        "startedAt": now(), "finishedAt": None, "status": "blocked",
        "filterVerified": False, "paginationVerified": False,
        "pagesFetched": 0, "requestsAttempted": 0, "uniqueCount": 0,
        "isFullInventory": False, "reason": "not_started", "message": "采集尚未开始。",
        "sourceUrl": DEFAULT_URL, "evidence": None,
        "datasetFile": "crawled-properties.json", "pages": [],
    }


def finish(status, new_properties, assets=ASSETS):
    """Zero results preserve an existing data file and never alter properties.json."""
    assets = Path(assets)
    dataset_path = assets / "crawled-properties.json"
    existing = read_json(dataset_path) if dataset_path.exists() else None
    status["finishedAt"] = now()
    status["uniqueCount"] = len({str(p["id"]) for p in new_properties})
    if new_properties:
        previous = {str(p["id"]): p for p in (existing or {}).get("properties", [])}
        if status["isFullInventory"]:
            merged = {str(p["id"]): p for p in new_properties}
            if existing:
                stamp = datetime.now(TZ).strftime("%Y%m%dT%H%M%S%f")
                atomic_json(ROOT / "tools" / "runs" / stamp / "previous-crawled-properties.json", existing)
        else:
            merged = dict(previous)
            merged.update({str(p["id"]): p for p in new_properties})
        dataset = {
            "schemaVersion": 1, "properties": list(merged.values()),
            "source": {
                "observedAt": status["finishedAt"], "filterVerified": status["filterVerified"],
                "isFullInventory": status["isFullInventory"], "sourceUrl": status["sourceUrl"],
                "coverage": "verified_full_run" if status["isFullInventory"] else "partial_with_retained_history",
            },
        }
        atomic_json(dataset_path, dataset)
        status["datasetCount"] = len(dataset["properties"])
        status["retainedHistory"] = not status["isFullInventory"] and bool(previous)
    elif existing is not None:
        status["datasetCount"] = len(existing.get("properties", []))
        status["retainedHistory"] = bool(existing.get("properties"))
    else:
        atomic_json(dataset_path, {
            "schemaVersion": 1, "properties": [],
            "source": {"observedAt": status["finishedAt"], "filterVerified": False, "isFullInventory": False},
        })
        status["datasetCount"] = 0
        status["retainedHistory"] = False
    status["existingDemoSamplesPreserved"] = True
    atomic_json(assets / "crawl-status.json", status)
    stamp = datetime.now(TZ).strftime("%Y%m%dT%H%M%S%f")
    atomic_json(ROOT / "tools" / "runs" / stamp / "manifest.json", status)
    print(json.dumps({k: status[k] for k in ("status", "reason", "pagesFetched", "uniqueCount", "filterVerified", "isFullInventory", "datasetCount")}, ensure_ascii=False))
    return 0 if status["status"] == "complete" else 2 if status["status"] == "blocked" else 3


def value_at(obj, dotted_path):
    current = obj
    for key in dotted_path.split(".") if dotted_path else []:
        if isinstance(current, list) and key.isdecimal():
            current = current[int(key)] if int(key) < len(current) else None
        elif isinstance(current, dict):
            current = current.get(key)
        else:
            return None
    return current


def number(value):
    if value is None or value == "":
        return None
    try:
        value = float(value)
        return int(value) if value.is_integer() else value if math.isfinite(value) else None
    except (TypeError, ValueError, OverflowError):
        return None


def normalize_record(raw, source_url, filter_verified):
    """Allowlisted property fields only: never export raw rows or contact columns."""
    raw = {k: v for k, v in raw.items() if k in SCALAR_FIELDS}
    if not raw.get("id") or not raw.get("name"):
        return None
    result = {k: None for k in ("id", "name", "district", "area", "bedrooms", "floor", "totalFloors", "orientation", "station", "distance", "product", "roomLabel")}
    for key, value in raw.items():
        if key in ("longitude", "latitude"):
            continue
        result[key] = number(value) if key in NUMERIC_FIELDS else re.sub(r"\s+", " ", str(value)).strip()[:500] if value is not None else None
    result["id"] = str(raw["id"])
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", result["id"]):
        return None
    try:
        result["sourceUrl"] = safe_url(raw.get("sourceUrl") or source_url)
    except ValueError:
        result["sourceUrl"] = safe_url(source_url)
    lng, lat = number(raw.get("longitude")), number(raw.get("latitude"))
    result["coordinate"] = [lng, lat] if lng is not None and lat is not None and 115 <= lng <= 118 and 39 <= lat <= 42 else None
    result.update({
        "modelReady": False, "idType": "source_property_id",
        "sourceUrlType": "public_capture", "observedAt": now(),
        "lingzhiFilterReturned": filter_verified is True,
        "lingzhiLabelVisible": "灵之智能" in result["product"] if result.get("product") else None,
    })
    return result


def parse_records(body, config, source_url):
    extraction = config["extraction"]
    mapping = extraction["fields"]
    if not {"id", "name"}.issubset(mapping):
        raise ValueError("Explicit id and name field mappings are required.")
    if set(mapping) - SCALAR_FIELDS:
        raise ValueError("Field mappings must not include personal contact or non-property fields.")
    if extraction["format"] == "json":
        rows = value_at(json.loads(body), extraction["recordPath"])
        if not isinstance(rows, list):
            raise ValueError("The verified JSON record path did not return a list.")
        raw_records = [{key: value_at(row, path) for key, path in mapping.items()} for row in rows]
    elif extraction["format"] == "html":
        rows = Selector(body.decode("utf-8", errors="replace")).css(extraction["recordCss"])
        raw_records = [{key: row.css(css).get() for key, css in mapping.items()} for row in rows]
    else:
        raise ValueError("Only explicitly mapped public HTML and JSON exports are supported.")
    normalized = [normalize_record(row, source_url, config["filter"]["verified"]) for row in raw_records]
    return [row for row in normalized if row], len(raw_records) - sum(row is not None for row in normalized)


def config_issues(config, require_pagination=True):
    issues = []
    if config.get("cityCode") != "110000":
        issues.append("Beijing cityCode 110000 is required")
    f = config.get("filter", {})
    if f.get("name") != "灵之智能" or f.get("verified") is not True or not f.get("evidence"):
        issues.append("the Lingzhi filter and its public evidence are not verified")
    p = config.get("pagination", {})
    if require_pagination and (p.get("verified") is not True or not p.get("evidence")):
        issues.append("pagination semantics are not verified")
    e = config.get("extraction", {})
    if e.get("verified") is not True or not e.get("fields") or e.get("format") not in ("html", "json"):
        issues.append("the public response field mapping is not verified")
    if e.get("format") == "html" and not e.get("recordCss"):
        issues.append("recordCss is required for HTML")
    if e.get("format") == "json" and "recordPath" not in e:
        issues.append("recordPath is required for JSON")
    return issues


def verified_page_url(url, config):
    url = safe_url(url)
    actual = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
    for key, expected in config["filter"].get("requiredQuery", {}).items():
        if actual.get(key) != str(expected):
            raise ValueError("A verified filter query parameter is missing from the page URL.")
    return url


def record_page(status, url, response):
    code, body, final_url, headers = response
    evidence, reason, message = inspect_response(code, body, final_url, headers)
    status["requestsAttempted"] += 1
    status["evidence"] = evidence
    status["pages"].append({"attempt": status["requestsAttempted"], "url": url, "fetchedAt": now(), **evidence})
    return body, reason, message


def run_probe(http, args):
    status = base_status(http)
    # This command intentionally admits only the exact user-provided map URL.
    if args.url != DEFAULT_URL:
        raise ValueError("Probe only supports the exact user-provided map URL.")
    try:
        _, reason, message = record_page(status, args.url, http.get(args.url))
        status.update(reason=reason or "filter_unverified", message=message or "HTTP响应已取得，但灵之筛选与分页未验证，不提取或发布默认地图房源。")
    except Exception as exc:
        status.update(reason="network_error", message="普通HTTP请求未完成，未重试。", errorType=type(exc).__name__)
    return finish(status, [], args.assets)


def run_collect(http, args):
    config = read_json(args.config)
    status = base_status(http)
    status["sourceUrl"] = safe_url(config.get("startUrl", DEFAULT_URL))
    issues = config_issues(config)
    if issues:
        status.update(reason="configuration_unverified", message="筛选、分页或字段映射尚未验证，未发送网络请求。", configurationIssues=issues)
        return finish(status, [], args.assets)
    status["filterVerified"] = True
    status["paginationVerified"] = True
    records, seen_urls, seen_page_ids = {}, set(), set()
    pagination = config["pagination"]
    url = status["sourceUrl"]
    expected_total = config.get("coverage", {}).get("expectedTotal")
    if not isinstance(expected_total, int) or isinstance(expected_total, bool) or expected_total < 0:
        expected_total = None
    end_verified = False
    for index in range(min(int(pagination.get("maxPages", 500)), 1000)):
        try:
            url = verified_page_url(url, config)
            if url in seen_urls:
                raise ValueError("Pagination repeats a URL.")
            seen_urls.add(url)
            if index:
                time.sleep(max(2.0, min(float(config.get("delaySeconds", 2)), 30)))
            body, reason, message = record_page(status, url, http.get(url))
            if reason:
                status.update(reason=reason, message=message)
                break
            page_records, rejected = parse_records(body, config, url)
            status["pages"][-1].update(records=len(page_records), rejectedRecords=rejected)
            if rejected:
                status.update(reason="invalid_record", message="存在缺少真实ID或必要字段的记录，已停止以免误报完整性。")
                break
            if not page_records:
                status.update(reason="empty_page_requires_review", message="当前页未提取到记录，需核对页面和选择器，不能直接认定为末页或零库存。")
                break
            status["pagesFetched"] += 1
            signature = tuple(sorted(p["id"] for p in page_records))
            if page_records and signature in seen_page_ids:
                status.update(reason="pagination_repeats_content", message="分页返回重复内容，已停止，不能认定已经翻页。")
                break
            seen_page_ids.add(signature)
            records.update({p["id"]: p for p in page_records})
            if expected_total is not None and len(records) == expected_total:
                end_verified = True
                status.update(reason="verified_total_reached", message="已核验筛选及分页，唯一房源数与来源的精确总数一致。")
                break
            if pagination["mode"] == "next_link":
                next_href = Selector(body.decode("utf-8", errors="replace")).css(pagination["nextCss"]).get()
                if not next_href:
                    status.update(reason="end_without_exact_total", message="页面没有下一页链接，但缺少精确总量校验，保留部分采集状态。")
                    break
                url = urllib.parse.urljoin(url, next_href)
            elif pagination["mode"] == "query":
                parts = urllib.parse.urlsplit(url)
                params = dict(urllib.parse.parse_qsl(parts.query))
                key = pagination["pageParam"]
                params[key] = str(int(pagination.get("startPage", 1)) + index + 1)
                url = urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(params), ""))
            else:
                raise ValueError("Unsupported pagination mode; implement only from confirmed public evidence.")
        except Exception as exc:
            status.update(reason="collection_error", message="采集出现异常，已停止并保留已取得记录。", errorType=type(exc).__name__)
            break
    else:
        status.update(reason="page_limit_reached", message="已到达配置页数上限，尚未证明全量。")
    status["isFullInventory"] = bool(end_verified and config.get("coverage", {}).get("totalEvidence"))
    status["status"] = "complete" if status["isFullInventory"] else "partial" if records else "blocked"
    return finish(status, list(records.values()), args.assets)


def run_adapt(http, args):
    """Adapt a user-authorized public export; never call the website."""
    config = read_json(args.config)
    status = base_status(http)
    status["sourceUrl"] = safe_url(config.get("startUrl", DEFAULT_URL))
    issues = config_issues(config, require_pagination=False)
    if config.get("extraction", {}).get("format") != "json":
        issues.append("adapt-json requires a verified JSON field mapping")
    if issues:
        status.update(reason="configuration_unverified", message="公开清单的城市、筛选或字段映射尚未验证，未导入数据或发送网络请求。", configurationIssues=issues)
        return finish(status, [], args.assets)
    status["filterVerified"] = config["filter"]["verified"] is True
    body = Path(args.input).read_bytes()
    records, rejected = parse_records(body, config, status["sourceUrl"])
    status.update(status="partial" if records else "blocked", reason="authorized_export_adapted",
                  message="已适配用户提供的公开清单，未发送网络请求；不自动认定全量。",
                  rejectedRecords=rejected, inputSha256=hashlib.sha256(body).hexdigest())
    return finish(status, list({r["id"]: r for r in records}.values()), args.assets)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", type=Path, default=ASSETS)
    parser.add_argument("--transport", choices=["urllib", "native"], default="urllib")
    sub = parser.add_subparsers(dest="mode", required=True)
    probe = sub.add_parser("probe", help="One ordinary request to the exact supplied URL; never paginate.")
    probe.add_argument("--url", default=DEFAULT_URL)
    collect = sub.add_parser("collect", help="Run only with independently verified filters, fields and pagination.")
    collect.add_argument("--config", type=Path, required=True)
    adapt = sub.add_parser("adapt-json", help="Adapt a user-authorized public listing export without a network request.")
    adapt.add_argument("--input", type=Path, required=True)
    adapt.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    http = PublicHttp(args.transport)
    return {"probe": run_probe, "collect": run_collect, "adapt-json": run_adapt}[args.mode](http, args)


if __name__ == "__main__":
    raise SystemExit(main())
