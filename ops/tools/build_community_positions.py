"""Build offline community-level reference positions from a bound Ziroom detail snapshot and Geofabrik Beijing."""
import argparse
import json
import math
import re
import sqlite3
import statistics
import struct
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

OSM_SOURCE = 'https://download.geofabrik.de/asia/china/beijing.html'
PLAN_HOSTS = {'imgpro.ziroom.com', 'home-decoration-cdn.ziroom.com', 'smsimg.ziroom.com'}
DEFAULT_ROOT = Path(__file__).resolve().parents[1] / 'assets'
MAX_NEIGHBORS = 7


def metres(a, b):
    latitude = math.radians((a[1] + b[1]) / 2)
    return 111195 * math.hypot((a[0] - b[0]) * math.cos(latitude), a[1] - b[1])


def median_pair(points):
    return tuple(statistics.median(p[i] for p in points) for i in (0, 1))


def offset(a, b):
    return a[0] - b[0], a[1] - b[1]


def read_osm(path):
    # Geofabrik stores OGC CRS84 (longitude, latitude) under a local SRS identifier.
    store = defaultdict(list)
    with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True) as conn:
        crs = conn.execute("SELECT s.definition FROM gpkg_geometry_columns g JOIN gpkg_spatial_ref_sys s "
                           "ON s.srs_id=g.srs_id WHERE g.table_name='gis_osm_landuse_a_free'").fetchone()
        if not crs or 'CRS84' not in crs[0] or 'WGS 84' not in crs[0]:
            raise ValueError('Residential layer must use verified longitude/latitude WGS84 CRS84')
        for name, osm_id, prefix in conn.execute(
                "SELECT name,osm_id,substr(geom,1,40) FROM gis_osm_landuse_a_free "
                "WHERE fclass='residential' AND name IS NOT NULL"):
            flags = prefix[3]
            if prefix[:2] != b'GP' or not ((flags >> 1) & 7):
                continue
            west, east, south, north = struct.unpack(('<' if flags & 1 else '>') + '4d', prefix[8:40])
            if 115 <= west <= east <= 118 and 39 <= south <= north <= 42:
                point = ((west + east) / 2, (south + north) / 2)
                store[name.strip()].append((point, (west, east, south, north), osm_id))
    return store


def read_boundary_polygons(path):
    """Read XY MultiPolygon WKB for the districted areas of Beijing in the same CRS."""
    districts = {}
    with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True) as conn:
        query = "SELECT name,geom FROM gis_osm_adminareas_a_free WHERE fclass='admin_level6' AND name IS NOT NULL"
        for name, geom in conn.execute(query):
            # GPKG header plus envelope, followed by OGC WKB, possibly with holes.
            header = 8 + {0:0, 1:32, 2:48, 3:48, 4:64}[(geom[3] >> 1) & 7]
            order = '<' if geom[header] else '>'
            geometry_type, count = struct.unpack_from(order + 'II', geom, header + 1)
            if geometry_type != 6:
                raise ValueError('Expected XY multipolygon district boundaries')
            cursor = header + 9
            polygons = []
            for _ in range(count):
                order = '<' if geom[cursor] else '>'
                polygon_type, nrings = struct.unpack_from(order+'II', geom, cursor+1)
                if polygon_type != 3:
                    raise ValueError('Expected XY polygon')
                cursor += 9
                rings = []
                for _ in range(nrings):
                    n = struct.unpack_from(order+'I', geom, cursor)[0]
                    cursor += 4
                    rings.append(list(struct.iter_unpack(order+'dd', geom[cursor:cursor+16*n])))
                    cursor += 16*n
                polygons.append(rings)
            districts[name] = polygons
    return districts


def inside_ring(point, ring):
    x, y = point
    inside = False
    for (x1,y1), (x2,y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2-x1)*(y-y1)/(y2-y1)+x1:
            inside = not inside
    return inside


def containing_district(point, districts):
    for district, polygons in districts.items():
        for rings in polygons:
            if rings and inside_ring(point, rings[0]) and not any(inside_ring(point,r) for r in rings[1:]):
                return district
    return None


def accepted_url(value, hosts):
    if not isinstance(value, str):
        return None
    try:
        url = urlsplit(value)
        if url.scheme == 'https' and url.hostname in hosts and not url.username and not url.password and not url.port:
            return url
    except ValueError:
        pass
    return None


