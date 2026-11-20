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
    "businessArea", "realListingId", "sourceBatchId",
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


def real_listing_id(record):
    """Use confirmed identity or an observed public detail URL, never a map index."""
    explicit = str(record.get("realListingId") or "").strip()
    if explicit and re.fullmatch(r"[0-9]+", explicit):
        return explicit
    identifier = str(record.get("id") or "").strip()
    if record.get("idType") == "ziroom_property_id" and identifier.isdecimal():
        return identifier
    try:
        parsed = urllib.parse.urlsplit(str(record.get("sourceUrl") or ""))
        if parsed.hostname in ALLOWED_HOSTS:
            match = re.fullmatch(r"/x/([0-9]+)\.html", parsed.path)
            if match:
                return match.group(1)
    except ValueError:
        pass
    return None


def record_key(record):
    listing_id = real_listing_id(record)
    if listing_id:
        return "ziroom:" + listing_id
    return "record:" + str(record.get("sourceBatchId") or "saved-map-list") + ":" + str(record.get("id"))


def merge_cumulative(previous, incoming):
    """Retain successful observations even after a complete later run."""
    merged = {}
    incoming_keys = {record_key(row) for row in incoming}
    for row in previous:
        if not row or not row.get("id") or not row.get("name") or row.get("imported") or row.get("sourceKind") == "imported":
            continue
        saved = dict(row)
        saved.setdefault("firstSeen", row.get("observedAt"))
        saved.setdefault("lastSeen", row.get("observedAt"))
        saved["seenInLatestRun"] = record_key(row) in incoming_keys
        # Absence from a page is not proof that a property was delisted.
        saved.setdefault("currentAvailability", "unknown")
        merged[record_key(row)] = saved
    for row in incoming:
        if not row or not row.get("id") or not row.get("name") or row.get("imported") or row.get("sourceKind") == "imported":
            continue
        key = record_key(row)
        old = merged.get(key, {})
        # A missing optional field in a newer capture does not erase old evidence.
        saved = {**old, **{k: v for k, v in row.items() if v is not None}}
        saved["firstSeen"] = old.get("firstSeen") or row.get("firstSeen") or row.get("observedAt")
        saved["lastSeen"] = row.get("lastSeen") or row.get("observedAt") or old.get("lastSeen")
        saved["seenInLatestRun"] = True
        saved.setdefault("currentAvailability", "unknown")
        merged[key] = saved
    return list(merged.values())


def finish(status, new_properties, assets=ASSETS):
    """Persist cumulative observations; zero new rows never clear saved data."""
    assets = Path(assets)
    dataset_path = assets / "crawled-properties.json"
    existing = read_json(dataset_path) if dataset_path.exists() else None
    status["finishedAt"] = now()
    current = merge_cumulative([], new_properties)
    previous = (existing or {}).get("properties", [])
    original_path = assets / "properties.json"
    original_records = read_json(original_path).get("properties", []) if original_path.exists() else []
    prior_keys = {record_key(row) for row in merge_cumulative(original_records, previous)}
    status["uniqueCount"] = len(current)
    status["newlyAddedCount"] = len({record_key(row) for row in current} - prior_keys)
    status["updatedCount"] = len({record_key(row) for row in current} & prior_keys)
    if current:
        merged = merge_cumulative(previous, current)
        dataset = {
            "schemaVersion": 1, "properties": merged,
            "source": {
                "observedAt": status["finishedAt"], "filterVerified": status["filterVerified"],
                "isFullInventory": bool(status["isFullInventory"] and len(merged) == len(current)),
                "latestRunIsFullInventory": status["isFullInventory"],
                "sourceUrl": status["sourceUrl"], "coverage": "cumulative_collected_records",
                "latestRunPropertyKeys": [record_key(row) for row in current],
                "availabilityPolicy": "Absence from a later capture does not prove delisting; currentAvailability remains unknown unless explicit source evidence exists.",
            },
        }
        atomic_json(dataset_path, dataset)
        status["datasetCount"] = len(merged)
        status["retainedHistory"] = bool(previous)
    elif existing is not None:
        status["datasetCount"] = len(merge_cumulative([], previous))
        status["retainedHistory"] = bool(previous)
    else:
        atomic_json(dataset_path, {
            "schemaVersion": 1, "properties": [],
            "source": {"observedAt": status["finishedAt"], "filterVerified": False, "isFullInventory": False},
        })
        status["datasetCount"] = 0
        status["retainedHistory"] = False
    saved_records = read_json(dataset_path).get("properties", [])
    status["cumulativeCollectedCount"] = len(merge_cumulative(original_records, saved_records))
    status["existingDemoSamplesPreserved"] = True
    atomic_json(assets / "crawl-status.json", status)
    stamp = datetime.now(TZ).strftime("%Y%m%dT%H%M%S%f")
    atomic_json(assets.parent / "tools" / "runs" / stamp / "manifest.json", status)
    print(json.dumps({k: status[k] for k in ("status", "reason", "pagesFetched", "uniqueCount", "newlyAddedCount", "filterVerified", "isFullInventory", "datasetCount")}, ensure_ascii=False))
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


