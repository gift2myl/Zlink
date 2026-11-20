#!/usr/bin/env python3
"""Offline, synthetic regression tests. No Ziroom or other network requests.

Run with the existing parser environment:
    python -B ops/tools/test_access_diagnostics.py

Fixtures are invented, kept in temporary directories, and never enter inventory.
Historical source-access evidence is neither reclassified nor modified.
"""
from __future__ import annotations

import ast
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock
import urllib.error


MODULE_PATH = Path(__file__).with_name("collect_ziroom_lingzhi.py")
SPEC = importlib.util.spec_from_file_location("access_diagnostics_collector", MODULE_PATH)
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)

LISTING = '<a href="https://www.ziroom.com/x/123456789.html">合成测试房源</a>'
PAIRED_SCRIPT = '<html><head></head><body><script>var EO_Bot_Ssid="fixture";var __tst_status=1;</script></body></html>'


class ResponseClassificationTests(unittest.TestCase):
    def inspect(self, body, status=200, headers=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        return collector.inspect_response(status, body, collector.DEFAULT_URL, headers or {})

    def test_three_previously_false_positive_pages_still_stop_for_review(self):
        fixtures = {
            "footer": LISTING + "<footer>手机验证码登录</footer>",
            "script_name": LISTING + '<script src="/static/captcha-widget.js"></script>',
            "json_field": LISTING + '<script type="application/json">{"securityLibraryKey":"EO_Bot_Ssid"}</script>',
        }
        for name, body in fixtures.items():
            with self.subTest(name=name):
                evidence, reason, message = self.inspect(body)
                self.assertEqual(reason, "challenge_signals_require_review")
                self.assertEqual(evidence["diagnosticReason"], "ambiguous_challenge_signals")
                self.assertEqual(evidence["confidence"], "low")
                self.assertEqual(evidence["signals"]["listingDetailLinkCount"], 1)
                self.assertTrue(message)

    def test_small_paired_script_is_a_challenge_without_vendor_or_rule_inference(self):
        evidence, reason, _ = self.inspect(PAIRED_SCRIPT)
        self.assertEqual(reason, "challenge_page")
        self.assertEqual(evidence["diagnosticReason"], "small_script_challenge_response")
        self.assertEqual(evidence["confidence"], "high")
        self.assertIn("paired_challenge_markers", evidence["classificationBasis"])
        self.assertEqual(evidence["signals"]["listingDetailLinkCount"], 0)
        self.assertNotIn("provider", evidence)
        self.assertNotIn("ruleId", evidence)
        self.assertNotIn("ipBlocked", evidence)

    def test_pair_alone_in_json_or_with_listing_links_remains_ambiguous(self):
        for body in (
            '{"libraries":["EO_Bot_Ssid","__tst_status"]}',
            LISTING + PAIRED_SCRIPT,
            "EO_Bot_Ssid __tst_status",
        ):
            with self.subTest(body_type=body[:1]):
                _, reason, _ = self.inspect(body)
                self.assertEqual(reason, "challenge_signals_require_review")

    def test_clear_current_verification_prompt(self):
        evidence, reason, _ = self.inspect("<html><title>安全验证</title><body>请完成人机验证后继续访问</body></html>")
        self.assertEqual(reason, "challenge_page")
        self.assertEqual(evidence["diagnosticReason"], "explicit_current_verification")

    def test_verification_text_inside_script_is_not_visible_prompt(self):
        evidence, reason, _ = self.inspect('<html><body><script>const message="verify you are human";</script></body></html>')
        self.assertEqual(reason, "challenge_signals_require_review")
        self.assertFalse(evidence["signals"]["explicitVerificationPrompt"])

    def test_normal_login_page_with_sms_code_is_login_required(self):
        evidence, reason, _ = self.inspect('<html><title>自如登录</title><form action="/login"><label>手机验证码</label><input name="sms"><button>登录</button></form></html>')
        self.assertEqual(reason, "login_required")
        self.assertEqual(evidence["diagnosticReason"], "login_page_structure")

    def test_http_statuses_take_precedence_over_marker_words(self):
        for code, expected in ((401, "auth_required"), (403, "access_denied"), (429, "rate_limited")):
            with self.subTest(status=code):
                evidence, reason, _ = self.inspect(PAIRED_SCRIPT, code)
                self.assertEqual(reason, expected)
                self.assertEqual(evidence["diagnosticReason"], "http_" + str(code))
                self.assertEqual(evidence["classificationBasis"], ["http_" + str(code)])
                self.assertEqual(evidence["legacyReason"], "access_restricted")

    def test_redirect_remains_stopped_and_retains_only_destination_path(self):
        for code in (301, 302, 303, 307, 308):
            with self.subTest(status=code):
                evidence, reason, _ = self.inspect("captcha", code, {
                    "Location": "https://www.ziroom.com/login?token=DO_NOT_LOG_QUERY#private_fragment",
                })
                self.assertEqual(reason, "redirect_requires_review")
                self.assertEqual(evidence["safeResponseHeaders"], {"location": "/login"})
                self.assertNotIn("DO_NOT_LOG", json.dumps(evidence))

    def test_normal_json_is_not_treated_as_verified_inventory(self):
        evidence, reason, _ = self.inspect('{"data":[{"id":"123456789","name":"合成测试房源"}]}', headers={"Content-Type": "application/json; charset=utf-8"})
        self.assertIsNone(reason)
        self.assertEqual(evidence["classification"], "no_access_block_observed")
        self.assertEqual(evidence["signals"]["bodyFormat"], "json")
        self.assertNotIn("isFullInventory", evidence)
        self.assertNotIn("filterVerified", evidence)

    def test_captcha_json_key_is_only_review_signal(self):
        _, reason, _ = self.inspect('{"captchaEnabled":false,"data":[]}')
        self.assertEqual(reason, "challenge_signals_require_review")

    def test_clean_html_empty_body_and_http_error(self):
        self.assertIsNone(self.inspect(LISTING)[1])
        self.assertEqual(self.inspect(b"")[1], "empty_response")
        self.assertEqual(self.inspect("maintenance", 503)[1], "http_error")

    def test_headers_are_allowlisted_and_credentials_and_body_are_not_logged(self):
        headers = {
            "Content-Type": "text/html; charset=utf-8; token=DO_NOT_LOG_MIME",
            "Server": "nginx/1.25.0",
            "Date": "Fri, 20 Nov 2026 02:55:06 GMT",
            "Retry-After": "120",
            "Location": "https://user:DO_NOT_LOG_USER@www.ziroom.com/map?session=DO_NOT_LOG_QUERY#DO_NOT_LOG_FRAGMENT",
            "X-Request-ID": "req-8d9fa1",
            "EO-LOG-UUID": "ab7d72e1-8cf3-42fb-881b-305b1c89d5ac",
            "X-CDN-Request-ID": "cdn-7bc84a",
            "X-Correlation-ID": "corr-510a",
            "Set-Cookie": "private=DO_NOT_LOG_COOKIE; HttpOnly",
            "Cookie": "private=DO_NOT_LOG_COOKIE",
            "Authorization": "Bearer DO_NOT_LOG_AUTH",
            "X-Auth-Token": "DO_NOT_LOG_TOKEN",
            "X-Unknown-Debug": "DO_NOT_LOG_DEBUG",
        }
        body = '<html><title>authorization=DO_NOT_LOG_TITLE</title><body>DO_NOT_LOG_BODY<script>const token="DO_NOT_LOG_SCRIPT";</script></body></html>'
        evidence, _, _ = self.inspect(body, headers=headers)
        saved = evidence["safeResponseHeaders"]
        self.assertEqual(saved["content-type"], "text/html")
        self.assertEqual(saved["location"], "/map")
        self.assertEqual(saved["eo-log-uuid"], headers["EO-LOG-UUID"])
        self.assertEqual(saved["retry-after"], "120")
        self.assertIsNone(evidence["title"])
        self.assertTrue(set(saved).issubset(collector.SAFE_RESPONSE_HEADERS))
        self.assertNotIn("DO_NOT_LOG", json.dumps(evidence))
        self.assertNotIn("rawBody", evidence)

    def test_credential_values_in_mislabeled_headers_and_paths_are_dropped(self):
        for name, value in {
            "X-Request-ID": "Bearer DO_NOT_LOG_ID",
            "EO-LOG-UUID": "token-DO_NOT_LOG_UUID",
            "X-CDN-Request-ID": "eyJhbGci.eyJzdWI.signature",
            "Server": "nginx; password=DO_NOT_LOG_SERVER",
            "Retry-After": "DO_NOT_LOG_RETRY",
            "Date": "DO_NOT_LOG_DATE",
            "Location": "/session/DO_NOT_LOG_PATH",
        }.items():
            with self.subTest(header=name):
                self.assertEqual(collector.safe_response_headers({name: value}), {})
        self.assertEqual(collector.safe_response_headers({"Location": "/%74oken/DO_NOT_LOG_PATH?x=1"}), {})
        self.assertEqual(collector.safe_response_headers({"X-Request-ID": "safe\r\nCookie: DO_NOT_LOG_INJECTION"}), {})

    def test_location_retains_only_fixed_public_paths(self):
        for location in (
            "https://example.invalid/verify/AbCdEfGhIjKlMnOpQrStUv?ref=public",
            "https://www.ziroom.com/help/about?ref=public",
            "/listings",
        ):
            with self.subTest(location_kind="unlisted_path"):
                self.assertEqual(collector.safe_response_headers({"Location": location}), {})
        for path in ("/", "/map", "/login", "/signin"):
            with self.subTest(public_path=path):
                self.assertEqual(collector.safe_response_headers({
                    "Location": "https://www.ziroom.com" + path + "?token=DO_NOT_LOG_QUERY",
                }), {"location": path})


class OfflineExecutionTests(unittest.TestCase):
    def run_main(self, argv):
        with mock.patch.object(sys, "argv", [str(MODULE_PATH), *argv]), contextlib.redirect_stdout(io.StringIO()):
            return collector.main()

    def test_offline_commands_do_not_construct_transport_or_import_fetcher(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            for mode, data in (
                ("adapt-json", {"data": [{"id": "123456789", "name": "合成测试房源"}]}),
                ("adapt-html", '<article class="listing" data-id="123456789"><h2>合成测试房源</h2></article>'),
                ("inspect-html", LISTING),
            ):
                with self.subTest(mode=mode):
                    folder = base / mode
                    folder.mkdir()
                    source = folder / "fixture.txt"
                    source.write_text(json.dumps(data, ensure_ascii=False) if isinstance(data, dict) else data, encoding="utf-8")
                    args = ["--assets", str(folder), "--transport", "native", mode, "--input", str(source)]
                    if mode == "inspect-html":
                        output = folder / "references.json"
                        args += ["--source-url", collector.DEFAULT_URL, "--output", str(output)]
                    else:
                        fmt = "json" if mode == "adapt-json" else "html"
                        extraction = {"verified": True, "format": fmt}
                        extraction.update({"recordPath": "data", "fields": {"id": "id", "name": "name"}}
                                          if fmt == "json" else
                                          {"recordCss": ".listing", "fields": {"id": "::attr(data-id)", "name": "h2::text"}})
                        config = folder / "config.json"
                        config.write_text(json.dumps({"cityCode": "110000", "startUrl": collector.DEFAULT_URL,
                            "filter": {"name": "灵之智能", "verified": True, "evidence": "synthetic offline fixture only"},
                            "extraction": extraction}), encoding="utf-8")
                        args += ["--config", str(config)]
                        output = folder / "crawl-status.json"
                    with mock.patch.object(collector, "PublicHttp", side_effect=AssertionError("transport must not be constructed")) as transport, \
                         mock.patch.object(collector, "native_fetcher_state", side_effect=AssertionError("Fetcher must not be imported")) as fetcher:
                        self.run_main(args)
                        transport.assert_not_called()
                        fetcher.assert_not_called()
                    result = json.loads(output.read_text())
                    if mode == "inspect-html":
                        self.assertEqual(result["networkRequests"], 0)
                        self.assertEqual(len(result["listingLinks"]), 1)
                    else:
                        self.assertEqual(result["engine"]["transport"], "offline")
                        self.assertFalse(result["engine"]["fetcherChecked"])
                        self.assertEqual(result["requestsAttempted"], 0)
                        self.assertEqual(result["uniqueCount"], 1)

    def test_source_stop_guard_runs_before_transport_and_changes_no_files(self):
        with tempfile.TemporaryDirectory() as directory:
            assets = Path(directory)
            stop = assets / "source-access-status.json"
            stop.write_text(json.dumps({"status": "blocked", "networkCollectionAllowed": False,
                                       "latestAttempt": {"checkedAt": "synthetic-history"}}), encoding="utf-8")
            before = stop.read_bytes()
            for mode in ("probe", "collect"):
                with self.subTest(mode=mode):
                    args = ["--assets", directory, mode]
                    if mode == "collect":
                        args += ["--config", str(assets / "must-not-read.json")]
                    with mock.patch.object(collector, "PublicHttp", side_effect=AssertionError("guard must precede transport")) as transport:
                        self.assertEqual(self.run_main(args), 2)
                        transport.assert_not_called()
                    self.assertEqual(stop.read_bytes(), before)
                    self.assertEqual(list(assets.iterdir()), [stop])

    def test_original_network_policy_functions_and_identity_unchanged(self):
        # Baseline hashes cover the pre-fix URL policy, complete transport, and stop guard.
        expected = {
            "safe_url": "715543cf91e0f7fd1b1f8548065ec6b2ea7ee9f2dc27021d112bc6a6e1b9f10c",
            "PublicHttp": "0c5283d9680c187bf971f9393fb72ecedae195072011f6eecd37af2899fbc911",
            "known_source_block": "5bbecc0b5ada44dfdb1fa59a858a024095fa5c70a87412106db281a45d54aadd",
        }
        source = MODULE_PATH.read_text(encoding="utf-8")
        found = {}
        for node in ast.parse(source).body:
            if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in expected:
                found[node.name] = hashlib.sha256(ast.get_source_segment(source, node).encode()).hexdigest()
        self.assertEqual(found, expected)
        self.assertEqual(collector.UA, "LingzhiPublicInventory/1.0")

    def test_probe_errors_are_categorized_without_raw_exception_messages(self):
        args = SimpleNamespace(url=collector.DEFAULT_URL, assets=Path("never-written"))
        cases = (
            (ValueError("Response exceeds the 8 MiB public-listing limit."), "response_too_large"),
            (urllib.error.URLError("DO_NOT_LOG_TRANSPORT"), "http_transport_error"),
            (TimeoutError("DO_NOT_LOG_TIMEOUT"), "http_transport_error"),
        )
        for exception, expected in cases:
            with self.subTest(reason=expected):
                http = SimpleNamespace(engine=collector.OfflineParserContext().engine, get=mock.Mock(side_effect=exception))
                with mock.patch.object(collector, "finish", side_effect=lambda status, rows, assets: status):
                    result = collector.run_probe(http, args)
                self.assertEqual(result["reason"], expected)
                self.assertNotIn("DO_NOT_LOG", json.dumps(result))
                self.assertEqual(http.get.call_count, 1)
                self.assertEqual(result["requestsAttempted"], 1)
        http = SimpleNamespace(engine=collector.OfflineParserContext().engine,
                               get=mock.Mock(return_value=(200, b"<html></html>", collector.DEFAULT_URL, {})))
        with mock.patch.object(collector, "inspect_response", side_effect=ValueError("DO_NOT_LOG_PARSE")), \
             mock.patch.object(collector, "finish", side_effect=lambda status, rows, assets: status):
            result = collector.run_probe(http, args)
        self.assertEqual(result["reason"], "response_parse_error")
        self.assertNotIn("DO_NOT_LOG", json.dumps(result))
        self.assertEqual(http.get.call_count, 1)
        self.assertEqual(result["requestsAttempted"], 1)

    def test_probe_normal_response_counts_one_request(self):
        http = SimpleNamespace(engine=collector.OfflineParserContext().engine,
                               get=mock.Mock(return_value=(200, LISTING.encode("utf-8"), collector.DEFAULT_URL, {})))
        args = SimpleNamespace(url=collector.DEFAULT_URL, assets=Path("never-written"))
        with mock.patch.object(collector, "finish", side_effect=lambda status, rows, assets: status):
            result = collector.run_probe(http, args)
        self.assertEqual(result["reason"], "filter_unverified")
        self.assertEqual(result["requestsAttempted"], 1)
        self.assertEqual(result["pages"][0]["attempt"], 1)
        self.assertEqual(http.get.call_count, 1)

    def test_probe_wrong_url_is_configuration_error_before_any_get(self):
        http = SimpleNamespace(engine=collector.OfflineParserContext().engine, get=mock.Mock(side_effect=AssertionError("must not get")))
        args = SimpleNamespace(url="https://www.ziroom.com/", assets=Path("never-written"))
        with mock.patch.object(collector, "finish", side_effect=lambda status, rows, assets: status):
            result = collector.run_probe(http, args)
        self.assertEqual(result["reason"], "configuration_error")
        self.assertEqual(result["requestsAttempted"], 0)
        http.get.assert_not_called()


if __name__ == "__main__":
    # A global tripwire makes an accidental real network call fail this offline suite.
    with mock.patch("socket.socket.connect", side_effect=AssertionError("network is forbidden in offline tests")), \
         mock.patch("socket.create_connection", side_effect=AssertionError("network is forbidden in offline tests")):
        unittest.main(verbosity=2)