def assets(detail, listing_id):
    value = detail.get('planUrl')
    url = accepted_url(value, PLAN_HOSTS)
    plan = value if url and re.search(r'\.(?:jpg|jpeg|png|webp)(?:$|_)', url.path, re.I) else None
    value = detail.get('vrUrl')
    url = accepted_url(value, {'metaverse.ziroom.com'})
    query = parse_qs(url.query) if url and url.path == '/pano-vr' else {}
    ids = query.get('inv_no', [])
    vr = value if ids and all(i == listing_id for i in ids) and query.get('zrVrId') else None
    return plan, vr


def valid_bd(detail):
    bd = detail.get('bd09')
    return (detail.get('bdMap') is True and isinstance(bd, list) and len(bd) == 2
            and all(type(v) in (int, float) and math.isfinite(v) for v in bd)
            and 115 <= bd[0] <= 118 and 39 <= bd[1] <= 42)


def match_osm(communities, osm):
    preliminary = []
    for info in communities.values():
        hits = osm.get(info['name'], [])
        if len(hits) == 1 and metres(info['bd09'], hits[0][0]) < 3500:
            preliminary.append(offset(info['bd09'], hits[0][0]))
    if len(preliminary) < 10:
        raise ValueError('Too few independent, geographically plausible same-name residential controls')
    shift = median_pair(preliminary)
    matches = {}
    for key, info in communities.items():
        predicted = offset(info['bd09'], shift)
        candidates = []
        for point, bounds, osm_id in osm.get(info['name'], []):
            west, east, south, north = bounds
            near = (min(max(predicted[0], west), east), min(max(predicted[1], south), north))
            dist = metres(point, predicted)
            if metres(near, predicted) <= 230 and dist <= 750:
                candidates.append((dist, point, bounds, osm_id))
        candidates.sort()
        if candidates and (len(candidates) == 1 or candidates[1][0] - candidates[0][0] >= 250):
            matches[key] = candidates[0]
    return matches


def estimate(bd, controls, excluded=None):
    nearby = sorted((metres(bd, source), key, source, delta) for key, (source, delta) in controls.items()
                    if key != excluded and metres(bd, source) <= 10000)[:MAX_NEIGHBORS]
    if len(nearby) < 3 or nearby[0][0] > 5000:
        return None
    # Reject extrapolation well outside the bearings of the reference neighbourhood.
    bearings = sorted(math.degrees(math.atan2((p[2][0] - bd[0]) * .77, p[2][1] - bd[1])) for p in nearby)
    gaps = [b-a for a, b in zip(bearings, bearings[1:])] + [360 + bearings[0] - bearings[-1]]
    if max(gaps) > 245 and nearby[0][0] > 1500:
        return None
    delta = median_pair([p[3] for p in nearby])
    predicted = offset(bd, delta)
    dispersion = statistics.median(metres(predicted, offset(bd, p[3])) for p in nearby)
    if dispersion > 155:
        return None
    return predicted, len(nearby), round(nearby[0][0]), round(dispersion)


def percentile(errors, q):
    values = sorted(errors)
    if not values:
        return None
    k = (len(values) - 1) * q
    low, high = math.floor(k), math.ceil(k)
    return round(values[low] + (values[high] - values[low]) * (k - low))


def validate_city_offset(controls, communities, matches):
    districts = {key: communities[key].get('district') for key in controls}
    folds, all_errors = {}, []
    for district in sorted(set(districts.values()) - {None}):
        train = [delta for k, (_,delta) in controls.items() if districts[k] != district]
        if len(train) < 20:
            continue
        shift = median_pair(train)
        errors = [metres(offset(bd,shift),matches[k][1]) for k,(bd,_) in controls.items() if districts[k] == district]
        all_errors.extend(errors)
        folds[district] = {'heldOut':len(errors),'medianMetres':percentile(errors,.5),'p90Metres':percentile(errors,.9)}
    p90 = percentile(all_errors,.9)
    report = {'controls':len(controls),'districtFolds':len(folds),'heldOutCommunities':len(all_errors),
              'medianErrorMetres':percentile(all_errors,.5),'p90ErrorMetres':p90,'folds':folds,
              'enabled':len(folds) >= 5 and len(all_errors) >= 50 and p90 is not None and p90 <= 300,
              'validation':'每轮完整留出一个行政区，用其余区的中位偏移预测，对照该区严格同名 OSM 住宅包络中心。'}
    return report, median_pair([delta for _,delta in controls.values()]) if controls else None


