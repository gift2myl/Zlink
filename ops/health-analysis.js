import { houseEvents, homeDisplayName, occupancyLabels as scopeNames } from './house-events.js?v=20261124-cohorts';

const format = new Intl.NumberFormat('zh-CN').format;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const compare = (a,b) => a.localeCompare(b, 'zh-CN', {numeric:true});
const uniqueNames = values => [...new Set(values.filter(Boolean))].sort(compare);
const options = names => names.map(v => `<option value="${escape(v)}">${escape(v)}</option>`).join('');
const pageSize = 15;
const productVersions = ['心舍2.0', '心舍3.0', '曼舍2.0'];

function healthGoal(version, target, counts, total) {
  const healthy = counts[0];
  const rate = total ? 100 * healthy / total : null;
  const hasTarget = Number.isFinite(target) && target >= 0 && target <= 100;
  const parts = counts.map((n,i)=>n ? `<i data-hlevel="${i}" style="flex:${n}"></i>` : '').join('');
  let status = '';
  if (!total) status = '当前范围暂无房源';
  else if (hasTarget) {
    const difference = 100 * healthy - target * total;
    const points = (Math.abs(difference) / total).toFixed(2);
    status = difference < 0 ? '距目标 '+points+' 个百分点' : difference > 0 ? '已达标，高出 '+points+' 个百分点' : '已达标';
  }
  return `<div class="health-goal" data-health-goal="${escape(version)}"><div class="goal-values">
    <div><small>当前健康率</small><strong data-current-rate>${rate===null?'—':rate.toFixed(2)+'%'}</strong></div>
    <div><small>目标健康率</small><strong data-target-rate>${hasTarget?target+'%':'未设定'}</strong></div>
  </div><div class="goal-track" aria-hidden="true"><div class="grade-bar">${parts}</div>${hasTarget?`<i class="goal-marker" style="left:${target}%"></i>`:''}</div>
  <span class="goal-status">${status}</span></div>`;
}

function longestOffline(row) {
  const hours = [row.deviceHours, row.gatewayHours, row.panelHours].filter(Number.isFinite);
  return hours.length ? Math.max(...hours) : null;
}

function riskOrder(a, b) {
  return b.row.level - a.row.level
    || (b.safetyDays ?? -1) - (a.safetyDays ?? -1)
    || (b.offlineHours ?? -1) - (a.offlineHours ?? -1)
    || a.row.homeKey - b.row.homeKey;
}

function operationalOrder(a,b) {
  return b.row.level - a.row.level
    || (b.offlineHours ?? -1) - (a.offlineHours ?? -1)
    || (b.row.offline3 ?? -1) - (a.row.offline3 ?? -1)
    || (a.row.devices ?? Infinity) - (b.row.devices ?? Infinity)
    || a.row.homeKey - b.row.homeKey;
}

function safetyOrder(a,b) {
  return (b.safetyDays ?? -1) - (a.safetyDays ?? -1)
    || b.safetyEvents.length - a.safetyEvents.length
    || a.row.homeKey - b.row.homeKey;
}

function mostSeverePerHome(entries, order) {
  const homes = new Map();
  for (const entry of entries) {
    const previous = homes.get(entry.row.homeKey);
    if (!previous || order(entry,previous) < 0) homes.set(entry.row.homeKey,entry);
  }
  return [...homes.values()].sort(order);
}

function mountImprovementPlan(standards, plan = []) {
  for (const slot of standards.querySelectorAll('[data-improvement-grade]')) {
    const item = plan.find(entry => entry.grade === slot.dataset.improvementGrade);
    slot.replaceChildren();
    slot.hidden = !item;
    if (!item) continue;
    slot.innerHTML = `<details class="grade-improvement" open>
      <summary><span>改善举措</span><strong>${escape(item.strategy)}</strong></summary>
      <div><p>责任方 <strong>${escape(item.owner)}</strong></p>
      <h4>专项行动与计划覆盖量</h4><ol>${item.actions.map(action=>`<li>${escape(action)}</li>`).join('')}</ol>
      ${item.target?`<p class="improvement-target">处置目标 <strong>${escape(item.target)}</strong></p>`:''}</div>
    </details>`;
  }
}

