"""Build the small public-place reference index used by the Beijing rental import."""
import argparse
import csv
import hashlib
import math
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

from openpyxl import load_workbook
from build_community_positions import (
    DEFAULT_ROOT, containing_district, estimate, metres, offset, percentile,
    read_boundary_polygons, read_osm,
)

DISTRICT = re.compile(r'^(?:北京市?)?(东城|西城|朝阳|海淀|丰台|石景山|通州|顺义|昌平|大兴|房山|门头沟|密云|怀柔|平谷|延庆)区?')
# Only strip a building component. Keep directional areas, phases and numbered courtyards.
BUILDING = re.compile(r'(?<=[^\s])(?:[A-Za-z][座栋]|(?:[甲乙丙]|民)?(?:\d+(?:-\d+)?|[一二三四五六七八九十百]+)(?:号楼|栋|幢|座|公寓)|\d+-\d+单元)')
REFS = Path(__file__).with_name('rental-community-references.json')
ARCHIVE = 'https://github.com/shuijingoj/LianJiaCommunityData/tree/master/community_data_2019.02/bj'


def place_key(address):
    text = unicodedata.normalize('NFKC', (address or '')).strip()
    district = DISTRICT.match(text)
    if not district:
        return None
    local = text[district.end():]
    split = BUILDING.search(local)
    if not split:
        return None
    name = local[:split.start()].strip()
    if not name or any(x in name for x in ('单元', '楼层', '室', '(', ')')):
        return None
    return district[1], name


def load_index():
    return {(r['district'], r['name']):r for r in json.loads(REFS.read_text())['places']}


def wgs_to_gcj(lon, lat):
 # Conventional mainland GCJ offset on the Krasovsky ellipsoid.
 x, y = lon-105, lat-35
 pi, sin, cos, sqrt = math.pi, math.sin, math.cos, math.sqrt
 harmonic = (20*sin(6*x*pi)+20*sin(2*x*pi))*2/3
 dlat = -100+2*x+3*y+.2*y*y+.1*x*y+.2*sqrt(abs(x)) + harmonic
 dlat += (20*sin(y*pi)+40*sin(y*pi/3)+160*sin(y*pi/12)+320*sin(y*pi/30))*2/3
 dlon = 300+x+2*y+.1*x*x+.1*x*y+.1*sqrt(abs(x)) + harmonic
 dlon += (20*sin(x*pi)+40*sin(x*pi/3)+150*sin(x*pi/12)+300*sin(x*pi/30))*2/3
 rad, a, e2 = lat*pi/180, 6378245., 0.00669342162296594323
 magic = 1-e2*sin(rad)**2
 return lon+dlon*180/(a/sqrt(magic)*cos(rad)*pi), lat+dlat*180/((a*(1-e2))/(magic*sqrt(magic))*pi)

def bd_to_wgs(bd):
 # Undo BD polar perturbation, then solve the GCJ forward offset iteratively.
 x, y = bd[0]-.0065, bd[1]-.006
 scale = math.pi*3000/180
 radius = math.hypot(x,y)-.00002*math.sin(y*scale)
 theta = math.atan2(y,x)-.000003*math.cos(x*scale)
 gx, gy = radius*math.cos(theta), radius*math.sin(theta)
 return gcj_to_wgs(gx, gy)


def gcj_to_wgs(gx, gy):
 lon, lat = gx, gy
 for _ in range(8):
  tx, ty = wgs_to_gcj(lon,lat)
  lon, lat = lon+gx-tx, lat+gy-ty
 return [round(lon,7),round(lat,7)]


# The municipal descriptions explicitly link these subdivisions to their parent community.
PARENT_PLACES = {
    ('西城','裕中东里农业局宿舍'): ('裕中东里','https://www.bjxch.gov.cn/zt/jdjmpdsjd/xxxq/pnidpv949104.html'),
    ('西城','马连道中里三区'): ('马连道中里','https://www.bjxch.gov.cn/zt/jdjmpgwjd/gwjdgk/sqjs/sqjs-xxxq/pnidpv949269.html'),
}
# District and coordinate are taken from the public POI, not from an individual home.
REVIEWED_POINTS = {
    ('朝阳','酒仙桥路7号院'): ('小区参考点',116.488604,39.983682,'https://www.amap.com/place/B000A84JAN'),
    ('西城','牛街东里一区'): ('牛街东里小区一区',116.365723,39.887374,'https://ditu.amap.com/place/B000A9L15P'),
}