def city_estimate(info, controls, shift, boundaries, report):
    bd = info['bd09']
    point = offset(bd, shift)
    distances = sorted(metres(bd, source) for source, _ in controls.values())
    if len(distances) < 3 or distances[0] > 8000 or distances[2] > 12000:
        return None
    district = containing_district(point, boundaries)
    claimed = info.get('district')
    if not district or not claimed:
        return None
    # Expose the administrative polygon as evidence, and treat clear cross-district discrepancies as unresolved.
    overlaps = claimed in {'亦庄开发区','北京经济技术开发区'} and district in {'大兴区','通州区'}
    if district != claimed and not overlaps:
        return None
    fold = report['folds'].get(district, {})
    if fold.get('heldOut',0) >= 5 and fold['p90Metres'] > 350:
        return None
    return {'coordinate':[round(v,7) for v in point],'precision':'city_registered_community_estimate',
            'positionBasis':'官网百度小区位置使用北京市域控制点的中位偏移估算；坐标已核对北京行政区多边形。',
            'boundaryDistrict':district,'nearestControlMetres':round(distances[0]),
            'controlCount':len(controls),'holdoutCount':report['heldOutCommunities'],'validationMedianMetres':report['medianErrorMetres'],
            'validationP90Metres':report['p90ErrorMetres']}


