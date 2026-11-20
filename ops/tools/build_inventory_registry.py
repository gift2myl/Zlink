#!/usr/bin/env python3
"""Build the cumulative Beijing/Lingzhi registry from saved evidence only.

No HTTP, browser, DNS, geocoding or credentials are used. Run with the existing
Scrapling Python environment so identity/merge logic is shared with the collector.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path

from collect_ziroom_lingzhi import ASSETS, DEFAULT_URL, atomic_json, merge_cumulative, now, read_json, real_listing_id, record_key


def text(value):
    return str(value).strip() if isinstance(value, (str, int, float)) else ""


def housing_group(row):
    if row.get("areaScope") == "listed_bedroom" or text(row.get("roomLabel")) or "合租" in text(row.get("product")):
        return "shared"
    bedrooms = row.get("bedrooms")
    if isinstance(bedrooms, bool) or not isinstance(bedrooms, (int, float)) or bedrooms < 1 or int(bedrooms) != bedrooms:
        return "unknown"
    return "3+" if bedrooms >= 3 else str(int(bedrooms))


def field_value(field):
    return field.get("value") if isinstance(field, dict) and field.get("verified") is True else None


def file_evidence(path):
    return {"file": "assets/" + path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def build_registry(assets=ASSETS):
    assets = Path(assets)
    original = read_json(assets / "properties.json")
    crawled = read_json(assets / "crawled-properties.json")
    geography = read_json(assets / "property-geography.json")
    audit = read_json(assets / "listing-inventory.json")
    references = read_json(assets / "three-source-coverage.json")
    original_at = original.get("source", {}).get("observedAt")
    historical = [{**p, "observedAt": p.get("observedAt") or original_at} for p in original.get("properties", [])]
    records = merge_cumulative(historical, crawled.get("properties", []))
    audit_by_id = {text(row.get("id")): row for row in audit.get("properties", [])}
    geo_by_id = {text(row.get("id")): row for row in geography.get("properties", [])}
    refs_by_id = {text(row.get("id")): row for row in references.get("properties", [])}
    business_groups, district_groups, communities = defaultdict(list), defaultdict(list), set()
    bedroom_groups = {key: [] for key in ("1", "2", "3+", "shared", "unknown")}
    confirmed_districts = set()
    rows = []
    for row in records:
        identifier = text(row["id"])
        fields = audit_by_id.get(identifier, {}).get("fields", {})
        geo = geo_by_id.get(identifier, {})
        business_evidence = geo.get("businessDistrict", {})
        district = text(row.get("district") or field_value(fields.get("district")))
        district_confirmed = fields.get("district", {}).get("verified") is True or row.get("districtConfidence") == "confirmed"
        business = text(field_value(fields.get("businessArea")) or (business_evidence.get("name") if business_evidence.get("status") in ("confirmed", "confirmed_existing_detail_read") else ""))
        business_key = business or "__unknown__"
        refs = refs_by_id.get(identifier, {})
        group = housing_group(row)
        business_groups[business_key].append(identifier)
        district_groups[district or "__unknown__"].append(identifier)
        bedroom_groups[group].append(identifier)
        communities.add(district + "|" + text(row.get("name")))
        if district and district_confirmed:
            confirmed_districts.add(district)
        missing = list(refs.get("missing") or [])
        if not business:
            missing.append("自如商圈归属")
        if not district_confirmed:
            missing.append("行政区归属核验")
        missing.extend(["该套房的设备实装清单与型号", "设备最新状态与历史遥测"])
        rows.append({
            "id": identifier, "recordKey": record_key(row), "realListingId": real_listing_id(row),
            "name": row["name"], "listingLabel": row.get("listingLabel"),
            "city": "北京", "district": district or None,
            "districtVerified": district_confirmed,
            "businessArea": business or None, "businessAreaVerified": bool(business),
            "businessAreaCandidate": business_evidence.get("candidate"),
            "bedroomGroup": group, "bedrooms": row.get("bedrooms"), "roomLabel": row.get("roomLabel"),
            "area": row.get("area"), "areaScope": row.get("areaScope"),
            "product": row.get("product"), "sourceUrl": row.get("sourceUrl"),
            "firstSeen": row.get("firstSeen") or row.get("observedAt"),
            "lastSeen": row.get("lastSeen") or row.get("observedAt"),
            "currentAvailability": "unknown", "retainedInCumulativeInventory": True,
            "lingzhiFilterReturned": row.get("lingzhiFilterReturned") is True,
            "lingzhiLabelVisible": row.get("lingzhiLabelVisible"),
            "referenceStatus": refs.get("status") or "needs_references",
            "floorplanCount": refs.get("floorplanCount", 0),
            "interiorPhotoCount": refs.get("interiorPhotoCount", 0), "verifiedVRCount": 0,
            "modelReady": refs.get("modelReady") is True,
            "geometryScope": refs.get("reconstructionScope") or "not_eligible_for_source_based_reconstruction",
            "deviceInstallationVerified": False, "telemetryConnected": False,
            "missing": list(dict.fromkeys(missing)),
        })
    confirmed_businesses = [key for key in business_groups if key != "__unknown__"]
    district_names = [key for key in district_groups if key != "__unknown__"]
    reference_ready = [row["id"] for row in rows if row["modelReady"]]
    latest_attempt = {
        key: value for key, value in references.get("verification", {}).items()
        if key in {"checkedAt", "sourceUrl", "status", "reason", "message", "httpStatus", "bodyBytes", "sha256", "challengeMarkers", "validListingPages", "newVerifiedListings", "requestsAttempted"}
    }
    labels = {"1": "1居", "2": "2居", "3+": "3居及以上", "shared": "合租单间", "unknown": "待分类"}
    registry = {
        "schemaVersion": 1, "builtAt": now(), "buildMode": "offline_saved_evidence", "networkRequestsThisBuild": 0,
        "sourceScope": {"city": "北京", "cityCode": "110000", "mapURL": DEFAULT_URL, "filter": "更多 → 灵之智能 → 确定", "filterEncodedInURL": False, "rentalMode": "按地图筛选结果收录，合租单间单列", "coverage": "partial_cumulative_collection"},
        "knownTotal": None, "isFullInventory": False,
        "countingRule": "运维中房源 = 累计已采集并保存的全部房源记录；真实ID优先去重，否则按来源批次与本地索引去重。身份、商圈、户型或设备资料待补不删除记录。",
        "totals": {"collected": len(rows), "knownTotal": None, "isFullInventory": False, "businessAreas": len(confirmed_businesses), "businessUnknown": len(business_groups.get("__unknown__", [])), "communities": len(communities), "districts": len(district_names), "confirmedDistricts": len(confirmed_districts), "pendingDistricts": len(set(district_names) - confirmed_districts), "bedrooms": {key: len(ids) for key, ids in bedroom_groups.items()}, "realListingIDs": sum(bool(row["realListingId"]) for row in rows), "localRecordIDs": sum(not row["realListingId"] for row in rows), "verifiedCurrentAvailability": 0, "telemetryConnected": 0},
        "groups": {
            "businessAreas": [{"key": key, "label": key if key != "__unknown__" else "商圈待核验", "verified": key != "__unknown__", "count": len(ids), "propertyIds": ids} for key, ids in sorted(business_groups.items(), key=lambda item: (item[0] == "__unknown__", item[0]))],
            "bedrooms": [{"key": key, "label": labels[key], "count": len(ids), "propertyIds": ids} for key, ids in bedroom_groups.items()],
            "districts": [{"key": key, "label": key if key != "__unknown__" else "行政区待补", "verified": key in confirmed_districts, "count": len(ids), "propertyIds": ids} for key, ids in sorted(district_groups.items())],
        },
        "propertyIDs": [row["id"] for row in rows],
        "referenceCoverage": {"complete": len(reference_ready), "pending": len(rows) - len(reference_ready), "referencePropertyIds": reference_ready, "floorplanFiles": sum(row["floorplanCount"] for row in rows), "interiorPhotoFiles": sum(row["interiorPhotoCount"] for row in rows), "verifiedVR": 0, "measuredLayouts": 0, "genericModelsCountAsActualLayouts": False},
        "latestAttempt": latest_attempt, "newNetworkAttemptPerformed": False,
        "fullInventoryRequirements": ["北京城市范围与灵之智能筛选证据", "已核验分页语义且无重复/失败页", "精确总量来源与唯一房源数一致", "每条当前记录具备可靠房源身份", "采集时间和正常页面响应记录"],
        "sourceEvidence": [file_evidence(assets / name) for name in ("properties.json", "crawled-properties.json", "listing-inventory.json", "property-geography.json", "three-source-coverage.json")],
        "properties": rows,
    }
    access = {
        "schemaVersion": 1, "status": "blocked", "networkCollectionAllowed": False,
        "scope": {"city": "北京", "cityCode": "110000", "filter": "灵之智能", "sourceUrl": DEFAULT_URL},
        "latestAttempt": latest_attempt, "newNetworkAttemptPerformed": False,
        "recordedFrom": "assets/three-source-coverage.json", "recordedAt": now(),
        "reason": "existing_source_challenge", "message": "沿用已有官方地图访问校验记录，本次未发送网络请求；继续处理已保存资料和授权公开导出。",
        "resumeEvidenceNeeded": "可正常取得的公开页面或获授权公开清单，以及可核验的筛选/分页/总量证据。",
    }
    return registry, access


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", type=Path, default=ASSETS)
    args = parser.parse_args()
    registry, access = build_registry(args.assets)
    atomic_json(args.assets / "inventory-registry.json", registry)
    atomic_json(args.assets / "source-access-status.json", access)
    print(json.dumps({"totals": registry["totals"], "referenceCoverage": registry["referenceCoverage"], "latestAttemptAt": registry["latestAttempt"].get("checkedAt"), "networkRequests": 0}, ensure_ascii=False))


if __name__ == "__main__":
    main()