def official_places(directory):
    result = defaultdict(list)
    for file in sorted(directory.glob('*.html')):
        raw = file.read_bytes()
        html = raw.decode('utf-8',errors='replace')
        match = re.search(r'var\s+ZRCONFIG\s*=\s*',html)
        if not match or 'api.map.baidu.com/api?' not in html:
            continue
        item = json.JSONDecoder().raw_decode(html[match.end():])[0]
        name = item.get('resblock_name')
        if not name or str(item.get('resblock_id')) != file.stem or str(item.get('city_code')) != '110000':
            continue
        title = re.search(r'<title>北京.*?出租房源价格信息_([^<]+)</title>',html)
        district = DISTRICT.match(title[1]) if title else None
        bd = item.get('resblockPosition') or []
        if not district or len(bd)!=2 or not all(math.isfinite(float(n)) for n in bd):
            continue
        cards = re.findall(r'<li[^>]+class="[^"]*Z_house_item[^"]*"[^>]*>(.*?)</li>',html,re.S)
        business = set()
        for card in cards:
            # Only cards bearing this community's own name can establish its business district.
            if name not in card:
                continue
            label = re.search(r'<p[^>]*>\s*'+district[1]+r'\s*[｜|]\s*([^<|｜]+?)\s*</p>',card)
            if label:
                business.add(label[1].strip())
        result[(district[1],name)].append(dict(communityId=file.stem, coordinate=bd_to_wgs([float(v) for v in bd]),
            basis='official',precision='official_bd09_community_estimate',sourcePoint=[float(v) for v in bd],sourceCRS='BD-09',
            referenceUrl='https://www.ziroom.com/xiaoqu/'+file.stem+'.html',sha256=hashlib.sha256(raw).hexdigest(),
            evidence='自如官网小区页已核对北京、行政区和小区名称，百度坐标换算为 WGS84。'))
        if len(business)==1:
            result[(district[1],name)][-1]['business']=business.pop()
    return result