def normalize_record(raw, source_url, filter_verified, observed_at=None):
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
        result["sourceUrl"] = safe_url(urllib.parse.urljoin(source_url, raw.get("sourceUrl") or source_url))
    except ValueError:
        result["sourceUrl"] = safe_url(source_url)
    lng, lat = number(raw.get("longitude")), number(raw.get("latitude"))
    result["coordinate"] = [lng, lat] if lng is not None and lat is not None and 115 <= lng <= 118 and 39 <= lat <= 42 else None
    result.update({
        "modelReady": False, "idType": "source_property_id",
        "sourceUrlType": "public_capture", "observedAt": observed_at,
        "lingzhiFilterReturned": filter_verified is True,
        "lingzhiLabelVisible": "灵之智能" in result["product"] if result.get("product") else None,
    })
    return result


def parse_records(body, config, source_url, observed_at=None):
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
    normalized = [normalize_record(row, source_url, config["filter"]["verified"], observed_at) for row in raw_records]
    for row in normalized:
        if row is None:
            continue
        if extraction.get("idType") == "ziroom_property_id" and extraction.get("identityEvidence") and str(row["id"]).isdecimal():
            row["idType"] = "ziroom_property_id"
            row["realListingId"] = str(row["id"])
        elif real_listing_id(row):
            row["realListingId"] = real_listing_id(row)
            row["idType"] = "ziroom_property_id"
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
            page_records, rejected = parse_records(body, config, url, observed_at=now())
            status["pages"][-1].update(records=len(page_records), rejectedRecords=rejected)
            if rejected:
                records.update({record_key(p): p for p in page_records})
                status["pagesFetched"] += bool(page_records)
                status.update(reason="invalid_record", message="已保留本页可用记录；存在缺少必要字段的记录，停止并保持部分采集状态。", rejectedRecords=rejected)
                break
            if not page_records:
                status.update(reason="empty_page_requires_review", message="当前页未提取到记录，需核对页面和选择器，不能直接认定为末页或零库存。")
                break
            status["pagesFetched"] += 1
            signature = tuple(sorted(record_key(p) for p in page_records))
            if page_records and signature in seen_page_ids:
                status.update(reason="pagination_repeats_content", message="分页返回重复内容，已停止，不能认定已经翻页。")
                break
            seen_page_ids.add(signature)
            records.update({record_key(p): p for p in page_records})
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
    status["unknownIdentityCount"] = sum(real_listing_id(record) is None for record in records.values())
    coverage = config.get("coverage", {})
    status["citywideVerified"] = coverage.get("citywideVerified") is True and bool(coverage.get("citywideEvidence")) and coverage.get("viewportLimited") is False
    status["isFullInventory"] = bool(end_verified and coverage.get("totalEvidence") and not status["unknownIdentityCount"] and status["citywideVerified"])
    if end_verified and status["unknownIdentityCount"]:
        status.update(reason="identity_incomplete", message="记录数量达到来源总数，但部分房源身份未核验，仍为部分采集。")
    elif end_verified and not status["citywideVerified"]:
        status.update(reason="scope_incomplete", message="记录数达到当前查询总数，但尚未证明覆盖北京全城而非地图视窗或区域子集。")
    status["status"] = "complete" if status["isFullInventory"] else "partial" if records else "blocked"
    return finish(status, list(records.values()), args.assets)