def build(snapshot, details, osm, boundaries, availability):
    inventory = {}
    for row in snapshot['listings'] + snapshot['checks']:
        i = row.get('id')
        if not isinstance(i, str) or not i.isdigit() or row.get('detailUrl') != f'https://www.ziroom.com/x/{i}.html':
            continue
        inventory[i] = {**inventory.get(i, {}), **{k:v for k,v in row.items() if v not in ('', None)}}
    unavailable = {(str(item.get('id')),item.get('url')):item.get('reason') or 'unavailable'
                   for item in availability.get('unavailable', []) if item.get('id') and item.get('url')}
    alternatives = {(str(item.get('id')), item.get('primaryUrl')): item.get('sourceUrl')
                    for item in availability.get('replacements', [])}
    placeholders = {url for (_,url), reason in unavailable.items() if reason == 'placeholder'}
    verified = {i: r for i, r in details.items() if i in inventory and r.get('id') == i and r.get('name')}
    by_community = defaultdict(list)
    for info in verified.values():
        if info.get('communityId') and valid_bd(info):
            by_community[info['communityId']].append(info)
    # Different names or conflicting source points under a single identifier need investigation.
    communities = {k: rs[0] for k, rs in by_community.items()
                   if len({(r['name'], r.get('district'), tuple(r['bd09'])) for r in rs}) == 1}
    matches = match_osm(communities, osm)
    controls = {}
    for key, (residual, center, (w,e,s,n), osm_id) in matches.items():
        if residual <= 320 and metres((w,s),(e,n)) <= 1500:
            bd = communities[key]['bd09']
            controls[key] = (bd, offset(bd, center))
    errors = []
    for key, (bd, _) in controls.items():
        held_out = estimate(bd, controls, excluded=key)
        if held_out:
            errors.append(metres(held_out[0], matches[key][1]))
    median_error, p90 = percentile(errors, .5), percentile(errors, .9)
    validated = len(errors) >= 20 and p90 is not None and p90 <= 300
    city_report, city_shift = validate_city_offset(controls, communities, matches)
    positions = {}
    for key, info in communities.items():
        if key in matches:
            _, point, bounds, osm_id = matches[key]
            positions[key] = {'coordinate': [round(v,7) for v in point], 'precision':'osm_residential_reference',
                              'positionBasis':'严格同名 OSM 住宅范围包络中心；与官网小区位置就近核对。',
                              'osmFeatureId':osm_id, 'osmLayer':'gis_osm_landuse_a_free'}
        elif validated:
            result = estimate(info['bd09'], controls)
            if result:
                point, sample_count, nearest, dispersion = result
                positions[key] = {'coordinate':[round(v,7) for v in point], 'precision':'registered_community_estimate',
                                  'positionBasis':'官网百度小区坐标，按附近严格同名 OSM 住宅参考点的偏移中位数估算。',
                                  'controlCount':sample_count, 'nearestControlMetres':nearest, 'localDispersionMetres':dispersion,
                                  'holdoutCount':len(errors), 'validationMedianMetres':median_error, 'validationP90Metres':p90}
        if key not in positions and city_report['enabled']:
            approximation = city_estimate(info, controls, city_shift, boundaries, city_report)
            if approximation:
                positions[key] = approximation
    by_name = defaultdict(set)
    for key, info in communities.items():
        by_name[info['name']].add(key)
    rows = []
    for i, card in sorted(inventory.items()):
        detail = verified.get(i, {})
        name = detail.get('name') or card.get('community')
        district = detail.get('district') or card.get('district')
        business = detail.get('business') or card.get('business')
        key = detail.get('communityId')
        inherited = False
        # If a detail page was unavailable, require both an exact name and a second source attribute.
        if not detail and len(by_name[name]) == 1:
            candidate = next(iter(by_name[name]))
            matching_district = district and district == communities[candidate].get('district')
            matching_transit = card.get('transit') and any(
                card['transit'] == inventory[r['id']].get('transit') for r in by_community[candidate])
            if matching_district or matching_transit:
                key, inherited = candidate, True
        point = positions.get(key) if not detail or valid_bd(detail) else None
        plan, vr = assets(detail, i)
        excluded = 'placeholder' if plan in placeholders else unavailable.get((i, plan))
        alternate = alternatives.get((i,plan))
        if excluded:
            plan = None
        elif alternate and accepted_url(alternate, PLAN_HOSTS) and alternate.partition('_C_')[0] == plan.partition('_C_')[0]:
            plan = alternate
        url = f'https://www.ziroom.com/x/{i}.html'
        row = {'id':i,'realListingId':i,'name':name,'communityId':key or None,'district':district or None,
               'businessDistrict':{'name':business,'status':'confirmed' if business else 'unverified',
                                   'sourceUrl':url if business else None},
               'sourceUrl':url,'publicDetailVerified':bool(detail),'publicFloorplanUrl':plan,'publicVrUrl':vr,
               'publicFloorplanStatus':excluded or ('alternate_image' if alternate and plan == alternate else 'linked' if plan else 'not_provided'),
               'coordinateSystem':'WGS84','isExactPropertyLocation':False,'observedAt':snapshot['date'],
               'matchType':'community' if point else 'unmatched', 'communityMatchInherited':inherited}
        row.update(point or {'coordinate':None,'precision':'unlocated','positionBasis':'暂无可核验的住宅匹配或通过验证的邻近控制点。'})
        if point and inherited:
            row['positionSourceUrl'] = 'https://www.ziroom.com/x/' + communities[key]['id'] + '.html'
        rows.append(row)
    counts = Counter(row['precision'] for row in rows)
    summary = {'total':len(rows),'detailsVerified':len(verified),'officialCommunities':len(by_community),
               'positionedListings':sum(bool(row['coordinate']) for row in rows),
               'positionedCommunities':len({r['communityId'] for r in rows if r['coordinate']}),
               'byPrecision':dict(sorted(counts.items())),
               'cityRegisteredMethod':city_report,
               'registeredMethod':{'controls':len(controls),'holdoutPredictable':len(errors),'medianErrorMetres':median_error,
                                   'p90ErrorMetres':p90,'enabled':validated,
                                   'validation':'逐小区留一；误差相对 OSM 住宅范围包络中心，仅代表这批可预测控制点的交叉验证。'},
               'floorplanStatuses':dict(sorted(Counter(r['publicFloorplanStatus'] for r in rows).items())),
               'planCount':sum(bool(r['publicFloorplanUrl']) for r in rows),'vrCount':sum(bool(r['publicVrUrl']) for r in rows)}
    return {'schemaVersion':1,'observedAt':snapshot['date'],'coordinateSystem':'WGS84','coordinateOrder':['longitude','latitude'],
            'source':{'official':'https://www.ziroom.com/','geodata':OSM_SOURCE,'attribution':'© OpenStreetMap contributors',
                      'license':'https://www.openstreetmap.org/copyright','scope':'北京小区级参考点；不代表楼栋、房间或设备位置。'},
            'summary':summary, 'properties':rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gpkg', required=True, type=Path)
    parser.add_argument('--details', required=True, type=Path)
    parser.add_argument('--snapshot', type=Path, default=DEFAULT_ROOT/'public-inventory.json')
    parser.add_argument('--availability', type=Path, default=DEFAULT_ROOT/'plan-previews'/'availability.json')
    parser.add_argument('--output', type=Path, default=DEFAULT_ROOT/'beijing-community-map.json')
    args = parser.parse_args()
    result = build(json.loads(args.snapshot.read_text()), json.loads(args.details.read_text()), read_osm(args.gpkg),read_boundary_polygons(args.gpkg),json.loads(args.availability.read_text()))
    # Keep the static release human-readable and one compact record per line.
    meta = {k:v for k,v in result.items() if k != 'properties'}
    output = json.dumps(meta,ensure_ascii=False,indent=2)[:-2] + ',\n  "properties": [\n'
    output += ',\n'.join('    '+json.dumps(row,ensure_ascii=False,separators=(',',':')) for row in result['properties']) + '\n  ]\n}\n'
    args.output.write_text(output)
    print(json.dumps(result['summary'],ensure_ascii=False))


if __name__ == '__main__':
    main()
