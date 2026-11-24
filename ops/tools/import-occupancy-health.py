"""Build the local Beijing health snapshot from the supplied rental and occupancy workbooks."""
import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from openpyxl import load_workbook
from rental_community_locations import load_index, place_key

ASSETS = Path(__file__).resolve().parents[1] / 'assets'
LEVELS = ['健康房源', 'P1 局部功能异常', 'P2 房源异常', 'P3 经营风险', 'P4 安全隐患', '未归类']
HEALTH_TARGETS = {'心舍3.0': 90, '心舍2.0': 85, '曼舍2.0': 85}
METRICS = {
    'gateway': '网关在线率%', 'devices': '设备在线率%', 'events': '安全事件数(天,封顶7)',
    'deviceHours': '设备最长离线(h)', 'gatewayHours': '网关最长离线(h)', 'panelHours': '面屏最长离线(h)',
    'offline1': '离线1天设备数', 'offline2': '离线2天设备数', 'offline3': '离线≥3天设备数'
}
DISTRICT = re.compile(r'^(?:北京市?)?(东城|西城|朝阳|海淀|丰台|石景山|通州|顺义|昌平|大兴|房山|门头沟|密云|怀柔|平谷|延庆)')


def extract(path, codes, names, occupied, home_keys, places, directory):
    book = load_workbook(path, read_only=True, data_only=True)
    try:
        notes = {r[0]: str(r[1] or '') for r in book['说明'].values if len(r)>1 and r[0]}
        if occupied:
            valid_scope = '交付房源明细' in notes.get('已入住口径', '')
        else:
            status = notes.get('状态', '')
            valid_scope = '201' in status and '待租中' in status and '可立即入住' in status
        if not valid_scope:
            raise ValueError(f'{path.name} 的说明与指定入住状态不符')
        rows = iter(book['房源明细'].values)
        headers = next(rows)
        records = [(i, dict(zip(headers, r))) for i, r in enumerate(rows, 2) if any(r)]
        national = Counter(r['健康等级'] for _, r in records)
        distribution = {r[0]: r[1] for r in list(book['等级分布'].values)[1:]}
        if national != distribution:
            raise ValueError(f'{path.name} 逐行结果与等级分布不一致')
        beijing = [(i,r) for i,r in records if r['城市']=='北京']
        identities = Counter(str(r['房源编号']).strip().upper() for _,r in beijing)
        counts = Counter(r['健康等级'] for _,r in beijing)
        city_row = next(r for r in book['城市分布'].values if r[0]=='北京')
        totals = [counts[level] for level in LEVELS]
        if totals != list(city_row[1:7]) or sum(totals) != len(beijing):
            raise ValueError(f'{path.name} 北京明细与城市分布不一致')
        result = []
        for line, r in beijing:
            code = str(r['房源编号']).strip().upper()
            if not r['房源编号'] or not code:
                raise ValueError(f'{path.name} 有房源缺少编号，无法合并统计')
            home_key = home_keys.setdefault(code, len(home_keys) + 1)
            matches = codes.get(code, [])
            pid = matches[0] if len(matches)==1 and identities[code]==1 else None
            district = DISTRICT.match(r['房源地址'] or '')
            version = r['房源版本']
            family = r['房源类型'] if occupied else version
            label = ' · '.join(filter(None, [district[1] if district else None, family]))
            record = dict(row=line, level=LEVELS.index(r['健康等级']), name=names.get(pid) or label, version=version, homeKey=home_key)
            record['product'] = family if occupied else r['产品版本名称']
            identity = code + '|' + str(record['product'] or '')
            record['operationsKey'] = hashlib.sha256(identity.encode()).hexdigest()[:20]
            directory[record['operationsKey']] = dict(city=r['城市'], code=code,
                address=r['房源地址'], manager=r['服务管家'])
            if not pid:
                area = place_key(r['房源地址'])
                if area:
                    record['areaLabel'] = ' · '.join(area)
            if pid:
                record['mapId'] = pid
            elif not occupied:
                key = place_key(r['房源地址'])
                if key:
                    record['name'] = ' · '.join(key)
                ref = places.get(key)
                if ref and identities[code] == 1:
                    record['mapId'] = 'rental-' + hashlib.sha256(code.encode()).hexdigest()[:16]
                    record['communityRef'] = ref
                else:
                    record['mapPending'] = '小区位置待核验'
            floor = re.search(r'(?:单元|门)(-?\d+)层', r['房源地址'] or '')
            building = re.search(r'(?:[甲乙丙民]?[A-Za-z0-9一二三四五六七八九十百-]+(?:号楼|栋|幢)|[A-Z]座)', r['房源地址'] or '')
            if floor:
                record['floor'] = int(floor[1])
            if building:
                record['building'] = building[0]
            record.update({key:r[header] for key,header in METRICS.items()})
            if occupied:
                record['offline24'] = r['离线>24h设备数']
            for key,header in [('safety','安全事件明细'), ('anomalies','其他异常明细')]:
                if r[header]:
                    record[key] = r[header]
            result.append(record)
        if len({r['operationsKey'] for r in result}) != len(result):
            raise ValueError(f'{path.name} 有房源与产品重复，无法为每条明细建立独立运维入口')
        return dict(sourceFile=path.name, counts=totals, rows=result, unique=len(identities))
    finally:
        book.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('rental', type=Path)
    parser.add_argument('occupied', type=Path)
    args = parser.parse_args()
    codes = defaultdict(list)
    for p in json.loads((ASSETS/'beijing-listing-facts.json').read_text())['properties']:
        if p.get('houseCode'):
            codes[p['houseCode'].strip().upper()].append(p['id'])
    names = {p['id']:p['name'] for p in json.loads((ASSETS/'beijing-community-map.json').read_text())['properties']}
    dates = [re.search(r'(\d{8})\.xlsx$', p.name)[1] for p in [args.rental,args.occupied]]
    if dates[0] != dates[1]:
        raise ValueError('两份快照日期不同')
    from datetime import datetime
    date = datetime.strptime(dates[0], '%Y%m%d').date().isoformat()
    places = load_index()
    home_keys = {}
    directory = dict(date=date, rental={}, occupied={})
    snapshot = dict(date=date, levels=LEVELS, healthTargets=HEALTH_TARGETS, vacant=extract(args.rental,codes,names,False,home_keys,places,directory['rental']), occupied=extract(args.occupied,codes,names,True,home_keys,places,directory['occupied']))
    rental_keys = {r['homeKey'] for r in snapshot['vacant']['rows']}
    occupied_keys = {r['homeKey'] for r in snapshot['occupied']['rows']}
    overlap = rental_keys & occupied_keys
    snapshot['overlapHomes'] = len(overlap)
    for group in [snapshot['vacant'],snapshot['occupied']]:
        for row in group['rows']:
            if row['homeKey'] in overlap:
                row['inBothSources'] = True
    local_file = ASSETS/'local-home-directory.json'
    pending = local_file.with_suffix('.tmp')
    pending.write_text(json.dumps(directory,ensure_ascii=False,separators=(',',':')), encoding='utf-8')
    pending.replace(local_file)
    output = ASSETS/'beijing-occupancy-health.json'
    tmp = output.with_suffix('.tmp')
    tmp.write_text(json.dumps(snapshot,ensure_ascii=False,separators=(',',':')), encoding='utf-8')
    tmp.replace(output)
    for key in ['vacant','occupied']:
        g=snapshot[key]
        print(key, g['counts'], g['unique'], '地图关联',sum('mapId' in r for r in g['rows']))
