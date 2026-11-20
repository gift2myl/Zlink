#!/usr/bin/env python3
"""Inspect already-obtained official archives without making any network request.

This is a review adapter, not a crawler. It never replays a HAR request, executes
page JavaScript, imports credentials, edits source-access stops or claims an
inventory is complete. JSON paths describe the saved response, not an API recipe.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import ipaddress
import json
import math
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

from scrapling.parser import Selector

MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_BODY_BYTES = 8 * 1024 * 1024
MAX_DEPTH = 24
MAX_NODES = 100000
MAX_ENTRIES = 3000
MAX_RESULTS = 15000
TZ = timezone(timedelta(hours=8))
PRIVATE_KEY = re.compile(r"cookie|authorization|password|passwd|secret|token|session|credential|header|contact|phone|mobile|email|wechat|openid|userid|tenant|customer|owner|身份证|手机号|电话|邮箱|联系人|租客|业主", re.I)
EMAIL = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)
PHONE = re.compile(r"(?<!\d)(?:(?:\+?86[- ]?)?1[3-9]\d{9}|0\d{2,3}[- ]?\d{7,8}|400[- ]?\d{3}[- ]?\d{4})(?!\d)")
SECRET_TEXT = re.compile(r"(?:bearer\s+\S+|(?:password|passwd|authorization|cookie|token|secret)\s*[:=]\s*\S+)", re.I)
AUTH_PATH = re.compile(r"(?:^|/)(?:login|logout|oauth|authorize|authorization|passport|captcha|token|sso|cas)(?:/|$)", re.I)
SAFE_QUERY = {"city_code", "cityCode", "page_source", "page", "p", "id", "room_id", "roomId", "house_id", "houseId", "scene_id", "sceneId", "model_id", "modelId", "lang", "isOpen"}
FIELD_ALIASES = {
    "name": ("communityName", "community_name", "resblockName", "xiaoquName", "buildingName", "name", "小区名称", "小区", "楼盘名称"),
    "listingLabel": ("listingName", "houseName", "roomName", "title", "房源名称"),
    "claimedId": ("realListingId", "house_id", "houseId", "room_id", "roomId", "listing_id", "listingId", "房源ID", "房间编号"),
    "sourceUrl": ("detailUrl", "detail_url", "houseUrl", "listingUrl", "web_url", "sourceUrl", "url", "link", "房源链接"),
    "district": ("district", "districtName", "district_name", "行政区", "区县"),
    "businessArea": ("businessArea", "businessName", "bizcircleName", "circleName", "shangquanName", "商圈"),
    "area": ("area", "areaSize", "house_area", "面积"),
    "bedrooms": ("bedrooms", "bedroomCount", "bedroom_count", "居室数"),
    "layout": ("layout", "houseLayout", "layoutName", "户型"),
    "floor": ("floor", "floorNo", "楼层"),
    "totalFloors": ("totalFloors", "total_floors", "总楼层"),
    "orientation": ("orientation", "朝向"),
    "station": ("station", "stationName", "地铁站"),
    "distance": ("distance", "subwayDistance", "地铁距离"),
    "product": ("product", "productName", "styleName", "产品标签", "产品名称"),
    "tags": ("tags", "features", "labels", "特色标签"),
    "roomLabel": ("roomLabel", "room_label", "卧室编号"),
    "areaScope": ("areaScope", "area_scope"),
    "bedroomsScope": ("bedroomsScope", "bedrooms_scope"),
    "city": ("city", "cityName", "城市"),
    "cityCode": ("cityCode", "city_code", "城市编码"),
}
NUMBER_FIELDS = {"area", "bedrooms", "floor", "totalFloors", "distance"}
FLOORPLAN_KEYS = {"floorplan", "floorplanurl", "floorplanimage", "floorplanpic", "layoutpic", "layoutimage", "houselayouturl", "户型图", "户型图链接", "平面图"}
VR_KEYS = {"vr", "vrurl", "vrlink", "panorama", "panoramaurl", "toururl", "3dtour", "全景", "全景链接", "vr看房"}
URL_KEYS = {"url", "src", "href", "link", "image", "img", "imageurl", "picurl"}


def keynorm(value):
    return re.sub(r"[_\-\s]", "", str(value)).lower()


ALIASES = {keynorm(alias): field for field, aliases in FIELD_ALIASES.items() for alias in aliases}


def safe_text(value, limit=180):
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    text = re.sub(r"<[^>]*>", "", text)
    text = SECRET_TEXT.sub("[已移除敏感值]", text)
    text = EMAIL.sub("[已移除联系方式]", text)
    text = PHONE.sub("[已移除联系方式]", text)
    return text[:limit] or None


def observed_time(value):
    if not isinstance(value, str) or len(value) > 50:
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return moment.isoformat()
    except ValueError:
        return None


def official_host(host):
    return host == "ziroom.com" or host.endswith(".ziroom.com")


def safe_url(value, base=None, official_only=False):
    """Keep public identifiers only; never keep arbitrary URL query values."""
    if not isinstance(value, str) or len(value) > 4096:
        return None
    try:
        parts = urlsplit(urljoin(base or "", value.strip()))
        host = (parts.hostname or "").lower()
        if parts.scheme not in {"https", "http"} or not host or parts.username or parts.password:
            return None
        if parts.port not in {None, 80, 443} or host == "localhost" or host.endswith((".local", ".internal")):
            return None
        try:
            if not ipaddress.ip_address(host).is_global:
                return None
        except ValueError:
            pass
        if official_only and not official_host(host):
            return None
        if AUTH_PATH.search(parts.path) or EMAIL.search(parts.path) or any(len(p) > 128 for p in parts.path.split("/")):
            return None
        kept = []
        for key, val in parse_qsl(parts.query, keep_blank_values=False):
            if key in SAFE_QUERY and not PRIVATE_KEY.search(key) and re.fullmatch(r"[A-Za-z0-9_|.,-]{1,80}", val):
                kept.append((key, val))
        netloc = host + (":" + str(parts.port) if parts.port else "")
        return urlunsplit((parts.scheme, netloc, parts.path, urlencode(kept), ""))
    except (ValueError, TypeError):
        return None


def listing_id(url):
    if not url:
        return None
    parts = urlsplit(url)
    if not official_host(parts.hostname or ""):
        return None
    found = re.fullmatch(r"/x/([0-9]{1,24})\.html", parts.path)
    return found.group(1) if found else None


def path_key(path, key):
    # A dynamic key could itself contain personal data. Do not echo such keys.
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]{0,63}", key) or keynorm(key) in ALIASES or keynorm(key) in FLOORPLAN_KEYS | VR_KEYS:
        return path + "[" + json.dumps(key, ensure_ascii=False) + "]"
    return path + "[*]"


def json_value(field, value, source):
    if field in NUMBER_FIELDS:
        if isinstance(value, bool):
            return None
        try:
            number = float(value)
            if not math.isfinite(number) or number < 0:
                return None
            return int(number) if number.is_integer() else number
        except (ValueError, TypeError, OverflowError):
            return None
    if field == "sourceUrl":
        candidate = safe_url(value, source, official_only=True)
        return candidate if listing_id(candidate) else None
    if field == "claimedId":
        value = str(value) if isinstance(value, (str, int)) and not isinstance(value, bool) else ""
        return value if re.fullmatch(r"[0-9]{1,24}", value) and not PHONE.fullmatch(value) else None
    if field == "tags":
        values = value if isinstance(value, list) else [value]
        clean = []
        for item in values[:50]:
            if isinstance(item, dict):
                item = next((item[k] for k in ("name", "label", "text", "tagName") if isinstance(item.get(k), str)), None)
            text = safe_text(item, 80)
            if text and text not in clean:
                clean.append(text)
        return clean or None
    return safe_text(value)


class Inspector:
    def __init__(self):
        self.documents = []
        self.records = []
        self.links = {}
        self.references = {}
        self.issues = []
        self.nodes = 0
        self.truncated = False

    def issue(self, code, document_index=None, location=None):
        item = {"code": code}
        if document_index is not None:
            item["documentIndex"] = document_index
        if location:
            item["location"] = location
        if len(self.issues) < 1000:
            self.issues.append(item)

    def provenance(self, doc, location):
        return {"documentIndex": doc["index"], "sourceUrl": doc["sourceUrl"], "observedAt": doc["observedAt"], "location": location}

    def add_link(self, url, doc, location, label=None):
        identity = listing_id(url)
        if not identity or len(self.links) >= MAX_RESULTS:
            return
        key = (identity, doc["index"], location)
        self.links[key] = {"realListingId": identity, "url": url, "label": safe_text(label), "evidence": self.provenance(doc, location)}

    def add_reference(self, kind, value, doc, location, record_id=None, label=None):
        url = safe_url(value, doc["sourceUrl"])
        if not url or len(self.references) >= MAX_RESULTS:
            return
        key = (kind, url, record_id, doc["index"], location)
        self.references[key] = {
            "kind": kind, "url": url, "realListingId": record_id,
            "association": "observed_with_detail_identity" if record_id else "unassigned_candidate",
            "label": safe_text(label), "evidence": self.provenance(doc, location),
            "downloaded": False, "visuallyVerified": False, "usableForReconstruction": False,
        }

    def extract_record(self, node, doc, path):
        fields, evidence = {}, {}
        for key, value in node.items():
            if not isinstance(key, str) or PRIVATE_KEY.search(key):
                continue
            field = ALIASES.get(keynorm(key))
            if not field:
                continue
            cleaned = json_value(field, value, doc["sourceUrl"])
            if cleaned is None:
                continue
            pointer = path_key(path, key)
            evidence.setdefault(field, []).append({"value": cleaned, **self.provenance(doc, pointer)})
            fields.setdefault(field, cleaned)
            if field == "sourceUrl":
                self.add_link(cleaned, doc, pointer)
        # Generic id/name are too ambiguous to be promoted on their own.
        if "claimedId" not in fields and "id" in node and ("name" in fields or "listingLabel" in fields):
            cleaned = json_value("claimedId", node["id"], doc["sourceUrl"])
            if cleaned is not None:
                fields["claimedId"] = cleaned
                evidence["claimedId"] = [{"value": cleaned, **self.provenance(doc, path + '["id"]')}]
        has_identity = "claimedId" in fields or "sourceUrl" in fields
        has_details = any(k in fields for k in ("name", "listingLabel", "layout", "bedrooms", "area"))
        if not has_identity or not has_details:
            return None
        ids = {listing_id(item["value"]) for item in evidence.get("sourceUrl", [])}
        ids.discard(None)
        true_id = next(iter(ids)) if len(ids) == 1 else None
        claimed = fields.get("claimedId")
        conflict = bool(len(ids) > 1 or true_id and claimed and true_id != claimed)
        state = "identity_conflict" if conflict else "detail_url_observed" if true_id else "claimed_id_candidate"
        if conflict:
            true_id = None
        scope = {"status": state, "realListingId": true_id, "claimedId": claimed}
        label_values = [fields.get("product"), fields.get("listingLabel"), *(fields.get("tags") or [])]
        label_present = any("灵之智能" in text for text in label_values if isinstance(text, str))
        city_present = fields.get("city") in {"北京", "北京市"} or str(fields.get("cityCode") or "") == "110000"
        record = {
            "recordKey": "archive:" + str(doc["index"]) + ":" + hashlib.sha256(path.encode()).hexdigest()[:16],
            "identity": scope, "fields": fields, "fieldEvidence": evidence,
            "conflictingFields": [k for k, observations in evidence.items() if len({json.dumps(o["value"], sort_keys=True, ensure_ascii=False) for o in observations}) > 1],
            "lingzhiLabelVisibleOnRecord": label_present,
            "beijingFieldVisibleOnRecord": city_present,
            "sourceCityCode": doc.get("sourceCityCode"),
            "filterVerified": False, "reviewStatus": "needs_review", "modelReady": False,
            "evidence": self.provenance(doc, path),
        }
        if len(self.records) < MAX_RESULTS:
            self.records.append(record)
        else:
            self.truncated = True
        return scope

    def inspect_json(self, payload, doc, root_path="$"):
        base_id = listing_id(doc["sourceUrl"])
        stack = [(payload, root_path, 0, base_id, None)]
        while stack:
            node, path, depth, context_id, ref_kind = stack.pop()
            self.nodes += 1
            if self.nodes > MAX_NODES:
                self.truncated = True
                self.issue("node_limit_reached", doc["index"])
                return
            if depth > MAX_DEPTH:
                self.truncated = True
                self.issue("depth_limit_reached", doc["index"], path)
                continue
            if isinstance(node, dict):
                own = self.extract_record(node, doc, path)
                if own:
                    # A new listing candidate without a real detail link resets
                    # ancestor identity; adjacent cards never inherit its ID.
                    context_id = own["realListingId"]
                for key, value in reversed(list(node.items())):
                    if not isinstance(key, str) or PRIVATE_KEY.search(key):
                        continue
                    norm = keynorm(key)
                    child_path = path_key(path, key)
                    kind = "floorplan" if norm in FLOORPLAN_KEYS else "vr" if norm in VR_KEYS else ref_kind if norm in URL_KEYS else None
                    if isinstance(value, str):
                        if norm in URL_KEYS or ALIASES.get(norm) == "sourceUrl":
                            url = safe_url(value, doc["sourceUrl"], official_only=True)
                            if listing_id(url):
                                self.add_link(url, doc, child_path)
                        if kind:
                            self.add_reference(kind, value, doc, child_path, context_id)
                    elif isinstance(value, (dict, list)):
                        stack.append((value, child_path, depth + 1, context_id, kind))
            elif isinstance(node, list):
                for index in range(len(node) - 1, -1, -1):
                    value = node[index]
                    child_path = path + "[" + str(index) + "]"
                    if isinstance(value, str) and ref_kind:
                        self.add_reference(ref_kind, value, doc, child_path, context_id)
                    elif isinstance(value, (dict, list)):
                        stack.append((value, child_path, depth + 1, context_id, ref_kind))

    def inspect_html(self, body, doc):
        try:
            selector = Selector(body)
        except Exception:
            self.issue("html_parse_failed", doc["index"])
            return
        page_id = listing_id(doc["sourceUrl"])
        nodes = selector.css("a[href], img[src], img[data-src], img[data-original], iframe[src]")
        for index, node in enumerate(nodes):
            if index >= MAX_RESULTS:
                self.truncated = True
                self.issue("html_reference_limit_reached", doc["index"])
                break
            attrs = node.attrib
            attr = next((key for key in ("href", "data-original", "data-src", "src") if attrs.get(key)), None)
            url = safe_url(attrs.get(attr), doc["sourceUrl"]) if attr else None
            if not url:
                continue
            label_parts = [attrs.get(key, "") for key in ("alt", "title", "aria-label")]
            if attr == "href":
                label_parts += node.xpath('.//text()[not(ancestor::script) and not(ancestor::style)]').getall()
            label = safe_text(" ".join(label_parts))
            location = "html.links[" + str(index) + "]." + attr
            self.add_link(url, doc, location, label)
            marker = (label or "") + " " + urlsplit(url).path
            kind = "floorplan" if re.search(r"户型|平面图|floor.?plan", marker, re.I) else "vr" if re.search(r"全景|vr看房|(?:^|[^a-z])vr(?:[^a-z]|$)|panorama|3dtour", marker, re.I) else None
            if kind:
                self.add_reference(kind, url, doc, location, page_id, label)
        # Only literal JSON data blocks are parsed. JavaScript is never executed.
        for index, node in enumerate(selector.css('script[type="application/json"], script[type="application/ld+json"]')):
            if index >= 100:
                self.issue("embedded_json_limit_reached", doc["index"])
                self.truncated = True
                break
            text = "".join(node.xpath('.//text()').getall())
            if len(text.encode("utf-8")) > MAX_BODY_BYTES:
                self.issue("embedded_json_too_large", doc["index"])
                continue
            try:
                self.inspect_json(json.loads(text), doc, "html.json[" + str(index) + "]")
            except (ValueError, RecursionError, MemoryError):
                self.issue("embedded_json_invalid", doc["index"])

    def document(self, body, source_url, captured_at, fmt, origin, status=None):
        index = len(self.documents)
        source = safe_url(source_url, official_only=True)
        doc = {
            "index": index, "sourceUrl": source, "observedAt": observed_time(captured_at),
            "origin": origin, "format": fmt, "bodyBytes": len(body),
            "bodySha256": hashlib.sha256(body).hexdigest(),
            "officialSourceUrl": bool(source), "sourceCityCode": None,
        }
        if status is not None:
            doc["httpStatus"] = status if type(status) is int and 100 <= status <= 599 else None
        if source:
            city = dict(parse_qsl(urlsplit(source).query)).get("city_code") or dict(parse_qsl(urlsplit(source).query)).get("cityCode")
            doc["sourceCityCode"] = city if city and re.fullmatch(r"\d{6}", city) else None
        self.documents.append(doc)
        if not source:
            self.issue("official_source_url_missing_or_unsafe", index)
            return
        if len(body) > MAX_BODY_BYTES:
            self.issue("response_body_too_large", index)
            self.truncated = True
            return
        if status is not None and (type(status) is not int or not 200 <= status <= 299):
            self.issue("non_success_response_skipped", index)
            return
        try:
            text = body.decode("utf-8-sig")
        except UnicodeDecodeError:
            self.issue("non_utf8_content_skipped", index)
            return
        if fmt == "json":
            try:
                self.inspect_json(json.loads(text), doc)
            except (ValueError, RecursionError, MemoryError):
                self.issue("response_json_invalid", index)
        elif fmt == "html":
            self.inspect_html(text, doc)

    def inspect_har(self, payload):
        entries = payload.get("log", {}).get("entries") if isinstance(payload, dict) and isinstance(payload.get("log"), dict) else None
        if not isinstance(entries, list):
            self.issue("har_entries_missing")
            return
        if len(entries) > MAX_ENTRIES:
            self.issue("har_entry_limit_reached")
            self.truncated = True
        for index, entry in enumerate(entries[:MAX_ENTRIES]):
            if not isinstance(entry, dict):
                continue
            request = entry.get("request")
            # Only request.url is accessed. Headers, cookies and request bodies
            # are never inspected, copied, replayed or serialized.
            source = request.get("url") if isinstance(request, dict) else None
            if not safe_url(source, official_only=True):
                continue
            response = entry.get("response")
            content = response.get("content") if isinstance(response, dict) else None
            if not isinstance(content, dict) or not isinstance(content.get("text"), str) or not content["text"]:
                self.issue("har_response_body_missing", location="har.entries[" + str(index) + "]")
                continue
            text = content["text"]
            if len(text) > MAX_BODY_BYTES * 2:
                self.issue("har_response_body_too_large", location="har.entries[" + str(index) + "]")
                self.truncated = True
                continue
            try:
                body = base64.b64decode(text, validate=True) if content.get("encoding") == "base64" else text.encode("utf-8")
            except (ValueError, TypeError):
                self.issue("har_base64_invalid", location="har.entries[" + str(index) + "]")
                continue
            mime = str(content.get("mimeType") or "").split(";", 1)[0].strip().lower()
            fmt = "json" if "json" in mime or body.lstrip()[:1] in {b"{", b"["} else "html" if "html" in mime or body.lstrip()[:1] == b"<" else None
            if not fmt:
                continue
            self.document(body, source, entry.get("startedDateTime"), fmt, "har.entries[" + str(index) + "]", response.get("status"))

    def result(self, archive_sha, archive_bytes, fmt):
        links = list(self.links.values())
        refs = list(self.references.values())
        ids = sorted({row["realListingId"] for row in links})
        return {
            "schemaVersion": 1, "kind": "official_archive_review", "processedAt": datetime.now(TZ).isoformat(timespec="seconds"),
            "archive": {"sha256": archive_sha, "bytes": archive_bytes, "format": fmt},
            "engine": {"htmlParser": "Scrapling Selector", "jsonParser": "Python standard library", "networkRequests": 0, "javascriptExecuted": False, "requestReplay": False},
            "knownTotal": None, "isFullInventory": False, "filterVerified": False, "currentAvailabilityVerified": False,
            "summary": {"documents": len(self.documents), "recordObservations": len(self.records), "uniqueDetailUrlIdentities": len(ids), "recordsWithOwnLingzhiLabel": sum(r["lingzhiLabelVisibleOnRecord"] for r in self.records), "floorplanReferences": sum(r["kind"] == "floorplan" for r in refs), "vrReferences": sum(r["kind"] == "vr" for r in refs), "unassignedReferences": sum(not r["realListingId"] for r in refs), "missingResponseBodies": sum(i["code"] == "har_response_body_missing" for i in self.issues), "truncated": self.truncated},
            "documents": self.documents, "records": self.records, "listingLinks": links, "references": refs, "issues": self.issues,
            "reviewRequirements": ["确认每条真实房源身份及北京、灵之智能标签。", "核对原始保存时间、筛选、分页和城市完整范围；搜索或单次页面快照不是全量证明。", "户型/VR链接须核对房源归属并检查实际素材；不自动下载或生成三维。", "只输出白名单字段；请求头、Cookie、授权信息、联系方式和原始响应不写入结果。", "结果是待审阅资料，不会直接覆盖正式台账或解除来源停止状态。"],
        }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--format", choices=("auto", "har", "json", "html"), default="auto")
    parser.add_argument("--source-url", help="Official public source URL for a standalone JSON/HTML archive.")
    parser.add_argument("--observed-at", help="Actual archive capture time, ISO 8601; omitted means unknown.")
    args = parser.parse_args(argv)
    try:
        if args.input.resolve() == args.output.resolve():
            parser.error("Input and output must be different files.")
        if args.input.stat().st_size > MAX_ARCHIVE_BYTES:
            parser.error("Archive exceeds the 64 MiB limit.")
        body = args.input.read_bytes()
        fmt = args.format
        if fmt == "auto":
            fmt = "har" if args.input.suffix.lower() == ".har" else "html" if args.input.suffix.lower() in {".html", ".htm"} else "json"
        inspector = Inspector()
        if fmt == "har":
            inspector.inspect_har(json.loads(body.decode("utf-8-sig")))
        else:
            inspector.document(body, args.source_url, args.observed_at, fmt, "standalone")
        result = inspector.result(hashlib.sha256(body).hexdigest(), len(body), fmt)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temp = args.output.with_suffix(args.output.suffix + ".tmp")
        temp.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temp.replace(args.output)
        print(json.dumps({"status": "review_required", "summary": result["summary"], "networkRequests": 0, "knownTotal": None}, ensure_ascii=False))
        return 0
    except (OSError, UnicodeError, ValueError, RecursionError, MemoryError):
        print(json.dumps({"status": "invalid_archive", "message": "无法读取或解析档案；未输出原始内容或敏感错误细节。", "networkRequests": 0}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
