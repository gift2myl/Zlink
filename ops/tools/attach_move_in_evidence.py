"""Attach the official 可入住日期 to previously verified source snapshots, without network access."""
import argparse
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path


CONFIG = re.compile(r'\bvar\s+ZRCONFIG\s*=\s*({[^;<]*?});')
LABEL = re.compile(r'<span\s+class="info_label">\s*可入住日期\s*</span>')
VALUE = re.compile(LABEL.pattern + r'\s*<span\s+class="info_value">([^<]*)</span>')


def move_in_label(fact, raw):
    listing_id = fact['id']
    checked_at = datetime.fromisoformat(fact['detailCheckedAt'])
    if (not checked_at.tzinfo or not re.fullmatch(r'\d+', listing_id)
            or fact['sourceUrl'] != f'https://www.ziroom.com/x/{listing_id}.html'
            or hashlib.sha256(raw).hexdigest() != fact['detailSha256']):
        raise ValueError(f'{listing_id}: invalid source URL, timestamp or digest')
    page = raw.decode('utf-8')
    match = CONFIG.search(page)
    config = json.loads(match[1]) if match else {}
    if (config.get('invNo') != listing_id or config.get('city_code') != '110000'
            or not fact.get('houseCode') or config.get('house_code') != fact['houseCode']):
        raise ValueError(f'{listing_id}: source identity does not match')
    values = VALUE.findall(page)
    if len(values) != len(LABEL.findall(page)) or len(values) > 1:
        raise ValueError(f'{listing_id}: unexpected 可入住日期 markup')
    return values[0].strip() if values else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('detail_directory', type=Path, help='Directory of verified <listing ID>.html files')
    parser.add_argument('--facts', type=Path, default=Path(__file__).resolve().parents[1] / 'assets/beijing-listing-facts.json')
    args = parser.parse_args()
    data = json.loads(args.facts.read_text(encoding='utf-8'))
    properties = data.pop('properties')
    for row in properties:
        row['officialMoveInLabel'] = move_in_label(row, (args.detail_directory / (row['id'] + '.html')).read_bytes())
    # Preserve the repository's one-listing-per-line format. Validate all sources before replacing the file.
    header = json.dumps(data, ensure_ascii=False, indent=2)[:-2]
    body = ',\n'.join(json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in properties)
    args.facts.write_text(header + ',\n  "properties":[\n' + body + '\n  ]\n}\n', encoding='utf-8')


if __name__ == '__main__':
    main()
