#!/usr/bin/env python3
"""Synthetic offline inventory tests. Temporary fixtures never enter production."""
from __future__ import annotations

import contextlib
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import build_inventory_registry as registry


def complete_fixture(count=14):
    start, finish = "2026-11-20T12:00:00+08:00", "2026-11-20T12:02:00+08:00"
    rows = [{
        "id": str(990000 + index), "realListingId": str(990000 + index),
        "idType": "ziroom_property_id", "name": "合成测试小区" + str(index),
        "district": "合成测试区", "bedrooms": 1 + index % 3,
        "sourceUrl": "https://www.ziroom.com/x/" + str(990000 + index) + ".html",
        "observedAt": "2026-11-20T12:01:00+08:00", "lingzhiFilterReturned": True,
    } for index in range(count)]
    keys = [registry.record_key(row) for row in rows]
    coverage = {"expectedTotal": count, "totalEvidence": "synthetic exact-count fixture",
                "citywideVerified": True, "citywideEvidence": "synthetic Beijing-scope fixture",
                "viewportLimited": False}
    pages = []
    for index, chunk in enumerate([keys[:7], keys[7:]]):
        body = json.dumps(chunk).encode()
        pages.append({"url": "https://ditu.ziroom.com/map?fixture_page=" + str(index + 1),
                      "fetchedAt": "2026-11-20T12:01:00+08:00", "httpStatus": 200,
                      "classification": "no_access_block_observed", "challengeMarkers": [],
                      "bodyBytes": len(body), "sha256": hashlib.sha256(body).hexdigest(),
                      "records": len(chunk), "recordKeys": chunk, "rejectedRecords": 0})
    status = {"schemaVersion": 1, "runId": "synthetic-run-14", "startedAt": start,
              "finishedAt": finish, "status": "complete", "isFullInventory": True,
              "scope": {"cityCode": "110000", "filter": "灵之智能"},
              "filterVerified": True, "filterEvidence": "synthetic filter fixture",
              "paginationVerified": True, "paginationEvidence": "synthetic terminal-page fixture",
              "paginationComplete": True, "citywideVerified": True,
              "coverage": coverage, "uniqueCount": count, "unknownIdentityCount": 0,
              "repeatedPageCount": 0, "duplicatePageCount": 0, "rejectedRecords": 0,
              "pagesFetched": len(pages), "pages": pages}
    dataset = {"schemaVersion": 1, "properties": rows, "source": {
        "observedAt": finish, "latestRunId": status["runId"], "latestRunFinishedAt": finish,
        "latestRunPropertyKeys": keys, "latestRunIsFullInventory": True,
        "filterVerified": True, "paginationComplete": True, "coverageEvidence": copy.deepcopy(coverage),
        # Cumulative data may contain old observations even when this run is full.
        "isFullInventory": False,
    }}
    return dataset, status


