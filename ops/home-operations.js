import { listingBasics } from './listing-basics.js';
import { verifiedFloorplanUrl } from './listing-plan-viewer.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));

function reading(label, value, unit) {
  const valid = Number.isFinite(value);
  const meter = valid && unit === '%' ? `<meter min="0" max="100" value="${value}" aria-label="${label}"></meter>` : '';
  return `<div><dt>${label}</dt><dd>${valid ? value+unit : '未提供'}</dd>${meter}</div>`;
}

// Without verified room geometry, keep events at the scope reported by the household snapshot.
export function renderOperationsStage(stage, {property,row,date,grade,event,plan,onPlan,onSource}) {
  const image = verifiedFloorplanUrl(property,plan);
  const basics = listingBasics(property);
  const facts = basics.facts.filter(fact=>fact.value).map(fact=>esc(fact.label)+' '+esc(fact.value)).join(' · ');
  stage.innerHTML = `<div class="home-stage-grid">
    <div class="home-stage-data">
      <div class="home-stage-title"><h3>${event ? esc(event.name) : '运行概况'}</h3>${grade?`<span class="listing-health" data-grade="${esc(grade.split(' ')[0].replace('健康房源','healthy'))}">${esc(grade)}</span>`:''}</div>
      ${event ? `<p class="home-stage-event" role="status">${esc(event.category)} · ${esc(event.measure)} · 房源级记录</p>` : ''}
      ${row ? `<small>${esc(date)} 健康快照</small><dl class="home-readings">${reading('网关在线率',row.gateway,'%')}${reading('设备在线率',row.devices,'%')}${reading('安全事件天数',row.events,' 天')}</dl>` : '<p>本期暂无已核验的房源健康明细。</p>'}
      ${facts?`<p>${facts}</p>`:''}
      <p>${image ? '空间资料来自本套房源的官网户型图。' : '本套户型与房间设备点位待核验。'}</p>
      ${basics.sourceUrl ? '<button class="button" type="button" data-missing-source>查看本套来源资料</button>' : ''}
    </div>
    ${image ? `<button class="home-plan-image" type="button" data-open-plan><img src="${esc(image)}" alt="本套官网户型图"><span>打开户型与设备</span></button>` : ''}
  </div>`;
  const preview=stage.querySelector('[data-open-plan]');
  if(preview){
    preview.onclick=onPlan;
    preview.querySelector('img').onerror=e=>{e.target.hidden=true;};
  }
  const source=stage.querySelector('[data-missing-source]');
  if(source)source.onclick=onSource;
}
