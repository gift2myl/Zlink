#!/usr/bin/env python3
"""Build the cumulative Beijing/Lingzhi registry from saved evidence only.

No HTTP, browser, DNS, geocoding or credentials are used. Run with the existing
Scrapling Python environment so identity/merge logic is shared with the collector.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from collect_ziroom_lingzhi import ASSETS, DEFAULT_URL, atomic_json, merge_cumulative, now, read_json, real_listing_id, record_key, safe_url


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


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo is not None else None
    except (TypeError, ValueError):
        return None


def current_snapshot(dataset, report):
    """Validate a completed run independently of the cumulative history count.

    Configuration flags or an old successful batch cannot establish a current
    snapshot. A matching run, terminal pagination evidence, page provenance and
    every real property identity must agree before exposing a verified total.
    """
    source = dataset.get("source", {})
    issues = []
    run_id = text(report.get("runId"))
    matched_run = bool(run_id and source.get("latestRunId") == run_id)
    if not matched_run:
        issues.append("run_identity_unmatched")
    started, finished = timestamp(report.get("startedAt")), timestamp(report.get("finishedAt"))
    observed, run_finished = timestamp(source.get("observedAt")), timestamp(source.get("latestRunFinishedAt"))
    matched_time = bool(started and finished and observed and run_finished
                        and started <= observed <= finished and run_finished == finished)
    if not matched_time:
        issues.append("run_timestamps_unmatched")
    if dataset.get("schemaVersion") != 1 or report.get("schemaVersion") != 1:
        issues.append("unsupported_schema")
    if not (report.get("status") == "complete" and report.get("isFullInventory") is True
            and source.get("latestRunIsFullInventory") is True):
        issues.append("run_not_complete")
    scope = report.get("scope", {})
    if scope.get("cityCode") != "110000" or scope.get("filter") != "灵之智能":
        issues.append("source_scope_unverified")
    if not (report.get("filterVerified") is True and source.get("filterVerified") is True
            and report.get("filterEvidence")):
        issues.append("filter_evidence_missing")
    if not (report.get("paginationVerified") is True and report.get("paginationEvidence")
            and report.get("paginationComplete") is True and source.get("paginationComplete") is True):
        issues.append("pagination_incomplete")
    coverage = report.get("coverage", {})
    if not isinstance(coverage, dict):
        coverage = {}
    expected = coverage.get("expectedTotal")
    valid_total = isinstance(expected, int) and not isinstance(expected, bool) and expected >= 0
    if not (valid_total and coverage.get("totalEvidence")):
        issues.append("exact_total_evidence_missing")
    if not (report.get("citywideVerified") is True and coverage.get("citywideVerified") is True
            and coverage.get("citywideEvidence") and coverage.get("viewportLimited") is False):
        issues.append("citywide_scope_unverified")
    if source.get("coverageEvidence") != coverage:
        issues.append("coverage_evidence_unmatched")
    keys = source.get("latestRunPropertyKeys")
    valid_keys = isinstance(keys, list) and all(isinstance(key, str) and re.fullmatch(r"ziroom:[0-9]+", key) for key in keys)
    if not valid_keys or len(keys) != len(set(keys)):
        issues.append("latest_run_keys_invalid")
        keys = []
    raw_records = dataset.get("properties", [])
    raw_records = raw_records if isinstance(raw_records, list) else []
    rows_by_key = defaultdict(list)
    for row in raw_records:
        if isinstance(row, dict):
            rows_by_key[record_key(row)].append(row)
    selected = []
    for key in keys:
        candidates = rows_by_key.get(key, [])
        if len(candidates) != 1:
            issues.append("latest_run_identity_missing_or_duplicate")
            continue
        row = candidates[0]
        if not (real_listing_id(row) and row.get("id") and row.get("name")
                and row.get("lingzhiFilterReturned") is True
                and not row.get("imported") and row.get("sourceKind") != "imported"):
            issues.append("latest_run_identity_or_filter_unverified")
            continue
        selected.append(row)
    if not (valid_total and expected == report.get("uniqueCount") == len(keys) == len(selected)):
        issues.append("unique_count_mismatch")
    if report.get("unknownIdentityCount", 0) != 0 or report.get("rejectedRecords", 0) != 0:
        issues.append("run_has_unverified_records")
    if report.get("repeatedPageCount", 0) != 0 or report.get("duplicatePageCount", 0) != 0:
        issues.append("run_has_repeated_pages")
    pages = report.get("pages")
    pages = pages if isinstance(pages, list) else []
    if not pages or len(pages) != report.get("pagesFetched"):
        issues.append("page_count_mismatch")
    observed_keys, urls, signatures, hashes = set(), set(), set(), set()
    for page in pages:
        if not isinstance(page, dict):
            issues.append("page_evidence_invalid")
            continue
        page_keys = page.get("recordKeys")
        key_list = isinstance(page_keys, list) and all(isinstance(key, str) for key in page_keys)
        if not key_list or len(page_keys) != page.get("records") or len(page_keys) != len(set(page_keys)):
            issues.append("page_record_keys_invalid")
            page_keys = []
        fetched = timestamp(page.get("fetchedAt"))
        sha = text(page.get("sha256"))
        url = text(page.get("url"))
        try:
            safe_url(url)
        except ValueError:
            issues.append("page_source_invalid")
        if not (page.get("httpStatus") == 200 and page.get("classification") == "no_access_block_observed"
                and not page.get("challengeMarkers") and page.get("rejectedRecords") == 0
                and re.fullmatch(r"[0-9a-f]{64}", sha)
                and isinstance(page.get("bodyBytes"), int) and page["bodyBytes"] > 0
                and fetched and started and finished and started <= fetched <= finished):
            issues.append("page_evidence_invalid")
        signature = tuple(sorted(page_keys))
        if url in urls or signature in signatures or sha in hashes:
            issues.append("repeated_page_evidence")
        urls.add(url)
        signatures.add(signature)
        hashes.add(sha)
        observed_keys.update(page_keys)
    if observed_keys != set(keys):
        issues.append("page_and_dataset_keys_mismatch")
    if not matched_run or not matched_time:
        selected, keys = [], []
    issues = list(dict.fromkeys(issues))
    complete = not issues
    return {
        "runId": run_id or None, "observedAt": source.get("latestRunFinishedAt"),
        "isFullInventory": complete, "knownTotal": expected if complete else None,
        "collected": len(selected), "propertyIds": [row["id"] for row in selected],
        "propertyKeys": keys, "validationIssues": issues,
    }


def build_registry(assets=ASSETS):
    assets = Path(assets)
    original = read_json(assets / "properties.json")
    crawled = read_json(assets / "crawled-properties.json")
    geography = read_json(assets / "property-geography.json")
    audit = read_json(assets / "listing-inventory.json")
    references = read_json(assets / "three-source-coverage.json")
    report_path = assets / "crawl-status.json"
    report = read_json(report_path) if report_path.exists() else {}
    access_path = assets / "source-access-status.json"
    access = read_json(access_path) if access_path.exists() else None
    snapshot = current_snapshot(crawled, report)
    current_keys = set(snapshot["propertyKeys"])
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
            "seenInLatestRun": record_key(row) in current_keys,
            "includedInVerifiedCurrentInventory": snapshot["isFullInventory"] and record_key(row) in current_keys,
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
        "sourceScope": {"city": "北京", "cityCode": "110000", "mapURL": DEFAULT_URL, "filter": "更多 → 灵之智能 → 确定", "filterEncodedInURL": False, "rentalMode": "按地图筛选结果收录，合租单间单列", "coverage": "current_full_snapshot_with_cumulative_history" if snapshot["isFullInventory"] else "partial_cumulative_collection"},
        "knownTotal": snapshot["knownTotal"], "isFullInventory": snapshot["isFullInventory"],
        "currentSnapshot": snapshot,
        "countingRule": "totals.collected 和 properties 为累计已保存记录，真实ID优先去重，否则按来源批次与本地索引去重；currentSnapshot 是本次采集集合。knownTotal/isFullInventory 仅描述该集合的经核验全城完整度，不把历史记录数当作当前全量。",
        "totals": {"collected": len(rows), "currentCollected": snapshot["collected"], "knownTotal": snapshot["knownTotal"], "isFullInventory": snapshot["isFullInventory"], "businessAreas": len(confirmed_businesses), "businessUnknown": len(business_groups.get("__unknown__", [])), "communities": len(communities), "districts": len(district_names), "confirmedDistricts": len(confirmed_districts), "pendingDistricts": len(set(district_names) - confirmed_districts), "bedrooms": {key: len(ids) for key, ids in bedroom_groups.items()}, "realListingIDs": sum(bool(row["realListingId"]) for row in rows), "localRecordIDs": sum(not row["realListingId"] for row in rows), "verifiedCurrentAvailability": 0, "telemetryConnected": 0},
        "groups": {
            "businessAreas": [{"key": key, "label": key if key != "__unknown__" else "商圈待核验", "verified": key != "__unknown__", "count": len(ids), "propertyIds": ids} for key, ids in sorted(business_groups.items(), key=lambda item: (item[0] == "__unknown__", item[0]))],
            "bedrooms": [{"key": key, "label": labels[key], "count": len(ids), "propertyIds": ids} for key, ids in bedroom_groups.items()],
            "districts": [{"key": key, "label": key if key != "__unknown__" else "行政区待补", "verified": key in confirmed_districts, "count": len(ids), "propertyIds": ids} for key, ids in sorted(district_groups.items())],
        },
        "propertyIDs": [row["id"] for row in rows],
        "referenceCoverage": {"complete": len(reference_ready), "pending": len(rows) - len(reference_ready), "referencePropertyIds": reference_ready, "floorplanFiles": sum(row["floorplanCount"] for row in rows), "interiorPhotoFiles": sum(row["interiorPhotoCount"] for row in rows), "verifiedVR": 0, "measuredLayouts": 0, "genericModelsCountAsActualLayouts": False},
        "latestAttempt": latest_attempt, "newNetworkAttemptPerformed": False,
        "fullInventoryRequirements": ["北京城市范围与灵之智能筛选证据", "已核验分页语义且无重复/失败页", "精确总量来源与唯一房源数一致", "每条当前记录具备可靠房源身份", "采集时间和正常页面响应记录"],
        "sourceEvidence": [file_evidence(assets / name) for name in ("properties.json", "crawled-properties.json", "listing-inventory.json", "property-geography.json", "three-source-coverage.json", "crawl-status.json") if (assets / name).exists()],
        "properties": rows,
    }
    # Returning the existing access record preserves callers' tuple contract.
    # Inventory aggregation never grants network access or rewrites stop evidence.
    return registry, access


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", type=Path, default=ASSETS)
    args = parser.parse_args()
    registry, access = build_registry(args.assets)
    atomic_json(args.assets / "inventory-registry.json", registry)
    print(json.dumps({"totals": registry["totals"], "referenceCoverage": registry["referenceCoverage"], "latestAttemptAt": registry["latestAttempt"].get("checkedAt"), "networkRequests": 0}, ensure_ascii=False))


if __name__ == "__main__":
    main()
