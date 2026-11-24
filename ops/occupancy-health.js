import { houseEvents, homeDisplayName, occupancyLabels as labels } from './house-events.js?v=20261124-cohorts';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = value => value.toLocaleString('zh-CN');
const metricFields = [
  ['网关在线率','gateway','%'], ['设备在线率','devices','%'], ['安全事件天数','events',' 天'],
  ['设备最长离线','deviceHours',' 小时'], ['网关最长离线','gatewayHours',' 小时'], ['面屏最长离线','panelHours',' 小时'],
  ['离线 1 天','offline1',' 台'], ['离线 2 天','offline2',' 台'], ['离线至少 3 天','offline3',' 台'],
  ['离线超 24 小时设备','offline24',' 台']
];
function healthMetrics(record, levels) {
  const stats = [['健康等级',levels[record.level]]];
  for(const [label,key,unit] of metricFields){
    if(Object.hasOwn(record,key))stats.push([label,Number.isFinite(record[key]) ? record[key]+unit : '未提供']);
  }
  return stats;
}

export function mountOccupancyHealth(snapshot, overview, family, {onScope, onMap, onOperations, directory}) {
  const groups = {rental:snapshot.vacant, occupied:snapshot.occupied};
  const byMap = new Map(Object.entries(groups).map(([scope,g]) => [scope,new Map(g.rows.filter(r => r.mapId).map(r => [r.mapId,r]))]));
  const routes = new Map();
  for (const [scope,group] of Object.entries(groups)) {
    for (const row of group.rows) {
      if (row.operationsKey) routes.set(scope+'/'+row.operationsKey,{scope,row});
    }
  }
  function match(id, preferred) {
    if(snapshot.publicOverview)return null;
    for (const scope of [preferred, 'rental', 'occupied']) {
      const row=byMap.get(scope)?.get(id);
      if (row) return {scope,row};
    }
    return null;
  }
  const total = group => group.counts.reduce((a,b) => a+b,0);
  let active = 'occupied', selected = null;
  function distribution(group) {
    return '<dl class="health-distribution">'+snapshot.levels.map((name,i) => '<div><dt>'+esc(name)+'</dt><dd>'+fmt(group.counts[i])+' <small>'+((group.counts[i]/total(group))*100).toFixed(1)+'%</small></dd></div>').join('')+'</dl>';
  }
  overview.innerHTML = '<div class="health-overview">'+Object.entries(groups).map(([key,g]) =>
    `<section class="health-block"><header><h2>${labels[key]}</h2></header><p class="health-total">${fmt(g.unique)}<small> 套房源</small></p>${distribution(g)}${key==='occupied' && total(g)!==g.unique?'<p class="analysis-note">健康等级沿用 BI 口径，同套房源的不同产品明细分别计入分布。</p>':''}<button class="text-btn" data-health-map="${key}">${snapshot.publicOverview && key==='occupied'?'解锁入住地图':'在地图查看 · '+byMap.get(key).size+' 套'}</button> <a class="text-btn" href="#health-${key}">查看家的运维监控</a></section>`).join('')+'</div>';
  overview.addEventListener('click', e => {
    const btn=e.target.closest('[data-health-map]');
    if(btn)onScope(btn.dataset.healthMap);
  });
  family.innerHTML = '<section data-selected aria-live="polite"></section>';
  const selectedHost=family.querySelector('[data-selected]');
  function displayName(row,scope) {
    const code=directory?.[scope]?.[row.operationsKey]?.code;
    if(!row.mapId && !row.areaLabel && code)return [row.name,code].filter(Boolean).join(' · ');
    return homeDisplayName(row);
  }
  function recordDetails(r,scope,locate=false,title=displayName(r,scope),inOperations=false){
    const events=houseEvents(r);
    const eventDetails=r ? `<section class="home-event-section"><h4>本套异常事件</h4><small>${esc(snapshot.date)} 快照 · ${esc(labels[scope])}健康明细</small>${events.length
      ? `<ul class="home-event-list">${events.map(e=>`<li><span><small>${esc(e.category)}</small> ${esc(e.name)}</span><strong>${esc(e.measure)}</strong> <button class="text-btn" data-event-demo="${esc(e.key)}">${inOperations?'查看事件':'查看事件演示'}</button></li>`).join('')}</ul>`
      : '<p>本期明细未列出异常事件。</p>'}</section>` : '';
    const info=directory?.[scope]?.[r.operationsKey];
    const fields=info ? [['城市',info.city],['房源产品版本',r.version],['房源地址',info.address],['房源编号',info.code],['服务管家',info.manager],['入住状态',labels[scope]]] : [];
    const identity=fields.length ? '<dl class="home-identity">'+fields.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v || '-')+'</dd></div>').join('')+'</dl>' : '';
    const origin=groups[scope]?.sourceFile;
    const originNote=origin ? '<p class="analysis-note">来源：'+esc(origin)+(r.inBothSources?' · 两份明细均有记录':'')+'</p>' : '';
    const stats=r ? healthMetrics(r,snapshot.levels) : [];
    return `<article class="health-note"><h3>${esc(title)}</h3>${originNote}${identity}<dl class="health-distribution">${stats.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${eventDetails}${r.mapPending?'<p>地图位置待核验</p>':''}<div class="home-actions">${!inOperations?'<button class="button" type="button" data-home-operations>进入本套运维</button>':''}${locate && r.mapId?'<button class="text-btn" data-locate>在地图定位</button>':''}</div></article>`;
  }
  function open(scope='occupied', id=null, name='') {
    active=scope;
    selected=id ? byMap.get(scope)?.get(id) : null;
    family.hidden=!id;
    selectedHost.innerHTML=selected ? recordDetails(selected,scope,true) : id
      ? '<p class="health-note">'+esc(name || '这套房源')+'在本期健康明细中暂无可核验关联。</p>' : '';
  }
  function openRecord(scope, row) {
    active=scope;
    selected=row;
    family.hidden=false;
    selectedHost.innerHTML=recordDetails(row,scope,true);
  }
  family.addEventListener('click', e=>{
    const button=e.target.closest('button');
    if(!button || !selected)return;
    if(button.hasAttribute('data-event-demo') || button.hasAttribute('data-home-operations'))
      onOperations(selected,active,button.dataset.eventDemo);
    if(button.hasAttribute('data-locate') && selected.mapId)onMap(active,selected.mapId);
  });
  open();
  return {open,openRecord,recordDetails,displayName,match,date:snapshot.date,overlapHomes:snapshot.overlapHomes,levelName:row=>snapshot.levels[row.level],
    route:key=>routes.get(key),pending:scope=>groups[scope].rows.filter(r=>!r.mapId).length,
    record:id=>match(id)?.row,has:(scope,id)=>byMap.get(scope)?.has(id) || false,
    sourceFile:scope=>groups[scope]?.sourceFile,
    label(id,scope){const found=match(id,scope);return found ? labels[found.scope]+' · '+snapshot.levels[found.row.level] : '';}
  };
}
