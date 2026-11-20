"""Offline checks for the Beijing walkthrough catalogue. Python 3 standard library."""
import argparse
import hashlib
import json
import math
import re
import struct
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ASSETS = Path(__file__).resolve().parents[1] / "assets"
REFERENCES = ASSETS / "plan-references"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def check(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def jpeg_size(data):
    """Read the dimensions from a JPEG start-of-frame segment."""
    check(data[:2] == b"\xff\xd8", "invalid JPEG signature")
    pos = 2
    while pos + 4 <= len(data) and data[pos] == 0xff:
        if data[pos + 1] == 0xff:
            pos += 1
            continue
        marker = data[pos + 1]
        length = int.from_bytes(data[pos + 2:pos + 4], "big")
        check(length >= 2, "invalid JPEG segment length")
        if marker in (0xc0, 0xc1, 0xc2):
            height, width = struct.unpack_from(">HH", data, pos + 5)
            return width, height
        pos += 2 + length
    raise ValueError("JPEG dimensions unavailable")


def check_jpeg(path, expected_hash, dimensions):
    data = path.read_bytes()
    check(digest(data) == expected_hash, f"{path.name} SHA-256 mismatch")
    check(jpeg_size(data) == tuple(dimensions), f"{path.name} dimension mismatch")


def is_public_image(url):
    parsed = urlsplit(url)
    return parsed.scheme == "https" and (parsed.hostname or "").endswith(".ziroom.com")


def wall_distance(point, start, end):
    dx, dy = end[0] - start[0], end[1] - start[1]
    x, y = point[0] - start[0], point[1] - start[1]
    length_sq = dx * dx + dy * dy
    fraction = min(1, max(0, (dx * x + dy * y) / length_sq)) if length_sq else 0
    return math.hypot(x - fraction * dx, y - fraction * dy)


def check_geometry(plan, record):
    corners = plan["outline"]
    edges = list(zip(corners, corners[1:] + corners[:1]))
    pixel_area = abs(sum(x * v - y * u for (x, y), (u, v) in edges)) / 2
    scale = math.sqrt(plan["area"] / pixel_area)
    anchors = plan["anchors"]
    names = [a["room"] for a in anchors]
    check(len(names) == record["roomCount"] and names == record["rooms"], "room list mismatch")
    check(len({tuple(a["entry"]) for a in anchors}) == len(names), "duplicate room entry point")
    for fixture in plan["fixtures"]:
        x1, y1, x2, y2 = fixture["bounds"]
        check(0 <= x1 < x2 < plan["width"] and 0 <= y1 < y2 < plan["height"], "fixture bounds")
        check(fixture["room"] in names, "fixture without a matching room")
    for anchor in anchors:
        x, y = anchor["entry"]
        crossings = sum((ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax
                        for (ax, ay), (bx, by) in edges)
        room = anchor["room"]
        check(crossings % 2 == 1, f"{room} entry is outside the plan")
        distances = [wall_distance((x, y), a, b) for a, b in edges]
        distances.extend(wall_distance((x, y), s[:2], s[2:4]) - (s[4] if len(s) > 4 else 4) / 2
                         for s in plan["segments"])
        for fixture in plan["fixtures"]:
            x1, y1, x2, y2 = fixture["bounds"]
            distances.append(math.hypot(max(x1 - x, 0, x - x2), max(y1 - y, 0, y - y2)))
        check(min(distances) * scale >= 0.17, f"{room} entry lacks model camera clearance")


def check_listing(plan, record, facts, map_row, cache):
    listing = plan["id"]
    check(plan["sourceUrl"] == record["sourceUrl"] == facts["sourceUrl"] == map_row["sourceUrl"]
          == f"https://www.ziroom.com/x/{listing}.html", "official listing URL mismatch")
    check(plan["layout"] == record["layout"] == facts["layout"], "layout mismatch")
    check(record["houseCode"] and record["houseCode"] == facts["houseCode"], "house code mismatch")
    check(plan["name"] == map_row["name"] == record["name"], "community mismatch")
    check(plan["area"] == record["area"] and record["areaLabel"] == "建筑面积", "area mismatch")
    check(plan["originalUrl"] == map_row["publicFloorplanUrl"] == record["planUrl"]
          and is_public_image(record["planUrl"]), "official plan URL mismatch")
    check(record["detailHttpStatus"] == 200 and map_row["publicDetailVerified"], "detail status")
    check(plan["imageSha256"] == record["planSha256"] and plan["width"] == record["sourceWidth"]
          and plan["height"] == record["sourceHeight"], "plan metadata mismatch")
    check_jpeg(REFERENCES / plan["image"], record["planSha256"], (plan["width"], plan["height"]))
    vr = record["vr"]
    params = parse_qs(urlsplit(vr["url"]).query)
    check(vr["url"] == map_row["publicVrUrl"] and set(params.get("inv_no", [])) == {listing}
          and vr["listingId"] == listing and plan["name"] in vr["title"]
          and vr["responseStatus"] == 200 and vr["panoramaViewpointsPresent"], "VR source mismatch")
    check_geometry(plan, record)

    if cache:
        for suffix, expected in (("detail", record["detailSha256"]), ("image", record["planSha256"]),
                                 ("vr", vr["sourceSha256"])):
            check(digest((cache / f"{listing}.{suffix}").read_bytes()) == expected, f"{suffix} snapshot")
    gallery = record["publicPhotoUrls"]
    check(all(is_public_image(url) for url in gallery) and len(gallery) == len(set(gallery)),
          "invalid gallery URLs")
    for photo in record["photos"]:
        filename = photo["thumbnail"]
        check(re.fullmatch(rf"photos/{listing}-\d+\.jpg", filename), "thumbnail listing mismatch")
        check(photo["room"] and photo["area"] > 0 and photo["url"] in gallery, "photo category or source")
        check(re.fullmatch("[a-f0-9]{64}", photo["sourceSha256"]) and
              min(photo["sourceWidth"], photo["sourceHeight"]) > 0, "source photo metadata")
        check_jpeg(REFERENCES / filename, photo["thumbnailSha256"],
                   (photo["thumbnailWidth"], photo["thumbnailHeight"]))
        if cache:
            original = cache / (Path(filename).name + ".original")
            check(digest(original.read_bytes()) == photo["sourceSha256"], f"{filename} source image")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-cache", type=Path,
                        help="also compare retained .detail, .image, .vr and .jpg.original snapshots")
    args = parser.parse_args()
    plans = read_json(REFERENCES / "index.json")["plans"]
    records = read_json(REFERENCES / "room-verification.json")["properties"]
    facts = {r["id"]: r for r in read_json(ASSETS / "beijing-listing-facts.json")["properties"]}
    mapped = {r["id"]: r for r in read_json(ASSETS / "beijing-community-map.json")["properties"]}
    by_id = {r["id"]: r for r in records}
    ids = {p["id"] for p in plans}
    check(ids == set(by_id) and len(ids) == len(plans) == len(records) == 20, "catalogue ID mismatch")
    check(len({r["planSha256"] for r in records}) == len(ids), "reused floor plan")
    all_photos = [photo for r in records for photo in r["photos"]]
    check(len({p["sourceSha256"] for p in all_photos}) == len(all_photos), "reused source photo")
    for plan in plans:
        listing = plan["id"]
        try:
            check_listing(plan, by_id[listing], facts[listing], mapped[listing], args.source_cache)
        except (ValueError, KeyError, OSError) as exc:
            raise SystemExit(f"{listing} {plan['name']}: {exc}") from exc
    count = sum(p["roomCount"] for p in records)
    fixtures = sum(len(p["fixtures"]) for p in plans)
    print(f"通过 {len(plans)} 套、{count} 个相机点、{fixtures} 项户型图家具参照和 {len(all_photos)} 张实拍缩略图。")


if __name__ == "__main__":
    main()