class InventoryRegistryTests(unittest.TestCase):
    def setUp(self):
        self.network = mock.patch("urllib.request.OpenerDirector.open", side_effect=AssertionError("No network in offline tests"))
        self.network.start()
        self.addCleanup(self.network.stop)

    def test_fourteen_source_id_records_prove_full_current_snapshot(self):
        dataset, status = complete_fixture()
        result = registry.current_snapshot(dataset, status)
        self.assertTrue(result["isFullInventory"], result["validationIssues"])
        self.assertEqual(result["knownTotal"], 14)
        self.assertEqual(result["collected"], 14)
        self.assertEqual(len(result["propertyIds"]), 14)

    def test_config_claims_without_matching_capture_never_establish_full(self):
        dataset, status = complete_fixture()
        dataset["source"].pop("latestRunId")
        result = registry.current_snapshot(dataset, status)
        self.assertFalse(result["isFullInventory"])
        self.assertIsNone(result["knownTotal"])
        self.assertEqual(result["collected"], 0)

    def test_explicitly_verified_zero_inventory_is_not_a_failed_capture(self):
        dataset, status = complete_fixture(0)
        status["pages"] = status["pages"][:1]
        status["pagesFetched"] = 1
        result = registry.current_snapshot(dataset, status)
        self.assertTrue(result["isFullInventory"], result["validationIssues"])
        self.assertEqual(result["knownTotal"], 0)
        self.assertEqual(result["collected"], 0)

    def test_completion_requires_end_evidence_not_only_matching_count(self):
        dataset, status = complete_fixture()
        status["paginationComplete"] = False
        result = registry.current_snapshot(dataset, status)
        self.assertIn("pagination_incomplete", result["validationIssues"])
        self.assertFalse(result["isFullInventory"])

    def test_failed_scope_identity_time_or_page_evidence_blocks_full_claim(self):
        cases = [
            ("stale_run", lambda d, s: d["source"].update(latestRunFinishedAt="2026-11-19T12:02:00+08:00")),
            ("blocked", lambda d, s: s.update(status="blocked")),
            ("viewport", lambda d, s: s["coverage"].update(viewportLimited=True)),
            ("total", lambda d, s: s.update(uniqueCount=13)),
            ("unknown_id", lambda d, s: d["properties"][0].update(id="local-index", realListingId=None, idType="local_sample_index", sourceUrl=registry.DEFAULT_URL)),
            ("duplicate_identity", lambda d, s: d["properties"].append(copy.deepcopy(d["properties"][0]))),
            ("filter", lambda d, s: d["properties"][0].update(lingzhiFilterReturned=False)),
            ("challenge", lambda d, s: s["pages"][0].update(classification="challenge_page")),
            ("failed_page", lambda d, s: s["pages"][0].update(httpStatus=403)),
            ("missing_page", lambda d, s: s["pages"].pop()),
            ("missing_key", lambda d, s: s["pages"][0]["recordKeys"].pop()),
            ("repeated_page", lambda d, s: s["pages"].__setitem__(1, copy.deepcopy(s["pages"][0]))),
            ("rejected_row", lambda d, s: s["pages"][0].update(rejectedRecords=1)),
        ]
        for name, mutate in cases:
            with self.subTest(name=name):
                dataset, status = complete_fixture()
                mutate(dataset, status)
                result = registry.current_snapshot(dataset, status)
                self.assertFalse(result["isFullInventory"])
                self.assertIsNone(result["knownTotal"])
                self.assertTrue(result["validationIssues"])

    def make_assets(self, path, dataset, status):
        historical = [{"id": "historic-local-1", "name": "合成历史记录", "bedrooms": 1},
                      {"id": "historic-local-2", "name": "另一合成历史记录", "bedrooms": 2}]
        files = {
            "properties.json": {"source": {"observedAt": "2026-11-19"}, "properties": historical},
            "crawled-properties.json": dataset, "crawl-status.json": status,
            "property-geography.json": {"properties": []}, "listing-inventory.json": {"properties": []},
            "three-source-coverage.json": {"properties": [], "verification": {}},
        }
        for name, value in files.items():
            (path / name).write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")

    def test_cumulative_history_does_not_inflate_full_current_total(self):
        with tempfile.TemporaryDirectory() as folder:
            assets = Path(folder)
            dataset, status = complete_fixture()
            self.make_assets(assets, dataset, status)
            result, access = registry.build_registry(assets)
            self.assertEqual(result["totals"]["collected"], 16)
            self.assertEqual(result["totals"]["currentCollected"], 14)
            self.assertEqual(result["knownTotal"], 14)
            self.assertTrue(result["isFullInventory"])
            self.assertEqual(sum(row["includedInVerifiedCurrentInventory"] for row in result["properties"]), 14)
            self.assertIsNone(access)

    def test_main_preserves_access_file_byte_for_byte_for_blocked_and_allowed_states(self):
        for blocked in (True, False):
            with self.subTest(blocked=blocked), tempfile.TemporaryDirectory() as folder:
                assets = Path(folder)
                dataset, status = complete_fixture()
                if blocked:
                    status.update(status="blocked", isFullInventory=False)
                self.make_assets(assets, dataset, status)
                access_path = assets / "source-access-status.json"
                original = ('{  "status": "' + ('blocked' if blocked else 'available') + '",\n'
                            + '"networkCollectionAllowed": ' + ('false' if blocked else 'true') + ', "evidence": "unchanged fixture" }\n').encode()
                access_path.write_bytes(original)
                with mock.patch("sys.argv", ["build_inventory_registry.py", "--assets", str(assets)]), contextlib.redirect_stdout(io.StringIO()):
                    registry.main()
                self.assertEqual(access_path.read_bytes(), original)
                output = json.loads((assets / "inventory-registry.json").read_text())
                self.assertEqual(output["isFullInventory"], not blocked)
                self.assertEqual(output["knownTotal"], None if blocked else 14)

    def test_main_does_not_invent_missing_access_record(self):
        with tempfile.TemporaryDirectory() as folder:
            assets = Path(folder)
            dataset, status = complete_fixture()
            self.make_assets(assets, dataset, status)
            with mock.patch("sys.argv", ["build_inventory_registry.py", "--assets", str(assets)]), contextlib.redirect_stdout(io.StringIO()):
                registry.main()
            self.assertFalse((assets / "source-access-status.json").exists())


if __name__ == "__main__":
    unittest.main()
