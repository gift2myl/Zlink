"""Local dashboard with the Excel snapshot in the first HTML response."""
import argparse
import json
import re
import unicodedata
from collections import Counter, defaultdict
from html import escape
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qsl, urlencode, urlsplit

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'ops' / 'assets'
HEALTH = ASSETS / 'beijing-occupancy-health.json'
DIRECTORY = ASSETS / 'local-home-directory.json'
SCOPES = {'rental': '可立即入住（待租中）', 'occupied': '已入住'}
PAGES = {'overview': '运维总览', 'household': '家的运维监控', 'anomalies': '全量详情检索', 'severe': '安全监控异常'}
KEYS = ('scope', 'level', 'version', 'community', 'code')
COLUMNS = ('城市', '房源产品版本', '房源地址', '服务管家', '健康等级', '房源异常项')


def h(value):
    return escape(str(value if value is not None and value != '' else '-'))


def normalized(value):
    return ''.join(unicodedata.normalize('NFKC', str(value or '')).upper().split())


def link(view, **params):
    return '/?' + urlencode({'view': view, **{k: v for k, v in params.items() if v != ''}}) + '#' + view


def select(name, title, options, value):
    choices = ''.join(f'<option value="{h(k) if k else ""}" {"selected" if str(k) == value else ""}>{h(v)}</option>' for k, v in options)
    return f'<label>{title}<select name="{name}">{choices}</select></label>'


def risk(row):
    level = row['level']
    hours = [row[k] for k in ('deviceHours','gatewayHours','panelHours') if row.get(k) is not None]
    return (level if level != 5 else -1, row['events'] if row.get('events') is not None else -1,
            max(hours, default=-1), -row['homeKey'])


def longest_offline(row):
    return max((row[k] for k in ('deviceHours','gatewayHours','panelHours') if row.get(k) is not None), default=-1)


def operational_order(row):
    return (-row['level'], -longest_offline(row), -(row['offline3'] if row.get('offline3') is not None else -1),
            row['devices'] if row.get('devices') is not None else float('inf'), row['homeKey'])


def safety_order(row):
    events = [s for s in re.split('[；;]',row.get('safety') or '') if s.strip()]
    return (-(row['events'] if row.get('events') is not None else -1), -len(events), row['homeKey'])


def health_goal(version, target, counts, total):
    rate = f'{100*counts[0]/total:.2f}%' if total else '—'
    has_target = isinstance(target,(int,float)) and 0 <= target <= 100
    marker = f'<i class="goal-marker" style="left:{target}%"></i>' if has_target else ''
    target_label = f'{target}%' if has_target else '未设定'
    parts = ''.join(f'<i data-hlevel="{i}" style="flex:{counts[i]}"></i>' for i in sorted(counts) if counts[i])
    status = ''
    if not total:
        status = '当前范围暂无房源'
    elif has_target:
        difference = 100*counts[0] - target*total
        points = f'{abs(difference)/total:.2f}'
        status = f'距目标 {points} 个百分点' if difference < 0 else f'已达标，高出 {points} 个百分点' if difference > 0 else '已达标'
    return (f'<div class="health-goal" data-health-goal="{h(version)}"><div class="goal-values">'
            f'<div><small>当前健康率</small><strong data-current-rate>{rate}</strong></div>'
            f'<div><small>目标健康率</small><strong data-target-rate>{target_label}</strong></div></div>'
            f'<div class="goal-track" aria-hidden="true"><div class="grade-bar">{parts}</div>{marker}</div>'
            f'<span class="goal-status">{status}</span></div>')


