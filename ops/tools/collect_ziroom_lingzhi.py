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
import uuid
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
SAFE_RESPONSE_HEADERS = frozenset({
    "content-type", "server", "date", "retry-after", "location",
    "x-request-id", "eo-log-uuid", "x-cdn-request-id", "x-correlation-id",
})
SENSITIVE_DIAGNOSTIC_TEXT = re.compile(
    r"cookie|authorization|password|secret|token|session|bearer|credential|api[-_]?key|"
    r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b1[3-9][0-9]{9}\b", re.I
)
HTTP_DATE_PATTERN = re.compile(
    r"(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} "
    r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) "
    r"[0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT"
)
CURRENT_VERIFICATION_PROMPT = re.compile(
    r"请(?:您|先)?(?:完成|进行|通过)(?:以下|下列)?(?:人机|安全|访问)验证|"
    r"(?:完成|通过)验证后(?:再|方可)?(?:继续|访问)|"
    r"请验证(?:您|你)(?:是人类|不是机器人)|"
    r"verify\s+(?:that\s+)?you\s+are\s+(?:a\s+)?human|"
    r"checking\s+your\s+browser", re.I
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


def safe_response_headers(headers):
    """Retain a small diagnostic allowlist; never persist credentials or query values.

    EO-LOG-UUID and other request IDs are correlation identifiers, not rule IDs.
    Location retains only a fixed public-path allowlist, never arbitrary path data.
    """
    saved = {}
    for name, raw in (headers or {}).items():
        name = str(name).lower().strip()
        if name not in SAFE_RESPONSE_HEADERS:
            continue
        value = str(raw).strip()
        if not value or len(value) > 2048 or re.search(r"[\x00-\x1f\x7f]", value):
            continue
        if name == "location":
            try:
                path = urllib.parse.unquote(urllib.parse.urlsplit(value).path or "/")
            except ValueError:
                continue
            if path not in {"/", "/map", "/login", "/signin"}:
                continue
            saved[name] = path
        elif name == "content-type":
            # Parameters may contain arbitrary values; the MIME type is sufficient.
            mime = value.split(";", 1)[0].strip().lower()
            if re.fullmatch(r"[a-z0-9!#$&^_.+-]{1,64}/[a-z0-9!#$&^_.+-]{1,64}", mime):
                saved[name] = mime
        elif name == "date":
            if HTTP_DATE_PATTERN.fullmatch(value):
                saved[name] = value
        elif name == "retry-after":
            if re.fullmatch(r"[0-9]{1,10}", value) or HTTP_DATE_PATTERN.fullmatch(value):
                saved[name] = value
        elif name == "server":
            if re.fullmatch(r"[A-Za-z][A-Za-z0-9._/-]{0,63}", value) and not SENSITIVE_DIAGNOSTIC_TEXT.search(value):
                saved[name] = value
        elif re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", value) and not SENSITIVE_DIAGNOSTIC_TEXT.search(value):
            # Exclude JWT-shaped strings even in a mislabeled tracking header.
            if not re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", value):
                saved[name] = value
    return saved


def safe_response_title(title):
    title = re.sub(r"\s+", " ", title or "").strip()
    if (SENSITIVE_DIAGNOSTIC_TEXT.search(title) or "://" in title
            or re.search(r"[A-Za-z0-9_+/-]{32,}", title)):
        return None
    return title[:180] or None


def inspect_response(status, body, url, headers):
    """Classify observed access evidence, without asserting the site's root cause.

    A keyword in a library, footer or JSON field is only a review signal. It
    still stops collection; absence of a barrier never verifies inventory scope.
    """
    text = body.decode("utf-8", errors="replace")
    markers = [marker for marker in CHALLENGE_MARKERS if marker.lower() in text.lower()]
    safe_headers = safe_response_headers(headers)
    mime = safe_headers.get("content-type", "")
    json_like = "json" in mime or text.lstrip().startswith(("{", "["))
    html_like = not json_like and bool(re.search(r"<(?:!doctype|html|head|body|title|form|script|a|input)(?:\s|>)", text, re.I))
    title, visible, listing_links, has_script, login_indicators = None, "", set(), False, False
    if html_like:
        selector = Selector(text)
        raw_title = selector.css("title::text").get() or ""
        title = safe_response_title(raw_title)
        visible = " ".join(selector.xpath(
            "//text()[not(ancestor::script) and not(ancestor::style) "
            "and not(ancestor::noscript) and not(ancestor::template)]"
        ).getall())
        has_script = bool(selector.css("script").get())
        for href in selector.css("a::attr(href)").getall():
            try:
                parsed = urllib.parse.urlsplit(urllib.parse.urljoin(url, href))
                if parsed.hostname in ALLOWED_HOSTS and re.fullmatch(r"/x/[0-9]+\.html", parsed.path):
                    listing_links.add(parsed.path)
            except ValueError:
                continue
        login_indicators = bool(selector.css('input[type="password"]').get()) or bool(re.search(
            r"(?:登录|登陆|sign\s*in|log\s*in)", raw_title, re.I
        ))
        if not login_indicators:
            login_indicators = any(re.search(r"(?:^|/)(?:login|signin)(?:/|$|\?)", action, re.I)
                                   for action in selector.css("form::attr(action)").getall())
    elif not json_like:
        visible = text
    explicit_verification = bool(CURRENT_VERIFICATION_PROMPT.search(visible))
    marker_pair = "EO_Bot_Ssid" in markers and "__tst_status" in markers
    result = {
        "httpStatus": status, "bodyBytes": len(body), "sha256": hashlib.sha256(body).hexdigest(),
        "title": title, "challengeMarkers": markers, "safeResponseHeaders": safe_headers,
        "signals": {
            "bodyFormat": "json" if json_like else "html" if html_like else "text",
            "listingDetailLinkCount": len(listing_links), "hasScript": has_script,
            "pairedChallengeMarkers": marker_pair,
            "explicitVerificationPrompt": explicit_verification,
            "loginPageIndicators": login_indicators,
        },
    }

    def classified(reason, diagnostic, confidence, basis, message):
        result.update(classification=reason or "no_access_block_observed", diagnosticReason=diagnostic,
                      confidence=confidence, classificationBasis=basis)
        if status in (401, 403, 429):
            result["legacyReason"] = "access_restricted"
        return result, reason, message

    # HTTP evidence takes precedence over keywords; it does not identify a bot rule.
    status_outcomes = {
        401: ("auth_required", "http_401", "来源要求身份认证，已停止；当前证据不判断具体认证原因。"),
        403: ("access_denied", "http_403", "来源拒绝本次访问，已停止；不能据此断言封禁 IP 或机器人规则。"),
        429: ("rate_limited", "http_429", "来源返回频率限制，已停止且未自动重试。"),
    }
    if status in status_outcomes:
        reason, diagnostic, message = status_outcomes[status]
        return classified(reason, diagnostic, "high", [diagnostic], message)
    if 300 <= status < 400:
        return classified("redirect_requires_review", "http_redirect", "high", ["http_3xx", "redirect_not_followed"],
                          "来源要求跳转，需核对目标与访问范围；未自动跟随。")
    if status != 200:
        return classified("http_error", "unexpected_http_status", "high", ["http_status_not_200"],
                          "来源没有返回有效的 HTTP 200 列表内容，已停止。")
    if not body:
        return classified("empty_response", "empty_body", "high", ["body_length_zero"],
                          "来源返回空内容，不能认定为房源数量为零。")
    if not listing_links and explicit_verification:
        return classified("challenge_page", "explicit_current_verification", "high",
                          ["current_verification_prompt_in_visible_text", "no_listing_detail_links"],
                          "响应包含当前访问验证提示，已停止；未执行验证脚本。")
    if html_like and len(body) <= 16 * 1024 and has_script and marker_pair and not listing_links:
        return classified("challenge_page", "small_script_challenge_response", "high",
                          ["small_html_response", "script_present", "paired_challenge_markers", "no_listing_detail_links"],
                          "小型 HTML 脚本响应包含成对校验标记且未见房源链接，按访问校验页停止；具体触发规则未确定。")
    if login_indicators and not listing_links:
        return classified("login_required", "login_page_structure", "high",
                          ["login_title_password_field_or_form", "no_listing_detail_links"],
                          "响应呈现登录页，已停止；普通登录验证码不等同于反机器人校验。")
    if not listing_links and re.fullmatch(r"\s*(?:access denied|forbidden|拒绝访问|禁止访问)\s*", visible, re.I):
        return classified("access_denied", "explicit_access_denial_text", "medium", ["access_denial_notice"],
                          "响应显示拒绝访问，已停止；具体原因未确定。")
    if markers or explicit_verification:
        return classified("challenge_signals_require_review", "ambiguous_challenge_signals", "low",
                          ["marker_or_prompt_present", "insufficient_page_context_for_confirmed_challenge"],
                          "发现可能来自脚本、登录组件或数据字段的校验信号，尚不能确认校验页；继续保持停止，等待证据复核。")
    return classified(None, "no_access_block_observed", "low", ["no_recognized_access_barrier"], None)


class OfflineParserContext:
    """A parser-only context: never instantiate transport or import Fetcher."""
    @property
    def engine(self):
        return {
            "name": "Scrapling", "version": importlib.metadata.version("scrapling"),
            "transport": "offline", "parser": "Scrapling Selector",
            "fetcherAvailable": None, "fetcherChecked": False, "networkEnabled": False,
            "browserUsed": False, "impersonationEnabled": False, "stealthHeadersEnabled": False,
        }


def base_status(http):
    return {
        "schemaVersion": 1, "runId": uuid.uuid4().hex, "engine": http.engine,
        "scope": {"city": "北京", "cityCode": "110000", "filter": "灵之智能"},
        "startedAt": now(), "finishedAt": None, "status": "blocked",
        "filterVerified": False, "paginationVerified": False, "paginationComplete": False,
        "filterEvidence": None, "paginationEvidence": None, "coverage": {},
        "repeatedPageCount": 0, "duplicatePageCount": 0,
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
    if current or status.get("isFullInventory") is True:
        merged = merge_cumulative(previous, current)
        dataset = {
            "schemaVersion": 1, "properties": merged,
            "source": {
                "observedAt": status["finishedAt"], "filterVerified": status["filterVerified"],
                "isFullInventory": bool(status["isFullInventory"] and len(merged) == len(current)),
                "latestRunIsFullInventory": status["isFullInventory"],
                "latestRunId": status.get("runId"),
                "latestRunFinishedAt": status["finishedAt"],
                "paginationComplete": status.get("paginationComplete") is True,
                "coverageEvidence": status.get("coverage", {}),
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
    if require_pagination:
        if p.get("mode") == "next_link" and (e.get("format") != "html" or not p.get("nextCss")):
            issues.append("HTML next-link pagination requires a verified nextCss")
        elif p.get("mode") == "query" and not p.get("pageParam"):
            issues.append("query pagination requires a verified pageParam")
        elif p.get("mode") not in ("next_link", "query"):
            issues.append("pagination mode is unsupported")
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
    status["evidence"] = evidence
    status["pages"].append({"attempt": status["requestsAttempted"], "url": url, "fetchedAt": now(), **evidence})
    return body, reason, message


def run_probe(http, args):
    status = base_status(http)
    # This command intentionally admits only the exact user-provided map URL.
    stage = "configuration"
    try:
        if args.url != DEFAULT_URL:
            raise ValueError("Probe only supports the exact user-provided map URL.")
        stage = "http_transport"
        status["requestsAttempted"] += 1
        response = http.get(args.url)
        stage = "response_inspection"
        _, reason, message = record_page(status, args.url, response)
        status.update(reason=reason or "filter_unverified", message=message or "HTTP响应已取得，但灵之筛选与分页未验证，不提取或发布默认地图房源。")
    except Exception as exc:
        if stage == "configuration":
            reason, message = "configuration_error", "探测配置不符合已确认的 URL 范围，未发送网络请求。"
        elif stage == "response_inspection":
            reason, message = "response_parse_error", "HTTP 响应已返回，但本地响应解析失败；已停止且未重试。"
        elif isinstance(exc, ValueError) and str(exc) == "Response exceeds the 8 MiB public-listing limit.":
            reason, message = "response_too_large", "响应正文超过本地 8 MiB 限制，已停止；这不代表网站拒绝访问。"
        elif isinstance(exc, (urllib.error.URLError, TimeoutError, ConnectionError, OSError)):
            reason, message = "http_transport_error", "普通 HTTP 传输未完成，已停止且未重试；不能据此判断网站访问规则。"
        else:
            reason, message = "probe_error", "本地探测出现未归类错误，已停止且未重试。"
        status.update(reason=reason, message=message, errorType=type(exc).__name__, errorStage=stage)
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
    status["filterEvidence"] = config["filter"]["evidence"]
    status["paginationEvidence"] = config["pagination"]["evidence"]
    records, seen_urls, seen_page_ids = {}, set(), set()
    pagination = config["pagination"]
    url = status["sourceUrl"]
    coverage = dict(config.get("coverage", {}))
    expected_total = coverage.get("expectedTotal")
    if not isinstance(expected_total, int) or isinstance(expected_total, bool) or expected_total < 0:
        expected_total = None
    coverage["expectedTotal"] = expected_total
    status["coverage"] = coverage
    status["citywideVerified"] = coverage.get("citywideVerified") is True and bool(coverage.get("citywideEvidence")) and coverage.get("viewportLimited") is False
    end_verified = False
    for index in range(min(int(pagination.get("maxPages", 500)), 1000)):
        try:
            url = verified_page_url(url, config)
            if url in seen_urls:
                status.update(reason="pagination_repeats_url", message="分页指向已处理地址，保留部分结果。", repeatedPageCount=1)
                break
            seen_urls.add(url)
            if index:
                time.sleep(max(2.0, min(float(config.get("delaySeconds", 2)), 30)))
            status["requestsAttempted"] += 1
            body, reason, message = record_page(status, url, http.get(url))
            if reason:
                status.update(reason=reason, message=message)
                break
            page_records, rejected = parse_records(body, config, url, observed_at=now())
            page_keys = [record_key(p) for p in page_records]
            status["pages"][-1].update(records=len(page_records), rejectedRecords=rejected, recordKeys=page_keys)
            if rejected:
                records.update({record_key(p): p for p in page_records})
                status["pagesFetched"] += bool(page_records)
                status.update(reason="invalid_record", message="已保留本页可用记录；存在缺少必要字段的记录，停止并保持部分采集状态。", rejectedRecords=rejected)
                break
            # A later pagination/total metadata error must not discard valid rows.
            records.update({record_key(p): p for p in page_records})
            is_json = config["extraction"]["format"] == "json"
            document = json.loads(body) if is_json else Selector(body.decode("utf-8", errors="replace"))
            terminal, next_url = False, None
            if pagination["mode"] == "next_link":
                next_href = document.css(pagination["nextCss"]).get()
                terminal = not bool(next_href)
                next_url = urllib.parse.urljoin(url, next_href) if next_href else None
            elif pagination["mode"] == "query":
                if is_json and pagination.get("hasMorePath"):
                    has_more = value_at(document, pagination["hasMorePath"])
                    if not isinstance(has_more, bool):
                        raise ValueError("Verified hasMorePath must return a JSON boolean.")
                    terminal = not has_more
                elif not is_json and pagination.get("endCss"):
                    terminal = bool(document.css(pagination["endCss"]).get())
                parts = urllib.parse.urlsplit(url)
                params = dict(urllib.parse.parse_qsl(parts.query))
                params[pagination["pageParam"]] = str(int(pagination.get("startPage", 1)) + index + 1)
                next_url = urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(params), ""))
            observed_total = None
            if is_json and coverage.get("totalPath"):
                observed_total = value_at(document, coverage["totalPath"])
            elif not is_json and coverage.get("totalCss"):
                observed_total = document.css(coverage["totalCss"]).get()
            if coverage.get("totalPath") or coverage.get("totalCss"):
                parsed_total = number(str(observed_total).replace(",", "")) if observed_total is not None and not isinstance(observed_total, bool) else None
                if not isinstance(parsed_total, int) or parsed_total < 0:
                    records.update({record_key(p): p for p in page_records})
                    status.update(reason="source_total_invalid", message="来源总量字段不是精确非负整数，保留已取得记录。")
                    break
                status["pages"][-1]["observedTotal"] = parsed_total
                if expected_total is None:
                    expected_total = parsed_total
                    coverage["expectedTotal"] = parsed_total
                elif expected_total != parsed_total:
                    records.update({record_key(p): p for p in page_records})
                    status.update(reason="source_total_changed", message="分页期间来源总量与本轮基准不一致，需重新核对完整性。")
                    break
            if not page_records:
                empty_marker = (is_json and bool(pagination.get("hasMorePath")) and terminal) or (
                    not is_json and bool(pagination.get("emptyCss")) and bool(document.css(pagination["emptyCss"]).get()) and terminal
                )
                if empty_marker:
                    status["pagesFetched"] += 1
                    end_verified = True
                else:
                    status.update(reason="empty_page_requires_review", message="当前页未提取到记录且缺少已核验的空结果标记，不能认定为末页或零库存。")
                break
            status["pagesFetched"] += 1
            signature = tuple(sorted(record_key(p) for p in page_records))
            if page_records and signature in seen_page_ids:
                status.update(reason="pagination_repeats_content", message="分页返回重复内容，已停止，不能认定已经翻页。", duplicatePageCount=1)
                break
            seen_page_ids.add(signature)
            records.update({record_key(p): p for p in page_records})
            if expected_total is not None and len(records) > expected_total:
                status.update(reason="source_total_exceeded", message="去重房源数超过本轮来源总量，保留记录并要求核对筛选及来源变动。")
                break
            if terminal:
                end_verified = True
                break
            url = next_url
        except Exception as exc:
            status.update(reason="collection_error", message="采集出现异常，已停止并保留已取得记录。", errorType=type(exc).__name__)
            break
    else:
        status.update(reason="page_limit_reached", message="已到达配置页数上限，尚未证明全量。")
    status["unknownIdentityCount"] = sum(real_listing_id(record) is None for record in records.values())
    status["paginationComplete"] = end_verified
    exact_match = expected_total is not None and len(records) == expected_total
    status["isFullInventory"] = bool(end_verified and exact_match and coverage.get("totalEvidence") and not status["unknownIdentityCount"] and status["citywideVerified"])
    if end_verified:
        if expected_total is None or not coverage.get("totalEvidence"):
            status.update(reason="end_without_exact_total", message="已到达已核验的分页末尾，缺少来源精确总量证据，保留部分采集状态。")
        elif not exact_match:
            status.update(reason="source_total_mismatch", message="已到分页末尾，但去重房源数与来源总量不一致，保留部分采集状态。")
        elif status["unknownIdentityCount"]:
            status.update(reason="identity_incomplete", message="记录数量达到来源总数，但部分房源身份未核验，仍为部分采集。")
        elif not status["citywideVerified"]:
            status.update(reason="scope_incomplete", message="记录数达到当前查询总数，但尚未证明覆盖北京全城而非地图视窗或区域子集。")
        else:
            status.update(reason="verified_pagination_and_total", message="已核验全北京筛选、全部分页及房源身份，去重记录数与来源精确总量一致。")
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
    http = PublicHttp(args.transport) if args.mode in ("probe", "collect") else OfflineParserContext()
    return {"probe": run_probe, "collect": run_collect, "adapt-json": run_adapt, "adapt-html": run_adapt, "inspect-html": run_inspect_html}[args.mode](http, args)


if __name__ == "__main__":
    raise SystemExit(main())
