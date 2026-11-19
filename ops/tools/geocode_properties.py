#!/usr/bin/env python3
"""One-time, cached OSM lookup for the existing ten Lingzhi listing samples.

This is an offline data-preparation tool, not a public geocoding/search service.
Read https://operations.osmfoundation.org/policies/nominatim/ before fetching.
Only the fixed sample communities or their already-known subway stations may be
queried. Single process/thread, >=1.2 seconds between requests, no retries,
no autocomplete, reverse grid, POI enumeration, credentials, or Ziroom requests.
All candidate selection is recorded explicitly in reviewed-matches.json.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

OPS = Path(__file__).resolve().parents[1]
SOURCE = OPS / "assets" / "properties.json"
CACHE = OPS / "tools" / "geography-cache"
OUTPUT = OPS / "assets" / "property-geography.json"
ENDPOINT = "https://nominatim.openstreetmap.org/search"
POLICY = "https://operations.osmfoundation.org/policies/nominatim/"
UA = "LingzhiOpsDemoGeography/1.0 (+https://zlink.help)"
MAX_NETWORK_REQUESTS = 20
MIN_INTERVAL_SECONDS = 1.2


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load(path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def samples():
    rows = load(SOURCE)["properties"]
    if len(rows) > 10:
        raise ValueError("This one-time lookup is restricted to the existing ten samples.")
    return rows


def query_for(prop, kind):
    name = prop["name"] if kind == "community" else prop["station"]
    return f"{name}, {prop['district']}区, 北京市, 中国"


def query_url(query, endpoint):
    return endpoint + "?" + urllib.parse.urlencode({
        "q": query, "format": "jsonv2", "limit": 3, "countrycodes": "cn",
        "addressdetails": 1, "namedetails": 1, "accept-language": "zh-CN,en",
    })


def cache_path(query, endpoint):
    key = hashlib.sha256(query_url(query, endpoint).encode()).hexdigest()[:24]
    return CACHE / (key + ".json")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch(query, kind, endpoint):
    path = cache_path(query, endpoint)
    if path.exists():
        return load(path)
    CACHE.mkdir(parents=True, exist_ok=True)
    with (CACHE / "request.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if path.exists():
            return load(path)
        state = load(CACHE / "request-state.json", {"networkRequests": 0, "lastRequestAt": 0, "stopped": False})
        if state["stopped"]:
            raise RuntimeError("A prior request stopped this run; no retry or alternate endpoint is attempted.")
        if state["networkRequests"] >= MAX_NETWORK_REQUESTS:
            raise RuntimeError("The one-time, ten-property request budget has been reached.")
        delay = MIN_INTERVAL_SECONDS - (time.time() - state["lastRequestAt"])
        if delay > 0:
            time.sleep(delay)
        url = query_url(query, endpoint)
        result = {"query": query, "kind": kind, "queryUrl": url, "requestedAt": now(),
                  "provider": "OSM Nominatim", "httpStatus": None, "status": "error", "results": []}
        state["lastRequestAt"] = time.time()
        state["networkRequests"] += 1
        save(CACHE / "request-state.json", state)
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json",
                                                  "Accept-Language": "zh-CN,en", "Referer": "https://zlink.help/"})
        try:
            with urllib.request.build_opener(NoRedirect()).open(req, timeout=20) as response:
                result["httpStatus"] = response.status
                raw = response.read(2 * 1024 * 1024 + 1)
                if len(raw) > 2 * 1024 * 1024:
                    raise ValueError("Unexpectedly large geocoding response.")
                rows = json.loads(raw)
                if not isinstance(rows, list):
                    raise ValueError("Expected a Nominatim result list.")
                result.update(status="ok", results=rows, sha256=hashlib.sha256(raw).hexdigest(), bodyBytes=len(raw))
        except urllib.error.HTTPError as exc:
            result.update(httpStatus=exc.code, errorType="HTTPError", status="blocked" if exc.code in (401, 403, 429) else "error")
            state["stopped"] = True
        except Exception as exc:
            result.update(errorType=type(exc).__name__)
            state["stopped"] = True
        result["retrievedAt"] = now()
        save(path, result)
        save(CACHE / "request-state.json", state)
        return result


def district_info(prop):
    if prop["id"] == "810151211":
        return {"name": "太阳宫", "status": "confirmed_existing_detail_read", "sourceType": "ziroom_detail",
                "sourceUrl": prop["sourceUrl"], "basis": "本会话此前实读该房源自如详情的商圈标签；本次未重新请求自如。",
                "candidate": None, "observedAt": "2026-11-19"}
    return {"name": None, "status": "inferred_pending_verification", "sourceType": "station_inference",
            "sourceUrl": prop["sourceUrl"], "basis": "仅依据原列表最近地铁站构造区域候选，尚未核验自如商圈分类或边界。",
            "candidate": prop["station"] + "站周边", "observedAt": "2026-11-19"}


def build(endpoint):
    reviewed = load(CACHE / "reviewed-matches.json", {})
    rows = []
    state = load(CACHE / "request-state.json", {})
    for prop in samples():
        record = {"id": prop["id"], "name": prop["name"], "district": prop["district"],
                  "coordinate": None, "coordinateSystem": "WGS84", "matchType": "unmatched", "precision": None,
                  "confidence": "unverified", "isExactPropertyLocation": False, "accuracyMeters": None,
                  "label": "尚未定位", "osm": None, "evidence": [], "businessDistrict": district_info(prop),
                  "station": {"name": prop["station"], "distanceMeters": prop["distance"],
                              "distanceBasis": "原自如列表距离；未由OSM重新计算"}}
        for kind in ("community", "station"):
            q = query_for(prop, kind)
            path = cache_path(q, endpoint)
            cached = load(path)
            if cached:
                record["evidence"].append({"kind": kind, "query": q, "queryUrl": cached["queryUrl"],
                                           "retrievedAt": cached["retrievedAt"], "status": cached["status"],
                                           "candidateCount": len(cached["results"]),
                                           "cacheFile": str(path.relative_to(OPS))})
        choice = reviewed.get(prop["id"])
        if choice:
            kind = choice["kind"]
            cached = load(cache_path(query_for(prop, kind), endpoint))
            candidates = [x for x in cached["results"] if x.get("osm_type") == choice["osmType"] and str(x.get("osm_id")) == str(choice["osmId"])]
            if len(candidates) != 1:
                raise ValueError("Reviewed OSM object must identify exactly one cached result.")
            obj = candidates[0]
            lon, lat = float(obj["lon"]), float(obj["lat"])
            if not (115 <= lon <= 118 and 39 <= lat <= 42):
                raise ValueError("Reviewed coordinate is outside the Beijing sample region.")
            station = kind == "station"
            precision = "station_proxy" if station else "named_place_point" if obj["osm_type"] == "node" else "community_centroid"
            record.update(coordinate=[lon, lat], matchType="station_proxy" if station else "community",
                          precision=precision, confidence=choice["confidence"],
                          label=(prop["station"] + "站参考位置（非房屋）") if station else (prop["name"] + "小区参考位置（非房间）"),
                          matchBasis=choice["basis"], reviewedAt=choice["reviewedAt"],
                          osm={"type": obj["osm_type"], "id": str(obj["osm_id"]), "name": obj.get("name"),
                               "displayName": obj.get("display_name"), "address": obj.get("address", {}),
                               "longitudeRaw": obj["lon"], "latitudeRaw": obj["lat"],
                               "boundingBox": obj.get("boundingbox"), "boundingBoxOrder": ["south", "north", "west", "east"],
                               "category": obj.get("category"), "featureType": obj.get("type"),
                               "placeRank": obj.get("place_rank"), "namedetails": obj.get("namedetails", {}),
                               "objectUrl": f"https://www.openstreetmap.org/{obj['osm_type']}/{obj['osm_id']}"})
            if station:
                record["geocodingNote"] = choice.get("communityResultNote", "小区检索未取得可采用的住宅对象；仅以原列表最近地铁站作地图参考，不推算房屋位置。")
        elif state.get("stopped") and not record["evidence"]:
            record["confidence"] = "not_queried_after_service_stop"
        rows.append(record)
    summary = {"sampleCount": len(rows), "communityMatches": sum(r["matchType"] == "community" for r in rows),
               "stationProxies": sum(r["matchType"] == "station_proxy" for r in rows),
               "unmatched": sum(r["matchType"] == "unmatched" for r in rows),
               "exactPropertyLocations": 0, "networkRequests": state.get("networkRequests", 0),
               "serviceStopped": state.get("stopped", False),
               "confirmedBusinessDistricts": 1, "businessDistrictCandidates": 9}
    document = {"schemaVersion": 1, "generatedAt": now(), "provider": "OpenStreetMap / Nominatim",
                "coordinateSystem": "WGS84", "coordinateOrder": ["longitude", "latitude"],
                "scope": "现有10条列表样本的一次性地理补全；不是北京全量房源，也不是房间或设备精确坐标。",
                "sourcePropertiesFile": "assets/properties.json", "sourcePropertiesSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                "attribution": {"text": "© OpenStreetMap contributors", "url": "https://www.openstreetmap.org/copyright", "license": "ODbL 1.0"},
                "documentation": {"searchApi": "https://nominatim.org/release-docs/latest/api/Search/",
                                  "outputCentroid": "https://nominatim.org/release-docs/latest/api/Output/",
                                  "coordinateSystem": "https://wiki.openstreetmap.org/wiki/FAQ#What_geographic_datums_are_used_in_OpenStreetMap?"},
                "confidenceMeaning": {"high": "小区同名住宅对象与行政区一致；只确认社区级参考位置。",
                                      "medium": "地铁站对象已匹配，但房屋或小区未定位；站点仅用于区域参考。",
                                      "unverified": "没有采用可核验的定位结果。"},
                "policy": {"url": POLICY, "endpoint": endpoint, "userAgent": UA, "singleThread": True,
                           "minimumIntervalSeconds": MIN_INTERVAL_SECONDS, "cacheEnabled": True,
                           "maxProperties": 10, "maxNetworkRequests": MAX_NETWORK_REQUESTS,
                           "mode": "one_time_offline_enrichment", "clientSideApiCalls": False,
                           "prohibitedUses": ["autocomplete", "reverse_geocoding_grid", "area_poi_enumeration"]},
                "businessDistrictPolicy": "自如商圈、OSM地址层级和地铁站周边候选分开记录；不将OSM suburb自动认定为自如商圈。",
                "querySummary": summary, "properties": rows}
    save(OUTPUT, document)
    print(json.dumps(summary, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", default=ENDPOINT, help="Provider can be changed deliberately; cached blocked runs are not retried automatically.")
    sub = parser.add_subparsers(dest="mode", required=True)
    query = sub.add_parser("fetch", help="One-time lookup of fixed sample names, never a general search service.")
    query.add_argument("--kind", choices=("community", "station"), required=True)
    query.add_argument("--ids", nargs="+", required=True)
    sub.add_parser("build", help="Build reviewed geometry using local cache only; no network requests.")
    args = parser.parse_args()
    parts = urllib.parse.urlsplit(args.endpoint)
    if parts.scheme != "https" or parts.username or parts.password or parts.query or parts.fragment:
        raise ValueError("Use a deliberately configured public HTTPS search endpoint, without credentials.")
    if args.mode == "build":
        build(args.endpoint)
        return
    by_id = {p["id"]: p for p in samples()}
    for ident in args.ids:
        if ident not in by_id:
            raise ValueError("Only existing sample IDs may be queried.")
        result = fetch(query_for(by_id[ident], args.kind), args.kind, args.endpoint)
        print(json.dumps({"id": ident, "kind": args.kind, "status": result["status"], "httpStatus": result["httpStatus"],
                          "candidates": [{"osm_type": x.get("osm_type"), "osm_id": x.get("osm_id"), "name": x.get("name"),
                                          "display_name": x.get("display_name"), "lon": x.get("lon"), "lat": x.get("lat"),
                                          "category": x.get("category"), "type": x.get("type")} for x in result["results"]]}, ensure_ascii=False), flush=True)
        if result["status"] != "ok":
            break


if __name__ == "__main__":
    main()