def run_adapt(http, args):
    """Adapt a user-authorized public export; never call the website."""
    config = read_json(args.config)
    status = base_status(http)
    status["sourceUrl"] = safe_url(config.get("startUrl", DEFAULT_URL))
    issues = config_issues(config, require_pagination=False)
    expected_format = "html" if args.mode == "adapt-html" else "json"
    if config.get("extraction", {}).get("format") != expected_format:
        issues.append(args.mode + " requires a verified " + expected_format.upper() + " field mapping")
    if issues:
        status.update(reason="configuration_unverified", message="公开清单的城市、筛选或字段映射尚未验证，未导入数据或发送网络请求。", configurationIssues=issues)
        return finish(status, [], args.assets)
    status["filterVerified"] = config["filter"]["verified"] is True
    body = Path(args.input).read_bytes()
    evidence, reason, message = inspect_response(200, body, status["sourceUrl"], {})
    if reason:
        status.update(reason=reason, message=message, evidence=evidence)
        return finish(status, [], args.assets)
    captured_at = config.get("capture", {}).get("observedAt")
    records, rejected = parse_records(body, config, status["sourceUrl"], observed_at=captured_at)
    status.update(status="partial" if records else "blocked", reason="authorized_export_adapted",
                  message="已适配用户提供的公开清单，未发送网络请求；不自动认定全量。",
                  rejectedRecords=rejected, inputSha256=hashlib.sha256(body).hexdigest())
    return finish(status, merge_cumulative([], records), args.assets)



def safe_reference_url(value, source_url):
    """Keep only observed public references; this function performs no request."""
    value = str(value or "").strip()
    if not value or value.startswith(("data:", "javascript:", "blob:")):
        return None
    try:
        u = urllib.parse.urlsplit(urllib.parse.urljoin(source_url, value))
        host = u.hostname or ""
        if u.scheme not in ("https", "http") or not host or u.username or u.password:
            return None
        if host in {"localhost", "127.0.0.1", "::1"} or host.endswith((".local", ".internal")):
            return None
        if re.search(r"^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)", host):
            return None
        if any(re.search(r"token|cookie|session|auth|password|secret|mobile|phone|email", key, re.I) for key, _ in urllib.parse.parse_qsl(u.query)):
            return None
        return urllib.parse.urlunsplit((u.scheme, u.netloc, u.path, u.query, ""))
    except ValueError:
        return None