export function mountHealthAnalysis(snapshot, monitorRoot, rankingRoot, severeRoot, onDetails, onMonitorFilter, nameFor=homeDisplayName) {
  const entries = [];
  for (const [scope, group] of [['rental',snapshot.vacant], ['occupied',snapshot.occupied]]) {
    for (const row of group.rows) {
      if (row.homeKey == null) {
        rankingRoot.textContent = severeRoot.textContent = '当前快照缺少房源关联信息，请重新导入健康明细。';
        return;
      }
      const events = houseEvents(row);
      const safetyEvents = events.filter(event=>event.category==='安全事件');
      entries.push({
        index:entries.length, row, scope, safetyEvents,
        safety: safetyEvents.length > 0 || row.events > 0 || snapshot.levels[row.level]?.includes('安全隐患'),
        events: events.filter(event=>event.category==='设备异常').map(event=>event.name),
        safetyDays:Number.isFinite(row.events) ? row.events : null, offlineHours:longestOffline(row)
      });
    }
  }
  const safetyHomes = new Set(entries.filter(entry=>entry.safety).map(({row})=>row.homeKey));
  mountImprovementPlan(document.getElementById('health-standards'),snapshot.improvementPlan);
  const extraVersions = uniqueNames(entries.map(({row}) => row.version)).filter(v => !productVersions.includes(v));
  const versions = [...productVersions, ...extraVersions];
  const roots = [monitorRoot,severeRoot];
  rankingRoot.innerHTML='<section class="health-block"><h2>各产品版本异常房源 Top 10</h2><div data-analysis-result></div></section>';
  const requestedPage = new URLSearchParams(location.search).get('safetyPage') || '';
  let page = /^[0-9]{1,8}$/.test(requestedPage) ? Math.max(0, Number(requestedPage)-1) : 0;
  let severeRows = [];

  for (const root of roots) {
    const isRanking = root === monitorRoot;
    root.innerHTML = `<section class="health-block analysis-block">
      ${isRanking?'<h2>各产品版本健康状况</h2>':''}
      <div class="health-filters analysis-filters">
        <label>产品版本<select data-filter="version"><option value="">全部版本</option>${options(versions)}</select></label>
        <label>产品细分<select data-filter="product"></select></label>
        <label>入住状态<select data-filter="scope"><option value="">全部入住状态</option><option value="rental">${scopeNames.rental}</option><option value="occupied">已入住</option></select></label>
        ${isRanking ? '' : '<label>安全事件<select data-safety-filter><option value="">全部安全事件</option></select></label>'}
      </div><div data-analysis-result></div></section>`;
    root.addEventListener('change', e => {
      if (!e.target.matches('[data-filter],[data-safety-filter]')) return;
      if (root === monitorRoot) onMonitorFilter();
      else page=0;
      render(root);

    });
  }

  function renderRanking(filtered, visibleVersions) {
    const host = rankingRoot.querySelector('[data-analysis-result]');
    const groups = visibleVersions.map(version => {
      const homes = mostSeverePerHome(filtered.filter(({row}) => row.version===version
        && row.level>=1 && row.level<=4 && !safetyHomes.has(row.homeKey)), operationalOrder);
      const leaders = homes.slice(0,10);
      return `<section class="rank-group" data-ranking-version="${escape(version)}">
        <header><h2>${escape(version)}</h2><small>异常房源 ${format(homes.length)} 套</small></header>
        ${leaders.length ? `<ol class="home-ranking">${leaders.map((entry,i) => {
          const {row,scope,offlineHours,events} = entry;
          const name = nameFor(row,scope);
          return `<li><button type="button" data-ranked-home="${entry.index}" aria-label="第 ${i+1} 名，${escape(name)}，查看异常详情">
            <span class="rank-index" aria-hidden="true">${i+1}</span>
            <span class="rank-house"><strong>${escape(name)}</strong>
              <span class="rank-status"><span class="listing-health" data-grade="P${row.level}">${escape(snapshot.levels[row.level])}</span>${scopeNames[scope]}</span>
              <small>${escape(events.slice(0,2).join('、') || '本期未列出具体事件')}${events.length>2?' 等':''}</small>
              <small>最长离线 ${offlineHours == null ? '-' : format(offlineHours)+' 小时'} · 离线 ≥3 天 ${row.offline3 == null ? '-' : format(row.offline3)+' 台'}</small>
            </span><span class="rank-arrow" aria-hidden="true">›</span></button></li>`;
        }).join('')}</ol>` : '<p class="analysis-empty">当前范围内没有异常房源。</p>'}</section>`;
    });
    host.innerHTML = `<p class="ranking-rule">${escape(snapshot.date)} 快照 · 各版本按房源去重，最多显示 10 套。P4 → P1，同级依次比较最长离线、离线 ≥3 天设备数和设备在线率（低者优先）。</p><div class="rank-groups">${groups.join('')}</div>`;
  }

  function renderSevere(entries) {
    const select = severeRoot.querySelector('[data-safety-filter]');
    const candidates = entries.filter(entry=>entry.safety);
    const types = uniqueNames(candidates.flatMap(entry=>entry.safetyEvents.map(event=>event.name)));
    const selected = types.includes(select.value) ? select.value : '';
    select.innerHTML = '<option value="">全部安全事件</option>'+options(types);
    select.value = selected;
    severeRows = mostSeverePerHome(candidates.filter(entry=>!selected || entry.safetyEvents.some(event=>event.name===selected)), safetyOrder);
    const pages = Math.max(1, Math.ceil(severeRows.length/pageSize));
    page = Math.min(page, pages-1);
    const start = page * pageSize;
    severeRoot.querySelector('[data-analysis-result]').innerHTML = `<header class="analysis-heading"><h2>安全监控异常 <strong>${format(severeRows.length)}</strong> 套</h2></header>
      ${severeRows.length ? `<ul class="severe-list">${severeRows.slice(start,start+pageSize).map(({row,scope,safetyEvents,safetyDays}, i) => `<li>
        <div><strong>${escape(nameFor(row,scope))}</strong><small>${scopeNames[scope]} · ${escape(row.version)}</small></div>
        <div class="severe-evidence"><span class="listing-health" data-grade="${row.level>=1 && row.level<=4 ? 'P'+row.level : 'unknown'}">${escape(snapshot.levels[row.level])}</span>
        <small>${escape(safetyEvents.map(event=>[event.name,event.measure].filter(Boolean).join(' ')).join('、') || (safetyDays>0 ? '安全事件 '+safetyDays+' 天' : '具体事件待核验'))}</small></div>
        <button type="button" class="text-btn" data-severe-home="${start+i}" aria-label="${escape(nameFor(row,scope))}的异常详情">异常详情</button></li>`).join('')}</ul>
        <div class="health-pager"><button type="button" class="button" data-analysis-page="-1" ${page===0?'disabled':''}>上一页</button><span>第 ${page+1} / ${pages} 页</span><button type="button" class="button" data-analysis-page="1" ${page+1===pages?'disabled':''}>下一页</button></div>`
        : '<p class="analysis-empty">当前范围内没有安全监控异常。</p>'}`;
  }

  function renderMonitor(rows, versions) {
    const cards=versions.map(version=>{
      const homes=new Map();
      for(const entry of rows) {
        const {row}=entry;
        if(row.version!==version)continue;
        const previous=homes.get(row.homeKey);
        if(!previous || (row.level!==5 && (previous.row.level===5 || riskOrder(entry,previous)<0)))homes.set(row.homeKey,entry);
      }
      const counts=snapshot.levels.map(()=>0);
      const readings={gateway:[],devices:[]};
      for(const {row} of homes.values()){
        counts[row.level]++;
        for(const metric of Object.keys(readings))if(Number.isFinite(row[metric]))readings[metric].push(row[metric]);
      }
      const mean=values=>values.length?(values.reduce((sum,n)=>sum+n,0)/values.length).toFixed(2)+'%':'未提供';
      return `<article class="health-version" data-health-version="${escape(version)}"><header><h3>${escape(version)}</h3><strong>${format(homes.size)} <small>套</small></strong></header>
        ${healthGoal(version,snapshot.healthTargets?.[version],counts,homes.size)}<dl>${counts.map((n,i)=>{
          return `<div><dt><i data-hlevel="${i}"></i>${escape(snapshot.levels[i])}</dt><dd>${format(n)}</dd></div>`;
        }).join('')}</dl><div class="version-readings"><div><small>网关在线率均值</small><strong>${mean(readings.gateway)}</strong></div><div><small>设备在线率均值</small><strong>${mean(readings.devices)}</strong></div></div></article>`;
    }).join('');
    monitorRoot.querySelector('[data-analysis-result]').innerHTML=`<p class="analysis-note">${escape(snapshot.date)} 健康快照 · 健康率为健康房源数 ÷ 当前范围去重房源总数，含未归类房源。同套取已核验的最高风险等级，在线率按有数值的房源取平均。</p><div class="rank-groups">${cards}</div>`;
  }

  function render(root) {
    const field=key=>root.querySelector('[data-filter="'+key+'"]');
    const filters={version:field('version').value,scope:field('scope').value,product:field('product').value};
    const base=entries.filter(({row,scope})=>(!filters.version || row.version===filters.version) && (!filters.scope || scope===filters.scope));
    const products=uniqueNames(base.map(({row})=>row.product));
    if(!products.includes(filters.product))filters.product='';
    field('product').innerHTML='<option value="">全部细分</option>'+options(products);
    field('product').value=filters.product;
    const filtered=base.filter(({row})=>!filters.product || row.product===filters.product);
    if(root===severeRoot){renderSevere(filtered);return;}
    const visibleVersions=filters.version?[filters.version]:versions.filter(v=>!filters.product || filtered.some(({row})=>row.version===v));
    renderMonitor(filtered,visibleVersions);
    renderRanking(filtered,visibleVersions);
  }

  rankingRoot.addEventListener('click', e => {
    const button = e.target.closest('[data-ranked-home]');
    if (!button) return;
    const {row,scope} = entries[Number(button.dataset.rankedHome)];
    onDetails(row,scope,nameFor(row,scope));
  });

  severeRoot.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-severe-home')) {
      const entry = severeRows[Number(button.dataset.severeHome)];
      if (entry) onDetails(entry.row, entry.scope, nameFor(entry.row,entry.scope));
    }
    if (button.hasAttribute('data-analysis-page')) {
      page += Number(button.dataset.analysisPage);
      render(severeRoot);
      severeRoot.querySelector('.analysis-heading').scrollIntoView({block:'start'});
    }
  });
  roots.forEach(render);
  return {setMonitorScope(scope='',version=''){
    monitorRoot.querySelector('[data-filter="scope"]').value=scope;
    monitorRoot.querySelector('[data-filter="version"]').value=version;
    monitorRoot.querySelector('[data-filter="product"]').value='';
    render(monitorRoot);
  }};
}