def build(workbook, archive, gpkg, pages):
    live = official_places(pages)
    geo = json.loads((DEFAULT_ROOT/'beijing-community-map.json').read_text())['properties']
    facts = json.loads((DEFAULT_ROOT/'beijing-listing-facts.json').read_text())['properties']
    public_ids = defaultdict(set)
    for r in facts:
        public_ids[r.get('houseCode')].add(r['id'])
    book = load_workbook(workbook, read_only=True, data_only=True)
    try:
        it = iter(book['房源明细'].values)
        headers = next(it)
        wanted = {place_key(r['房源地址']) for line in it if (r:=dict(zip(headers,line)))['城市']=='北京'
                  and len(public_ids[r['房源编号']]) != 1}
    finally:
        book.close()
    wanted.discard(None)
    with archive.open(encoding='utf-8-sig') as stream:
        archive_rows = list(csv.DictReader(stream, delimiter=';'))
    communities = defaultdict(list)
    for r in archive_rows:
        if r['city_id']=='110000' and r['city_name']=='北京':
            communities[(r['hier3'].removesuffix('小区'), r['community_name'])].append(r)
    official = defaultdict(list)
    controls_by_id = {}
    for r in geo:
        if r.get('coordinateSystem') != 'WGS84' or r.get('matchType') != 'community' or not r.get('coordinate'):
            continue
        official[(r['district'].removesuffix('区'),r['name'])].append(r)
        if r.get('precision') == 'osm_residential_reference':
            controls_by_id[r['communityId']] = r
    controls = {}
    centers = {}
    for r in archive_rows:
        key = r['community_id']
        target = controls_by_id.get(key)
        if not target or r['community_name'] != target['name'] or r['hier3'].removesuffix('小区') != target['district'].removesuffix('区'):
            continue
        xy = (float(r['longitude']),float(r['latitude']))
        center = target['coordinate']
        controls[key] = (xy,offset(xy,center))
        centers[key] = center
    errors = [metres(v[0],centers[k]) for k,(xy,_) in controls.items() if (v:=estimate(xy,controls,excluded=k))]
    p90 = percentile(errors,.9)
    if len(errors)<20 or p90 is None or p90>300:
        raise ValueError('公共坐标留一验证未通过')
    osm = read_osm(gpkg)
    boundaries = read_boundary_polygons(gpkg)
    # The local OSM extract omits Xicheng. Its municipal polygon is a coarse district check only.
    city = json.loads((DEFAULT_ROOT/'beijing.geojson').read_text())
    municipal = {r['properties']['name']:r['geometry']['coordinates'] for r in city['features'] if r['geometry']['type']=='MultiPolygon'}
    places = []
    for district,name in sorted(wanted):
        key = (district,name)
        base = dict(name=name,district=district)
        maps = official[key]
        if maps and len({(r.get('communityId'),tuple(r['coordinate'])) for r in maps}) == 1:
            r = maps[0]
            base.update(coordinate=r['coordinate'],communityId=r.get('communityId'),basis='catalog',precision=r['precision'],
                        evidence=r.get('positionBasis'),referenceId=r['id'])
            business = {m['businessDistrict']['name'] for m in maps if (m.get('businessDistrict') or {}).get('status')=='confirmed'}
            if len(business)==1:
                base['business'] = business.pop()
            places.append(base)
            continue
        if maps:  # Distinct identities or points under the same district/name are ambiguous.
            continue
        claimed = district+'区'
        boundary = boundaries if claimed in boundaries else municipal
        official_hits = live.get(key, [])
        parent = PARENT_PLACES.get(key)
        if not official_hits and parent:
            official_hits = live.get((district,parent[0]),[])
        if len(official_hits)==1 and containing_district(official_hits[0]['coordinate'],boundary)==claimed:
            place = dict(base,**official_hits[0])
            if parent and key not in live:
                place.update(parentName=parent[0],parentEvidence=parent[1],evidence='小区内分区仅定位到所属的'+parent[0]+'，参考点来自该小区官网。')
            places.append(place)
            continue
        if key in REVIEWED_POINTS:
            label,lon,lat,url = REVIEWED_POINTS[key]
            xy = gcj_to_wgs(lon,lat)
            if containing_district(xy,boundary)==claimed:
                places.append(dict(base,coordinate=xy,basis='poi',precision='poi_community_estimate',referenceUrl=url,
                    sourcePoint=[lon,lat],sourceCRS='GCJ-02',evidence='高德住宅小区地点已核对行政区和名称，换算为 WGS84。'))
                continue
        if key == ('海淀','塔院小区迎春园'):
            # Explicitly named residential area, not the whole 塔院小区.
            hits = [hit for hit in osm.get('塔院迎春园',[]) if str(hit[2])=='656808574' and containing_district(hit[0],boundary)==claimed]
            if len(hits)==1:
                places.append(dict(base,coordinate=list(hits[0][0]),basis='osm',precision='osm_residential_reference',
                    osmFeatureId='656808574',referenceUrl='https://www.openstreetmap.org/way/656808574',evidence='OSM 住宅范围“塔院迎春园”的小区参考点。'))
                continue
        hits = [(xy,osm_id) for xy,_,osm_id in osm.get(name,[]) if containing_district(xy,boundary)==claimed]
        archives = communities[key]
        archive_row = archives[0] if len(archives)==1 else None
        if len(hits)>1 or len(archives)>1:
            continue
        projected = None
        if archive_row:
            try:
                projected = estimate((float(archive_row['longitude']),float(archive_row['latitude'])),controls)
            except (ValueError,TypeError):
                pass
        if hits:
            xy,osm_id = hits[0]
            if projected and metres(xy,projected[0])>700:
                continue
            base.update(evidence='同一行政区内唯一同名的 OSM 住宅区范围中心。',coordinate=list(xy),basis='osm',precision='osm_residential_reference',osmFeatureId=str(osm_id))
        elif projected and containing_district(projected[0],boundary)==claimed:
            xy,num,nearest,dispersion = projected
            base.update(coordinate=[round(v,7) for v in xy],basis='archive',precision='archive_community_estimate',
                        controlCount=num,nearestMetres=nearest,dispersionMetres=dispersion,evidence='同区同名链家历史小区坐标，按周边已核验 OSM 小区参考点配准估算。')
        else:
            continue
        if archive_row:
            base['communityId'] = archive_row['community_id']
            base['referenceUrl'] = archive_row['url']
            if archive_row['hier4'].endswith('小区'):
                base['business'] = archive_row['hier4'][:-2]
        places.append(base)
    return dict(source=ARCHIVE,coordinateSystem='WGS84',controlCount=len(controls),heldOut=len(errors),p90Metres=p90,places=places)


if __name__ == '__main__':
    cli = argparse.ArgumentParser()
    for arg in ('rental','archive','gpkg','pages'):
        cli.add_argument(arg,type=Path)
    args = cli.parse_args()
    result = build(args.rental,args.archive,args.gpkg,args.pages)
    REFS.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(len(result['places']), '个小区参考位置，留一验证 P90', result['p90Metres'], '米')