def inspect_offline_html(body, source_url, observed_at=None):
    """Discover actual hyperlinks with Scrapling; never synthesize endpoints/assets."""
    source_url = safe_url(source_url)
    evidence, reason, message = inspect_response(200, body, source_url, {})
    result = {
        "schemaVersion": 1, "sourceUrl": source_url, "observedAt": observed_at,
        "processedAt": now(), "engine": "Scrapling Selector", "networkRequests": 0,
        "isFullInventory": False, "filterVerified": False, "evidence": evidence,
        "status": "blocked" if reason else "parsed_offline", "reason": reason,
        "message": message, "listingLinks": [], "references": [],
    }
    if reason:
        return result
    selector = Selector(body.decode("utf-8", errors="replace"))
    page_id = real_listing_id({"sourceUrl": source_url})
    result["realListingId"] = page_id
    links, references = {}, {}
    for node in selector.css("a[href], iframe[src], img[src], img[data-src], img[data-original]"):
        attributes = dict(node.attrib)
        label = " ".join(str(attributes.get(k) or "") for k in ("alt", "title", "aria-label"))
        if node.css("a").get() or "href" in attributes:
            label += " " + node.get_all_text()
        label = re.sub(r"\s+", " ", label).strip()[:180]
        attr = next((k for k in ("href", "data-original", "data-src", "src") if attributes.get(k)), None)
        url = safe_reference_url(attributes.get(attr), source_url) if attr else None
        if not url:
            continue
        candidate_id = real_listing_id({"sourceUrl": url})
        if candidate_id:
            links[candidate_id] = {"realListingId": candidate_id, "url": url, "label": label, "sourceUrl": source_url, "observedAt": observed_at}
        lowered = (label + " " + url).lower()
        kind = "floorplan" if re.search(r"户型|平面图|floorplan|floor.plan", lowered) else "vr" if re.search(r"全景|vr看房|(?:^|[^a-z])vr(?:[^a-z]|$)|panorama|3dtour", lowered) else None
        if not kind:
            continue
        # A list/map capture can expose a reference, but cannot attach it to a house.
        references[(kind, url)] = {
            "kind": kind, "url": url, "realListingId": page_id,
            "association": "observed_on_detail_page" if page_id else "unassigned_list_reference",
            "sourceUrl": source_url, "observedAt": observed_at,
            "evidence": {"attribute": attr, "label": label},
            "downloaded": False, "visuallyVerified": False,
            "usableForReconstruction": False,
        }
    result["listingLinks"] = list(links.values())
    result["references"] = list(references.values())
    result["notes"] = ["只保存原页面实际出现的链接，未请求或下载图片、VR。", "参考素材需核验房源归属及实际内容后才可进入三维重建。", "网页出现VR链接不等于获得可导出的三维几何或工程尺寸。"]
    return result


def run_inspect_html(http, args):
    result = inspect_offline_html(Path(args.input).read_bytes(), args.source_url, args.observed_at)
    atomic_json(args.output, result)
    print(json.dumps({"status": result["status"], "listingLinks": len(result["listingLinks"]), "references": len(result["references"]), "networkRequests": 0, "output": str(args.output)}, ensure_ascii=False))
    return 2 if result["status"] == "blocked" else 0


def known_source_block(assets):
    path = Path(assets) / "source-access-status.json"
    if not path.exists():
        return None
    status = read_json(path)
    return status if status.get("networkCollectionAllowed") is False and status.get("status") == "blocked" else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", type=Path, default=ASSETS)
    parser.add_argument("--transport", choices=["urllib", "native"], default="urllib")
    sub = parser.add_subparsers(dest="mode", required=True)
    probe = sub.add_parser("probe", help="One ordinary request to the exact supplied URL; never paginate.")
    probe.add_argument("--url", default=DEFAULT_URL)
    collect = sub.add_parser("collect", help="Run only with independently verified filters, fields and pagination.")
    collect.add_argument("--config", type=Path, required=True)
    for command in ("adapt-json", "adapt-html"):
        adapt = sub.add_parser(command, help="Adapt an authorized public listing export without a network request.")
        adapt.add_argument("--input", type=Path, required=True)
        adapt.add_argument("--config", type=Path, required=True)
    inspect = sub.add_parser("inspect-html", help="Discover actual listing, floorplan and VR links in a saved official page; never fetch them.")
    inspect.add_argument("--input", type=Path, required=True)
    inspect.add_argument("--source-url", required=True)
    inspect.add_argument("--observed-at", default=None)
    inspect.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.mode in ("probe", "collect"):
        block = known_source_block(args.assets)
        if block:
            print(json.dumps({"status": "blocked", "reason": "prior_source_challenge", "networkRequests": 0, "lastNetworkAttempt": block.get("latestAttempt", {}).get("checkedAt"), "message": "保留既有来源校验记录；未重试、未改变身份、未探测其他路径。"}, ensure_ascii=False))
            return 2
    http = PublicHttp(args.transport)
    return {"probe": run_probe, "collect": run_collect, "adapt-json": run_adapt, "adapt-html": run_adapt, "inspect-html": run_inspect_html}[args.mode](http, args)


if __name__ == "__main__":
    raise SystemExit(main())