class Snapshot:
    def __init__(self):
        self.health = json.loads(HEALTH.read_text())
        self.directory = json.loads(DIRECTORY.read_text())
        if not self.health.get('date') or self.health['date'] != self.directory['date']:
            raise ValueError('健康快照和房源明细日期不同')
        self.levels = self.health['levels']
        self.rows = []
        versions = defaultdict(dict)
        severe = {}
        for scope, group in [('rental','vacant'), ('occupied','occupied')]:
            source = self.health[group]
            if len(source['rows']) != len(self.directory[scope]):
                raise ValueError('健康快照和房源明细数量不同')
            for row in source['rows']:
                info = self.directory[scope][row['operationsKey']]
                place = normalized(' '.join(str(x or '') for x in (info['address'],row.get('areaLabel'), row['name'] if row.get('mapId') else '',row.get('communityRef',{}).get('name'))))
                entry = (scope,row,info,place,normalized(info['code']))
                self.rows.append(entry)
                homes = versions[row['version']]
                key = row['homeKey']
                if key not in homes or risk(row) > risk(homes[key][1]):
                    homes[key] = entry
                safety = (row.get('safety') or '').strip() or (row.get('events') or 0)>0 or '安全隐患' in self.levels[row['level']]
                if safety and (key not in severe or safety_order(row) < safety_order(severe[key][1])):
                    severe[key] = entry
        self.versions = versions
        self.safety_keys = set(severe)
        self.severe = sorted(severe.values(), key=lambda e:safety_order(e[1]))
        self.overview = self.overview_html()
        self.monitor, self.ranking = self.monitor_html()
        self.maps = {}
        try:
            geography = {str(p['id']):p for p in json.loads((ASSETS/'beijing-community-map.json').read_text())['properties']}
            outlines = json.loads((ASSETS/'beijing.geojson').read_text())['features']
            for scope in SCOPES:
                self.maps[scope] = self.render_map(scope,geography,outlines)
        except (OSError,ValueError,KeyError):
            pass  # A missing geography file must not prevent the health pages opening.


    def render_map(self, scope, geography, features):
        groups = defaultdict(list)
        for row_scope,row,info,_,_ in self.rows:
            if row_scope != scope or not row.get('mapId'):
                continue
            geo = row.get('communityRef') or geography.get(row['mapId'],{})
            point = geo.get('coordinate')
            if point and len(point)==2 and all(isinstance(v,(int,float)) for v in point):
                groups[(tuple(point), geo.get('name') or row['name'])].append(info)
        if not groups:
            return ''
        xs,ys = zip(*(point for point,name in groups))
        cx,cy = (min(xs)+max(xs))/2,(min(ys)+max(ys))/2
        scale = min(860/max(.05,(max(xs)-min(xs))*.766),320/max(.05,max(ys)-min(ys)))
        def xy(lon,lat):
            return 460+(lon-cx)*.766*scale,190-(lat-cy)*scale
        outlines,labels = [],[]
        for feature in features:
            geom = feature['geometry']
            polygons = geom['coordinates'] if geom['type']=='MultiPolygon' else [geom['coordinates']]
            parts=[]
            for polygon in polygons:
                for ring in polygon:
                    parts.append('M'+' L'.join('%.1f %.1f'%xy(lon,lat) for lon,lat in ring)+' Z')
            outlines.append('<path d="'+' '.join(parts)+'"/>')
            center=feature['properties'].get('centroid')
            if center:
                x,y=xy(*center)
                if 20<x<900 and 15<y<365:
                    labels.append(f'<text x="{x:.1f}" y="{y:.1f}">{h(feature["properties"]["name"])}</text>')
        points=[]
        for (point,name),infos in groups.items():
            x,y=xy(*point)
            url=link('anomalies',scope=scope,**({'code':infos[0]['code']} if len(infos)==1 else {'community':name}))
            points.append(f'<a href="{h(url)}"><title>{h(name)} · {len(infos)} 套</title><circle cx="{x:.1f}" cy="{y:.1f}" r="4"/></a>')
        total=sum(map(len,groups.values()))
        return f'<div id="initial-map" data-scope="{scope}"><strong>{SCOPES[scope]} · 已匹配 {total} 套</strong><svg viewBox="0 0 920 380" role="img" aria-label="北京房源小区参考位置"><g class="district-outline">{"".join(outlines)}</g><g class="district-names">{"".join(labels)}</g><g class="property-points">{"".join(points)}</g></svg></div>'

    def overview_html(self):
        cards = []
        for scope, group in [('rental','vacant'),('occupied','occupied')]:
            source = self.health[group]
            counts = ''.join(f'<div><dt>{h(l)}</dt><dd>{n:,}</dd></div>' for l,n in zip(self.levels,source['counts']))
            target = link('anomalies',scope=scope)
            cards.append(f'<section class="health-block"><header><h2>{SCOPES[scope]}</h2><small>{h(self.health["date"])}</small></header><p class="health-total">{source["unique"]:,}<small> 套房源</small></p><dl class="health-distribution">{counts}</dl><a class="text-btn" href="{h(target)}">查看房源明细</a></section>')
        return '<div class="health-overview" data-initial-data>'+''.join(cards)+'</div>'

    def house_link(self, entry):
        scope,row,info,_,_ = entry
        url = link('anomalies',scope=scope,code=info['code'])
        title = row.get('areaLabel') or row['name']
        identity = ' '.join(str(v) for v in [row.get('building'),str(row['floor'])+'层' if row.get('floor') is not None else ''] if v)
        return f'<a href="{h(url)}">{h(title)} · {h(identity or info["code"])}</a>'

    def monitor_html(self):
        cards, ranks = [], []
        for version, by_home in self.versions.items():
            entries = list(by_home.values())
            counts = Counter(e[1]['level'] for e in entries)
            grades = ''.join(f'<div><dt><i data-hlevel="{i}"></i>{h(l)}</dt><dd>{counts[i]:,}</dd></div>' for i,l in enumerate(self.levels))
            readings = []
            for field,title in [('gateway','网关'),('devices','设备')]:
                rates = [e[1][field] for e in entries if e[1].get(field) is not None]
                mean = f'{sum(rates)/len(rates):.2f}%' if rates else '-'
                readings.append(f'<div><small>{title}在线率均值</small><strong>{mean}</strong></div>')
            goal = health_goal(version,self.health.get('healthTargets',{}).get(version),counts,len(entries))
            cards.append(f'<article class="health-version"><header><h3>{h(version)}</h3><strong>{len(entries):,} <small>套</small></strong></header>{goal}<dl>{grades}</dl><div class="version-readings">{"".join(readings)}</div></article>')
            ranked = sorted((e for e in self.rows if e[1]['version']==version and 1 <= e[1]['level'] <= 4
                             and e[1]['homeKey'] not in self.safety_keys),key=lambda e:operational_order(e[1]))
            homes = {}
            for entry in ranked:
                homes.setdefault(entry[1]['homeKey'],entry)
            abnormal = list(homes.values())
            items = ''.join(f'<li>{self.house_link(e)} · {h(self.levels[e[1]["level"]])}</li>' for e in abnormal[:10])
            ranks.append(f'<section class="rank-group"><header><h2>{h(version)}</h2></header><ol>{items}</ol></section>')
        def panel(title, items, note=''):
            return f'<section class="health-block" data-initial-data><h2>{title}</h2><p>{h(self.health["date"])} 健康快照{note}</p><div class="rank-groups">{"".join(items)}</div></section>'
        return panel('各产品版本健康状况',cards,' · 健康率为健康房源数 ÷ 当前范围去重房源总数，含未归类房源。'), panel('各产品版本异常房源 Top 10',ranks)

    def severe_panel(self, params):
        pages = max(1,(len(self.severe)+14)//15)
        raw = params.get('safetyPage','1')
        page = min(pages,max(1,int(raw))) if re.fullmatch(r'[0-9]{1,8}',raw) else 1
        items = []
        for entry in self.severe[(page-1)*15:page*15]:
            row = entry[1]
            evidence = row.get('safety') or ('安全事件 '+str(row['events'])+' 天' if row.get('events') else '具体事件待核验')
            items.append(f'<li>{self.house_link(entry)} · {h(self.levels[row["level"]])} · {h(evidence)}</li>')
        links = [f'<a class="button" href="{h(link("severe",safetyPage=n))}">{label}</a>'
                 for n,label in [(page-1,'上一页'),(page+1,'下一页')] if 1<=n<=pages]
        return f'<section class="health-block" data-initial-data><h2>安全监控异常 {len(self.severe):,} 套</h2><ul>{"".join(items)}</ul><div class="health-pager">第 {page} / {pages} 页　{" ".join(links)}</div></section>'

    def search(self, params):
        fields = {k:params.get(k,'') for k in KEYS}
        scope,level,version,community,code = (fields[k] for k in KEYS)
        code,community = normalized(code),normalized(community)
        matches = [e for e in self.rows if (not scope or e[0]==scope) and (not level or str(e[1]['level'])==level) and (not version or e[1]['version']==version) and code in e[4] and community in e[3]]
        count = len({e[1]['homeKey'] for e in matches})
        pages = max(1,(len(matches)+14)//15)
        raw_page = params.get('page','1')
        page = min(pages,max(1,int(raw_page))) if re.fullmatch(r'[0-9]{1,8}',raw_page) else 1
        form = [select('level','健康等级',[('','全部等级'),*enumerate(self.levels)],level),select('scope','入住状态',[('','全部入住状态'),*SCOPES.items()],scope),select('version','房源产品版本',[('','全部版本'),*((v,v) for v in self.versions)],version)]
        for k,title in [('community','小区名字'),('code','房源编号')]:
            form.append(f'<label>{title}<input type="search" name="{k}" value="{escape(fields[k],quote=True)}"></label>')
        form_html = '<form class="health-filters directory-filters" method="get" action="/#anomalies"><input type="hidden" name="view" value="anomalies">'+''.join(form)+'<button type="submit" class="button">检索</button><a href="'+h(link('anomalies'))+'">清空条件</a></form>'
        rows = []
        for scope_key,row,info,_,_ in matches[(page-1)*15:page*15]:
            items = '；'.join(v for v in (row.get('safety'),row.get('anomalies')) if v)
            grade = row['level']
            values = [h(info['city']),h(row['version'])+'<small>'+SCOPES[scope_key]+(' · 两份明细均有记录' if row.get('inBothSources') else '')+'</small>',
                      h(info.get('address'))+'<small>'+h(info['code'])+'</small>',h(info.get('manager')),
                      f'<span class="listing-health" data-grade="{"healthy" if grade==0 else "P"+str(grade)}">{h(self.levels[grade])}</span>',h(items or '本期未列出异常项')]
            cells = ''.join(f'<td data-label="{k}">{v}</td>' for k,v in zip(COLUMNS,values))
            rows.append('<tr>'+cells+'</tr>')
        table = '<table class="directory-table"><thead><tr>'+''.join(f'<th scope="col">{k}</th>' for k in COLUMNS)+'</tr></thead><tbody>'+''.join(rows)+'</tbody></table>' if matches else '<p>没有符合这些条件的房源。</p>'
        pager = []
        for n,title in [(page-1,'上一页'),(page+1,'下一页')]:
            if 1<=n<=pages:
                pager.append(f'<a class="button" href="{h(link("anomalies",**fields,page=n))}">{title}</a>')
        return f'<section class="health-block directory-block" data-initial-data>{form_html}<p data-search-summary>匹配 {count:,} 套房源</p>{table}<div class="health-pager">第 {page} / {pages} 页　{" ".join(pager)}</div></section>'

    def index(self,params):
        page = params.get('view','overview')
        if page not in PAGES:
            page = 'overview'
        doc = (ROOT/'index.html').read_text()
        content = {'occupancy-overview': self.overview,'home-directory':self.search(params),'monitor-health':self.monitor,'anomaly-ranking':self.ranking,'severe-homes':self.severe_panel(params)}
        map_scope = 'occupied' if params.get('map')=='occupied' else 'rental'
        if self.maps.get(map_scope):
            doc=doc.replace('<div id="scene-container">','<div id="scene-container">'+self.maps[map_scope],1)
        for name,html in content.items():
            token = '<!--snapshot:'+name+'-->'
            if token not in doc:
                raise ValueError('缺少展示位置 '+name)
            doc = re.sub(re.escape(token)+r'.*?<!--/snapshot-->', lambda _:html,doc,count=1,flags=re.S)
        # A fragment never reaches the server. Select an old bookmarked tab before modules load.
        early = """<script>(function(){
const name=location.hash.slice(1), page=({'health-rental':'household','health-occupied':'household'})[name] || name;
const nav=document.querySelector('.nav-item[data-page="'+(['overview','household','anomalies','severe'].includes(page)?page:document.body.dataset.page)+'"]');
if(!nav)return;
const selected=nav.dataset.page;
document.body.dataset.page=selected;
document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===selected+'-page'));
document.querySelectorAll('.nav-item[data-page]').forEach(el=>el.classList.toggle('active',el===nav));
document.getElementById('page-title').textContent=nav.textContent.trim();
})();</script>"""
        doc=doc.replace('<script type="module" src=',early+'<script type="module" src=',1)
        if page!='overview':
            doc=doc.replace('class="nav-item active" data-page="overview"','class="nav-item" data-page="overview"',1)
            doc=doc.replace(f'class="nav-item" data-page="{page}"',f'class="nav-item active" data-page="{page}"',1)
        return doc.replace('data-page="overview" data-scene',f'data-page="{page}" data-scene',1).replace(f'<section id="overview-page" class="page active">','<section id="overview-page" class="page">',1).replace(f'<section id="{page}-page" class="page">',f'<section id="{page}-page" class="page active">',1).replace('<h1 id="page-title">运维总览</h1>',f'<h1 id="page-title">{PAGES[page]}</h1>',1).encode()


class Preview(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64

    def get_snapshot(self):
        with self.snapshot_lock:
            stamp = tuple((f.stat().st_mtime_ns,f.stat().st_size) for f in (HEALTH,DIRECTORY))
            if stamp != self.snapshot_stamp:
                try:
                    fresh = Snapshot()
                except (OSError,ValueError,KeyError):
                    if self.snapshot is None:
                        raise
                else:
                    self.snapshot,self.snapshot_stamp = fresh,stamp
            return self.snapshot


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args,directory=str(ROOT),**kwargs)

    def log_message(self,*args):
        pass  # Local search URLs can contain house codes or addresses.

    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        super().end_headers()

    def send_head(self):
        url = urlsplit(self.path)
        if url.path not in ('/','/index.html'):
            return super().send_head()
        from io import BytesIO
        try:
            body = self.server.get_snapshot().index(dict(parse_qsl(url.query)))
        except (OSError,KeyError,ValueError):
            self.send_error(HTTPStatus.SERVICE_UNAVAILABLE,'Snapshot unavailable')
            return None
        self.send_response(HTTPStatus.OK)
        self.send_header('Content-Type','text/html; charset=utf-8')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        return BytesIO(body)


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=49746)
    args = parser.parse_args()
    with Preview(('127.0.0.1',args.port),Handler) as server:
        server.snapshot_lock = Lock()
        server.snapshot_stamp = server.snapshot = None
        server.get_snapshot()
        server.serve_forever()
