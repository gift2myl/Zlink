#!/usr/bin/env python3
"""Diagnose saved Ziroom access evidence offline; never fetch or clear a stop.

Usage: python diagnose_ziroom_access.py --output /tmp/ziroom-access.json
The running interpreter is inspected through package metadata and module discovery.
Neither the collector nor Scrapling Fetcher is imported. Only --output is written.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import importlib.metadata
import importlib.util
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path


INPUTS = {
    "crawl": "ops/assets/crawl-status.json",
    "coverage": "ops/assets/three-source-coverage.json",
    "access": "ops/assets/source-access-status.json",
    "installation": "ops/tools/installation-report.json",
    "config": "ops/tools/ziroom-lingzhi.config.json",
}
SECTION_TYPES = {
    "crawl": {"engine": dict, "evidence": dict, "pages": list},
    "coverage": {"verification": dict, "lastKnownAccess": dict, "coverage": dict},
    "access": {"latestAttempt": dict, "scope": dict},
    "installation": {"packages": dict},
    "config": {"filter": dict, "pagination": dict, "extraction": dict, "coverage": dict},
}
KNOWN_MARKERS = {"EO_Bot_Ssid", "__tst_status", "cf-chl-", "captcha", "验证码", "人机验证", "访问过于频繁", "安全验证", "verify you are human", "access denied"}


def obj(value):
    return value if isinstance(value, dict) else {}


def decode_document(raw):
    try:
        value = json.loads(raw.decode("utf-8-sig"))
    except UnicodeDecodeError:
        return {}, {"code": "invalid_utf8"}
    except json.JSONDecodeError as exc:
        return {}, {"code": "invalid_json", "line": exc.lineno, "column": exc.colno}
    if not isinstance(value, dict):
        return {}, {"code": "invalid_root_type", "expected": "object", "actual": type(value).__name__}
    return value, None


def load_inputs(root):
    docs, files, errors = {}, {}, []
    for name, relative in INPUTS.items():
        path = (root / relative).resolve()
        meta = {"file": str(path), "sha256": None, "readOnly": True}
        try:
            raw = path.read_bytes()
            meta.update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
            document, error = decode_document(raw)
        except OSError as exc:
            document, error = {}, {"code": "input_read_error", "errorType": type(exc).__name__}
        if error:
            errors.append({"file": str(path), "jsonPath": "$", **error})
        for section, expected in SECTION_TYPES.get(name, {}).items():
            if section in document and not isinstance(document[section], expected):
                errors.append({"file": str(path), "jsonPath": "$." + section,
                               "code": "invalid_section_type", "expected": expected.__name__,
                               "actual": type(document[section]).__name__})
        docs[name], files[name] = document, meta
    return docs, files, errors


def ref(files, name, *paths):
    return {"file": files[name]["file"], "jsonPaths": list(paths)}


def normalized_timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except ValueError:
        return None


def header_present(record, name, flat_names=()):
    for container in ("headers", "responseHeaders", "safeResponseHeaders"):
        if any(str(key).lower() == name.lower() and bool(value)
               for key, value in obj(record.get(container)).items()):
            return True
    return any(bool(record.get(key)) for key in flat_names)


def response_evidence_present(record):
    # Inspect presence only. No original body, header values, cookies or URLs are emitted.
    return {
        "rawResponseBody": any(bool(record.get(key)) for key in ("rawBody", "responseBody", "rawBodyFile", "responseBodyFile")),
        "contentType": header_present(record, "Content-Type", ("contentType",)),
        "edgeOneLogUuid": header_present(record, "EO-LOG-UUID", ("eoLogUuid", "edgeOneLogUuid")),
        "finalResponseUrl": any(bool(record.get(key)) for key in ("finalUrl", "final_url", "responseUrl")),
    }


def historical_requests(docs, files):
    candidates = []
    crawl = docs["crawl"]
    pages = crawl.get("pages")
    if isinstance(pages, list):
        for index, page in enumerate(pages):
            if isinstance(page, dict):
                candidates.append((page, page.get("fetchedAt") or page.get("checkedAt"), "crawl", f"$.pages[{index}]"))
    if obj(crawl.get("evidence")):
        candidates.append((crawl["evidence"], crawl.get("finishedAt"), "crawl", "$.evidence"))
    for name, key in (("coverage", "verification"), ("coverage", "lastKnownAccess"), ("access", "latestAttempt")):
        record = obj(docs[name].get(key))
        if record:
            candidates.append((record, record.get("checkedAt") or record.get("fetchedAt"), name, "$." + key))
    unique, incomplete = {}, []
    for record, timestamp, name, pointer in candidates:
        stamp = normalized_timestamp(timestamp)
        digest = record.get("sha256")
        digest = digest.lower() if isinstance(digest, str) and re.fullmatch(r"[0-9a-fA-F]{64}", digest) else None
        evidence = ref(files, name, pointer, "$.finishedAt") if name == "crawl" and pointer == "$.evidence" else ref(files, name, pointer)
        if stamp is None or digest is None:
            incomplete.append({"source": evidence, "reason": "timestamp_or_sha256_missing_or_invalid"})
            continue
        key = (stamp, digest)
        entry = unique.setdefault(key, {
            "timestamp": stamp, "sha256": digest, "httpStatus": None, "bodyBytes": None,
            "challengeMarkers": [], "evidencePresence": {key: False for key in response_evidence_present({})},
            "sources": [], "conflictingFields": [],
        })
        entry["sources"].append(evidence)
        for field in ("httpStatus", "bodyBytes"):
            value = record.get(field)
            if isinstance(value, int) and not isinstance(value, bool):
                if entry[field] is not None and entry[field] != value:
                    if field not in entry["conflictingFields"]:
                        entry["conflictingFields"].append(field)
                else:
                    entry[field] = value
        markers = record.get("challengeMarkers", [])
        if isinstance(markers, list):
            entry["challengeMarkers"] = sorted(set(entry["challengeMarkers"]) | {m for m in markers if isinstance(m, str) and m in KNOWN_MARKERS})
        for field, present in response_evidence_present(record).items():
            entry["evidencePresence"][field] |= present
    entries = sorted(unique.values(), key=lambda item: item["timestamp"])
    missing = []
    expected = {
        "rawResponseBody": "原始响应正文或对应保存文件未记录；不能离线复核页面结构。",
        "contentType": "Content-Type 未记录；不能核对来源声明的响应类型。",
        "edgeOneLogUuid": "EO-LOG-UUID 未记录；无法用该请求标识关联站点侧日志，亦不保证来源曾返回该头。",
        "finalResponseUrl": "最终响应 URL 未明确记录；请求 URL 不能替代最终 URL。",
    }
    for entry in entries:
        for field, present in entry["evidencePresence"].items():
            if not present:
                missing.append({"field": field, "timestamp": entry["timestamp"], "sha256": entry["sha256"],
                                "message": expected[field], "sources": entry["sources"]})
    return {"deduplicationKey": ["timestamp_normalized_to_UTC", "response_sha256"],
            "candidateEvidenceRecords": len(candidates), "uniqueRequestCount": len(entries),
            "requests": entries, "incompleteEvidenceRecords": incomplete}, missing


def configuration_issues(config, files):
    issues = []
    def need(condition, code, message, *paths):
        if not condition:
            issues.append({"code": code, "message": message, "source": ref(files, "config", *paths)})
    f, p, e, c = (obj(config.get(key)) for key in ("filter", "pagination", "extraction", "coverage"))
    need(config.get("cityCode") == "110000", "beijing_scope_unverified", "城市必须明确为北京 110000。", "$.cityCode")
    need(f.get("name") == "灵之智能" and f.get("verified") is True, "filter_unverified", "灵之智能筛选尚未核验。", "$.filter.name", "$.filter.verified")
    need(bool(f.get("evidence")), "filter_evidence_missing", "缺少筛选结果证据；仅打开默认地图不能证明已选中灵之智能。", "$.filter.evidence")
    need(isinstance(f.get("requiredQuery"), dict) and bool(f.get("requiredQuery")), "filter_query_mapping_missing", "未配置可核验筛选参数；若筛选不通过 URL 参数传递，应另行保存真实筛选机制证据。", "$.filter.requiredQuery")
    need(p.get("verified") is True and bool(p.get("evidence")), "pagination_unverified", "分页语义与末页判断尚未核验。", "$.pagination.verified", "$.pagination.evidence")
    mode = p.get("mode")
    need((mode == "next_link" and bool(p.get("nextCss"))) or (mode == "query" and bool(p.get("pageParam"))),
         "pagination_locator_missing", "缺少与所选分页模式对应的下一页选择器或页码参数。", "$.pagination.mode", "$.pagination.nextCss", "$.pagination.pageParam")
    need(e.get("verified") is True and isinstance(e.get("fields"), dict) and bool(e["fields"]),
         "field_mapping_unverified", "房源身份、商圈、居室等字段尚无已核验提取映射。", "$.extraction.verified", "$.extraction.fields")
    need((e.get("format") == "html" and bool(e.get("recordCss"))) or (e.get("format") == "json" and "recordPath" in e),
         "record_locator_missing", "缺少房源记录选择器或 JSON 记录路径。", "$.extraction.format", "$.extraction.recordCss", "$.extraction.recordPath")
    total = c.get("expectedTotal")
    need(isinstance(total, int) and not isinstance(total, bool) and total >= 0 and bool(c.get("totalEvidence")),
         "exact_total_evidence_missing", "缺少同一筛选范围的精确总量及证据。", "$.coverage.expectedTotal", "$.coverage.totalEvidence")
    need(c.get("citywideVerified") is True and bool(c.get("citywideEvidence")) and c.get("viewportLimited") is False,
         "citywide_coverage_unverified", "尚未证明覆盖北京全城且不受当前地图视窗或区域子集限制。", "$.coverage.citywideVerified", "$.coverage.citywideEvidence", "$.coverage.viewportLimited")
    return issues


def package_diagnostics(installation, files):
    imports = []
    approval = obj(installation.get("approval"))
    try:
        dist = importlib.metadata.distribution("scrapling")
        version = dist.version
        parser_path = Path(dist.locate_file("scrapling/parser.py"))
        parser_present = parser_path.is_file()
        for relative, module in (("scrapling/fetchers/requests.py", "scrapling.engines.static"),
                                 ("scrapling/engines/static.py", "scrapling.engines.toolbelt.convertor"),
                                 ("scrapling/engines/toolbelt/convertor.py", "patchright.sync_api"),
                                 ("scrapling/engines/toolbelt/fingerprints.py", "browserforge.headers")):
            source = Path(dist.locate_file(relative))
            try:
                content = source.read_bytes()
                package = ".".join(Path(relative).parts[:-1])
                matching = [node.lineno for node in ast.walk(ast.parse(content))
                            if isinstance(node, ast.ImportFrom)
                            and importlib.util.resolve_name("." * node.level + (node.module or ""), package) == module]
                imports.append({"file": str(source), "sha256": hashlib.sha256(content).hexdigest(),
                                "importedModule": module, "matchingSourceLines": matching,
                                "inspectedStatically": True, "executed": False})
            except (OSError, SyntaxError) as exc:
                imports.append({"file": str(source), "readErrorType": type(exc).__name__, "executed": False})
    except importlib.metadata.PackageNotFoundError:
        version, parser_path, parser_present = None, None, False
    dependencies = {}
    for name in ("curl_cffi", "patchright", "browserforge"):
        try:
            dependencies[name] = importlib.util.find_spec(name) is not None
        except (ImportError, ValueError):
            dependencies[name] = False
    recorded_error = installation.get("nativeFetcherImportError")
    missing = re.search(r"No module named ['\"]([\w.]+)['\"]", recorded_error or "") if isinstance(recorded_error, str) else None
    return {
        "installedVersionInCurrentInterpreter": version,
        "parserModulePresent": parser_present,
        "parserModuleFile": str(parser_path) if parser_present else None,
        "parserExecutionTestPerformed": False,
        "recordedParserAvailable": installation.get("parserAvailable") if isinstance(installation.get("parserAvailable"), bool) else None,
        "nativeFetcherImported": False,
        "nativeFetcherExecutionTestPerformed": False,
        "recordedNativeFetcherAvailable": installation.get("nativeFetcherAvailable") if isinstance(installation.get("nativeFetcherAvailable"), bool) else None,
        "recordedMissingDependency": missing.group(1) if missing else None,
        "recordedApprovalStatus": approval.get("status"),
        "recordedApprovalAction": approval.get("action"),
        "recordedApprovalReason": approval.get("reason"),
        "recordedApprovalScope": "本地依赖安装的环境审批记录；不代表官网访问限制的原因或解除结果。",
        "recordedApprovalSource": ref(files, "installation", "$.approval.status", "$.approval.action", "$.approval.reason"),
        "topLevelDependencyModulesDiscoverable": dependencies,
        "dependencyImportSourceEvidence": imports,
        "interpretation": "解析器文件与历史可用记录、原生 Fetcher 依赖状态、网站响应是三个独立证据层。模块可发现不等于运行已测试；修复依赖不能证明网站校验已解除。",
        "sources": [ref(files, "installation", "$.packages.scrapling", "$.parserAvailable", "$.nativeFetcherAvailable", "$.nativeFetcherImportError")],
    }


def self_check():
    checks = []
    for name, raw, expected in (("object", b'{"ok":true}', None), ("malformed_json", b'{"ok":', "invalid_json"),
                                ("wrong_root_type", b'[]', "invalid_root_type"), ("invalid_utf8", b'\xff', "invalid_utf8")):
        _, error = decode_document(raw)
        checks.append({"name": name, "passed": (error or {}).get("code") == expected})
    checks.append({"name": "timezone_normalization", "passed": normalized_timestamp("2026-11-19T18:23:01+08:00") == "2026-11-19T10:23:01Z"})
    return {"passed": all(item["passed"] for item in checks), "checks": checks, "networkRequests": 0}


def build_report(root, check=False):
    docs, files, errors = load_inputs(root)
    history, missing = historical_requests(docs, files)
    config_issues = configuration_issues(docs["config"], files)
    access = docs["access"]
    stop = access.get("status") in ("blocked", "stopped") or access.get("networkCollectionAllowed") is False
    explicit_access = access.get("networkCollectionAllowed") is True
    verification = obj(docs["coverage"].get("verification"))
    engine = obj(docs["crawl"].get("engine"))
    transport = {"historicalRecordedTransports": sorted({v for v in (engine.get("transport"), verification.get("transport")) if v in ("urllib", "Scrapling Fetcher")}),
                 "behaviorObservedInSavedVerification": {key: verification[key] for key in ("redirectsFollowed", "retried", "cookieJarUsed", "javascriptExecuted", "browserUsed", "impersonationEnabled") if isinstance(verification.get(key), bool)},
                 "sources": [ref(files, "crawl", "$.engine"), ref(files, "coverage", "$.verification")]}
    collector = root / "ops/tools/collect_ziroom_lingzhi.py"
    source_code = {"file": str(collector), "symbols": ["PublicHttp.get", "NoRedirect.redirect_request", "native_fetcher_state", "inspect_response"], "executed": False}
    try:
        source_code["sha256"] = hashlib.sha256(collector.read_bytes()).hexdigest()
    except OSError as exc:
        source_code["readErrorType"] = type(exc).__name__
    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mode": "offline_evidence_diagnosis",
        "newNetworkRequests": 0,
        "inputsModified": False,
        "inputs": files,
        "inputErrors": errors,
        "installation": package_diagnostics(docs["installation"], files),
        "transport": transport,
        "sourceCodeEvidence": [source_code],
        "historicalRequests": history,
        "missingEvidence": missing,
        "configurationIssues": config_issues,
        "conclusions": {
            "effectiveListingResponseEstablished": False,
            "ipBanEstablished": False,
            "specificRuleOrTriggerEstablished": False,
            "zeroInventoryEstablished": False,
            "statement": "现有记录未建立有效房源列表响应证据；历史 HTTP 200 和校验标记不能证明封 IP、具体触发规则或北京库存为 0。原始正文与响应头不全，无法进一步离线复核。",
            "sources": [ref(files, "crawl", "$.pagesFetched", "$.uniqueCount", "$.reason"), ref(files, "coverage", "$.verification.validListingPages", "$.verification.newVerifiedListings", "$.verification.reason")],
        },
        "gate": {
            "canCollectFromExistingEvidence": bool(explicit_access and not stop and not errors and not config_issues),
            "sourceStopActive": stop,
            "explicitNetworkCollectionAllowedInSourceRecord": explicit_access,
            "configurationReady": not config_issues,
            "inputsValid": not errors,
            "willCollect": False,
            "stopRecordModified": False,
            "newNetworkRequests": 0,
            "doesNotGrantAuthorizationOrClearStop": True,
            "reasonCodes": (["existing_source_stop"] if stop else []) + ([] if explicit_access else ["no_explicit_source_access_allowance"]) + (["configuration_incomplete"] if config_issues else []) + (["input_errors"] if errors else []),
            "sources": [ref(files, "access", "$.status", "$.networkCollectionAllowed"), ref(files, "config", "$.filter", "$.pagination", "$.extraction", "$.coverage")],
        },
    }
    if check:
        report["selfCheck"] = self_check()
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--self-check", action="store_true", help="Run small in-memory JSON validation checks; no requests or input writes.")
    args = parser.parse_args()
    root, output = args.repo_root.resolve(), args.output.resolve()
    protected = {(root / relative).resolve() for relative in INPUTS.values()}
    protected.update({Path(__file__).resolve(), (root / "ops/tools/collect_ziroom_lingzhi.py").resolve()})
    if output in protected:
        print(json.dumps({"status": "error", "reason": "output_would_overwrite_input_or_source", "newNetworkRequests": 0}))
        return 2
    report = build_report(root, args.self_check)
    temporary = None
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent, prefix=".ziroom-diagnosis-", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(report, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary, output)
    except OSError as exc:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        print(json.dumps({"status": "error", "reason": "report_write_error", "errorType": type(exc).__name__, "newNetworkRequests": 0}))
        return 2
    print(json.dumps({"status": "completed_with_input_errors" if report["inputErrors"] else "completed",
                      "output": str(output), "historicalUniqueRequests": report["historicalRequests"]["uniqueRequestCount"],
                      "sourceStopActive": report["gate"]["sourceStopActive"],
                      "canCollectFromExistingEvidence": report["gate"]["canCollectFromExistingEvidence"],
                      "configurationIssueCount": len(report["configurationIssues"]),
                      "inputErrorCount": len(report["inputErrors"]), "newNetworkRequests": 0,
                      "selfCheckPassed": report.get("selfCheck", {}).get("passed")}, ensure_ascii=False))
    return 2 if report["inputErrors"] or report.get("selfCheck", {}).get("passed") is False else 0


if __name__ == "__main__":
    raise SystemExit(main())
