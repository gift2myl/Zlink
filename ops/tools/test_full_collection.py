#!/usr/bin/env python3
"""Offline full-inventory regressions using synthetic HTML and real Scrapling.

No fixture describes a real listing or a verified production selector. All HTTP
responses come from an in-memory fake. All written files live in TemporaryDirectory;
the production assets, source stop record and live website are never touched.

Run with the existing Scrapling environment:
    python -B ops/tools/test_full_collection.py
"""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock
from build_inventory_registry import build_registry


MODULE_PATH = Path(__file__).with_name("collect_ziroom_lingzhi.py")
SPEC = importlib.util.spec_from_file_location("full_collection_collector", MODULE_PATH)
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)

BASE_URL = collector.DEFAULT_URL
FIXTURE_EVIDENCE = "SYNTHETIC OFFLINE FIXTURE ONLY — not official source evidence"


def page_url(number):
    return BASE_URL if number == 1 else BASE_URL + "&fixture_page=" + str(number)


def source_id(number):
    return str(99000000 + number)


def html_page(numbers, next_number=None):
    """Invented layout deliberately distinct from any asserted Ziroom DOM."""
    rows = []
    for number in numbers:
        identifier = source_id(number)
        rows.append(
            '<article class="fixture-listing">'
            '<span class="fixture-id">' + identifier + '</span>'
            '<span class="fixture-name">合成测试小区 ' + str(number) + '（非真实房源）</span>'
            '<span class="fixture-product">灵之智能 · 离线合成测试</span>'
            '<span class="fixture-bedrooms">2</span>'
            '<span class="fixture-area">60</span>'
            '<a href="https://www.ziroom.com/x/' + identifier + '.html">合成详情引用，不访问</a>'
            '</article>'
        )
    pager = ('<a class="fixture-next" href="' + page_url(next_number) + '">合成下一页</a>'
             if next_number is not None else '<p class="fixture-end">合成末页</p>')
    return ('<!doctype html><html><head><title>离线合成测试列表</title></head>'
            '<body>' + ''.join(rows) + pager + '</body></html>').encode("utf-8")


def verified_fixture_config(expected_total):
    return {
        "schemaVersion": 1,
        "cityCode": "110000",
        "startUrl": BASE_URL,
        "filter": {
            "name": "灵之智能", "verified": True,
            "evidence": FIXTURE_EVIDENCE,
            "requiredQuery": {"city_code": "110000"},
        },
        "pagination": {
            "verified": True, "evidence": FIXTURE_EVIDENCE,
            "mode": "next_link", "nextCss": "a.fixture-next::attr(href)",
            "maxPages": 50,
        },
        "extraction": {
            "verified": True, "format": "html", "recordCss": ".fixture-listing",
            "fields": {
                "id": ".fixture-id::text", "name": ".fixture-name::text",
                "product": ".fixture-product::text", "bedrooms": ".fixture-bedrooms::text",
                "area": ".fixture-area::text", "sourceUrl": "a::attr(href)",
            },
        },
        "coverage": {
            "expectedTotal": expected_total, "totalEvidence": FIXTURE_EVIDENCE,
            "citywideVerified": True, "citywideEvidence": FIXTURE_EVIDENCE,
            "viewportLimited": False,
        },
        "delaySeconds": 2,
    }


class MemoryHttp:
    """Only returns provided bytes; an unconfigured URL fails the test."""

    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    @property
    def engine(self):
        return {
            **collector.OfflineParserContext().engine,
            "transport": "synthetic-memory",
        }

    def get(self, url):
        self.calls.append(url)
        if url not in self.pages:
            raise AssertionError("Unexpected synthetic page request: " + url)
        body = self.pages[url]
        return 200, body, url, {"Content-Type": "text/html; charset=utf-8"}


class FullCollectionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="zlink-synthetic-full-collection-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.assets = self.root / "assets"
        self.assets.mkdir()
        self.config_path = self.root / "fixture-config.json"
        self.stdout = io.StringIO()

    def run_fixture(self, pages, config, previous=None):
        self.config_path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
        if previous is not None:
            (self.assets / "crawled-properties.json").write_text(
                json.dumps(previous, ensure_ascii=False), encoding="utf-8")
        http = MemoryHttp(pages)
        args = SimpleNamespace(config=self.config_path, assets=self.assets)
        # Fail closed if future collector edits accidentally invoke real transport.
        with (mock.patch.object(collector.time, "sleep"),
              mock.patch.object(collector.PublicHttp, "get", side_effect=AssertionError("Real HTTP forbidden in offline test")),
              mock.patch("urllib.request.OpenerDirector.open", side_effect=AssertionError("Network forbidden in offline test")),
              mock.patch("urllib.request.urlopen", side_effect=AssertionError("Network forbidden in offline test")),
              mock.patch("socket.create_connection", side_effect=AssertionError("Network forbidden in offline test")),
              contextlib.redirect_stdout(self.stdout)):
            code = collector.run_collect(http, args)
        status = collector.read_json(self.assets / "crawl-status.json")
        dataset = collector.read_json(self.assets / "crawled-properties.json")
        return code, status, dataset, http.calls

    def standard_pages(self):
        return {
            page_url(1): html_page(range(1, 11), 2),
            page_url(2): html_page(range(11, 21), 3),
            page_url(3): html_page(range(21, 26)),
        }

    def test_twenty_five_records_across_three_scrapling_pages_are_complete(self):
        code, status, dataset, calls = self.run_fixture(self.standard_pages(), verified_fixture_config(25))
        self.assertEqual(code, 0)
        self.assertEqual(status["status"], "complete")
        self.assertTrue(status["isFullInventory"])
        self.assertTrue(status["paginationComplete"])
        self.assertEqual(status["uniqueCount"], 25)
        self.assertEqual(status["pagesFetched"], 3)
        self.assertEqual(calls, [page_url(1), page_url(2), page_url(3)])
        self.assertEqual(len(dataset["properties"]), 25)
        self.assertTrue(all(row["lingzhiFilterReturned"] for row in dataset["properties"]))
        self.assertTrue(all(collector.real_listing_id(row) for row in dataset["properties"]))
        self.assertTrue(all(not row["modelReady"] for row in dataset["properties"]))
        self.assertEqual(dataset["source"]["latestRunId"], status["runId"])
        self.assertEqual(dataset["source"]["latestRunFinishedAt"], status["finishedAt"])
        self.assertTrue(dataset["source"]["latestRunIsFullInventory"])
        self.assertTrue(dataset["source"]["paginationComplete"])
        self.assertEqual(len(dataset["source"]["latestRunPropertyKeys"]), 25)
        self.assertEqual(status["coverage"]["expectedTotal"], 25)
        self.assertEqual(dataset["source"]["coverageEvidence"], status["coverage"])
        self.assertEqual(status["filterEvidence"], FIXTURE_EVIDENCE)
        self.assertEqual(status["paginationEvidence"], FIXTURE_EVIDENCE)
        self.assertEqual([len(page["recordKeys"]) for page in status["pages"]], [10, 10, 5])
        self.assertTrue(all(page["rejectedRecords"] == 0 for page in status["pages"]))

    def test_overlapping_pages_deduplicate_by_source_identity(self):
        pages = {
            page_url(1): html_page(range(1, 13), 2),
            page_url(2): html_page(range(10, 22), 3),
            page_url(3): html_page(range(20, 26)),
        }
        code, status, dataset, calls = self.run_fixture(pages, verified_fixture_config(25))
        self.assertEqual(code, 0)
        self.assertEqual(status["uniqueCount"], 25)
        self.assertEqual(len(dataset["properties"]), 25)
        self.assertEqual(len({collector.record_key(row) for row in dataset["properties"]}), 25)
        self.assertEqual(len(calls), 3)

    def test_registry_accepts_actual_collector_provenance_without_changing_access(self):
        code, status, dataset, _ = self.run_fixture(self.standard_pages(), verified_fixture_config(25))
        self.assertEqual(code, 0)
        for filename in ("properties.json", "property-geography.json", "listing-inventory.json", "three-source-coverage.json"):
            (self.assets / filename).write_text('{"properties":[]}', encoding="utf-8")
        stop = b'{"status":"blocked","networkCollectionAllowed":false}'
        stop_path = self.assets / "source-access-status.json"
        stop_path.write_bytes(stop)
        registry, access = build_registry(self.assets)
        self.assertEqual(registry["currentSnapshot"]["validationIssues"], [])
        self.assertTrue(registry["isFullInventory"])
        self.assertEqual(registry["knownTotal"], 25)
        self.assertEqual(registry["currentSnapshot"]["propertyKeys"], dataset["source"]["latestRunPropertyKeys"])
        self.assertEqual(registry["currentSnapshot"]["runId"], status["runId"])
        self.assertEqual(stop_path.read_bytes(), stop)
        self.assertFalse(access["networkCollectionAllowed"])

    def test_reaching_total_does_not_skip_a_real_next_page(self):
        pages = {
            page_url(1): html_page(range(1, 12), 2),
            page_url(2): html_page([12]),
        }
        code, status, dataset, calls = self.run_fixture(pages, verified_fixture_config(11))
        self.assertEqual(calls, [page_url(1), page_url(2)])
        self.assertEqual(status["uniqueCount"], 12)
        self.assertEqual(len(dataset["properties"]), 12)
        self.assertEqual(code, 3)
        self.assertEqual(status["status"], "partial")
        self.assertFalse(status["isFullInventory"])

    def test_total_can_match_before_last_page_but_terminal_must_be_read(self):
        pages = {
            page_url(1): html_page(range(1, 12), 2),
            page_url(2): html_page([10, 11]),
        }
        code, status, dataset, calls = self.run_fixture(pages, verified_fixture_config(11))
        self.assertEqual(calls, [page_url(1), page_url(2)])
        self.assertEqual(code, 0)
        self.assertTrue(status["paginationComplete"])
        self.assertEqual(status["uniqueCount"], 11)
        self.assertEqual(len(dataset["properties"]), 11)

    def test_repeated_page_is_partial_and_does_not_continue(self):
        pages = {
            page_url(1): html_page(range(1, 11), 2),
            page_url(2): html_page(range(1, 11), 3),
            page_url(3): html_page(range(11, 26)),
        }
        code, status, dataset, calls = self.run_fixture(pages, verified_fixture_config(25))
        self.assertEqual(calls, [page_url(1), page_url(2)])
        self.assertEqual(code, 3)
        self.assertEqual(status["reason"], "pagination_repeats_content")
        self.assertFalse(status["isFullInventory"])
        self.assertFalse(status["paginationComplete"])
        self.assertEqual(status["uniqueCount"], 10)
        self.assertEqual(len(dataset["properties"]), 10)

    def test_exact_total_and_citywide_scope_are_both_required(self):
        cases = {
            "mismatched_total": {"expectedTotal": 27},
            "unknown_total": {"expectedTotal": None},
            "missing_total_evidence": {"totalEvidence": None},
            "unverified_citywide": {"citywideVerified": False},
            "viewport_limited": {"viewportLimited": True},
        }
        for name, changes in cases.items():
            with self.subTest(name=name):
                config = verified_fixture_config(25)
                config["coverage"].update(changes)
                code, status, dataset, calls = self.run_fixture(self.standard_pages(), config)
                self.assertEqual(code, 3)
                self.assertFalse(status["isFullInventory"])
                self.assertEqual(status["uniqueCount"], 25)
                self.assertEqual(len(dataset["properties"]), 25)
                self.assertEqual(len(calls), 3)

    def test_challenge_after_success_preserves_partial_and_older_records(self):
        old = {
            "id": "99999999", "realListingId": "99999999", "idType": "ziroom_property_id",
            "name": "合成旧记录（非真实房源）", "observedAt": "2026-01-01T10:00:00+08:00",
            "sourceUrl": "https://www.ziroom.com/x/99999999.html",
        }
        previous = {"schemaVersion": 1, "properties": [old], "source": {"isFullInventory": False}}
        challenge = b'<html><body><script>var EO_Bot_Ssid="fixture";var __tst_status=1;</script></body></html>'
        pages = {page_url(1): html_page(range(1, 16), 2), page_url(2): challenge}
        code, status, dataset, calls = self.run_fixture(pages, verified_fixture_config(25), previous=previous)
        self.assertEqual(code, 3)
        self.assertEqual(status["reason"], "challenge_page")
        self.assertEqual(status["uniqueCount"], 15)
        self.assertFalse(status["isFullInventory"])
        self.assertEqual(calls, [page_url(1), page_url(2)])
        self.assertEqual(len(dataset["properties"]), 16)
        retained = next(row for row in dataset["properties"] if row["id"] == old["id"])
        self.assertEqual(retained["currentAvailability"], "unknown")
        self.assertFalse(retained["seenInLatestRun"])
        self.assertEqual(len(dataset["source"]["latestRunPropertyKeys"]), 15)

    def test_page_limit_retains_data_without_full_claim(self):
        config = verified_fixture_config(25)
        config["pagination"]["maxPages"] = 1
        code, status, dataset, calls = self.run_fixture(self.standard_pages(), config)
        self.assertEqual(code, 3)
        self.assertEqual(status["reason"], "page_limit_reached")
        self.assertFalse(status["isFullInventory"])
        self.assertEqual(status["uniqueCount"], 10)
        self.assertEqual(calls, [page_url(1)])
        self.assertEqual(len(dataset["properties"]), 10)


if __name__ == "__main__":
    unittest.main(verbosity=2)
