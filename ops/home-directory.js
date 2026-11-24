import { houseEvents, occupancyLabels as states } from './house-events.js?v=20261124-cohorts';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s+/g,'').toUpperCase();
const format = new Intl.NumberFormat('zh-CN').format;
const pageSize = 15;

function eventText(row) {
  const events=houseEvents(row);
  if(!events.length)return '本期未列出异常项';
  const lines=events.map(event=>[event.name,event.measure].filter(Boolean).join(' · '));
  if(lines.length===1)return esc(lines[0]);
  return `<details class="directory-events"><summary>${esc(lines[0])}<small>共 ${lines.length} 项</small></summary><ul>${lines.slice(1).map(line=>'<li>'+esc(line)+'</li>').join('')}</ul></details>`;
}

export function mountHomeDirectory(root,snapshot,directory,onDetails) {
  const data=directory?.date===snapshot.date?directory:null;
  const entries=[];
  for(const [scope,group] of [['rental',snapshot.vacant],['occupied',snapshot.occupied]]){
    for(const row of group.rows){
      const info=data?.[scope]?.[row.operationsKey];
      entries.push({row,scope,info,code:normalize(info?.code),place:normalize([info?.address,row.areaLabel,row.mapId?row.name:'',row.communityRef?.name].filter(Boolean).join(' '))});
    }
  }
  const versions=[...new Set(entries.map(e=>e.row.version).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}));
  const existingForm=root.querySelector('form');
  const initial=existingForm?new URLSearchParams(new FormData(existingForm)):new URLSearchParams(location.search);
  root.innerHTML=`<section class="health-block directory-block">
    <form class="health-filters directory-filters" role="search" aria-label="检索北京房源">
      <label>健康等级<select name="level"><option value="">全部等级</option>${snapshot.levels.map((grade,i)=>`<option value="${i}">${esc(grade)}</option>`).join('')}</select></label>
      <label>入住状态<select name="scope"><option value="">全部入住状态</option><option value="rental">${states.rental}</option><option value="occupied">已入住</option></select></label>
      <label>房源产品版本<select name="version"><option value="">全部版本</option>${versions.map(v=>`<option>${esc(v)}</option>`).join('')}</select></label>
      <label>小区名字<input name="community" type="search" placeholder="输入小区名称" autocomplete="off"></label>
      <label>房源编号<input name="code" type="search" placeholder="输入全部或部分编号" autocomplete="off" spellcheck="false"></label>
      <button class="text-btn" type="reset">清空条件</button>
    </form>${data?'':'<p class="analysis-note">本期地址、房源编号与服务管家明细尚未载入。</p>'}
    <p data-search-summary role="status"></p><div data-search-results></div>
    <div class="health-pager"><button class="button" type="button" data-step="-1">上一页</button><span data-search-page></span><button class="button" type="button" data-step="1">下一页</button></div></section>`;
  const form=root.querySelector('form'),results=root.querySelector('[data-search-results]');
  for(const field of ['level','scope','version','community','code']){
    if(initial.has(field))form.elements.namedItem(field).value=initial.get(field);
  }
  let page=Math.max(0,(Number(new URLSearchParams(location.search).get('page')) || 1)-1),matches=[];
  function render(){
    const f=form.elements, community=normalize(f.community.value), code=normalize(f.code.value);
    matches=entries.filter(entry=>
      (!f.level.value || entry.row.level===Number(f.level.value)) &&
      (!f.scope.value || entry.scope===f.scope.value) && (!f.version.value || entry.row.version===f.version.value) &&
      (!community || entry.place.includes(community)) && (!code || entry.code.includes(code)));
    const pages=Math.max(1,Math.ceil(matches.length/pageSize));
    page=Math.min(page,pages-1);
    const homes=new Set(matches.map(e=>e.row.homeKey));
    root.querySelector('[data-search-summary]').textContent='匹配 '+format(homes.size)+' 套房源';
    const fields=['城市','房源产品版本','房源地址','服务管家','健康等级','房源异常项'];
    results.innerHTML=matches.length?`<table class="directory-table"><thead><tr>${fields.map(v=>'<th scope="col">'+v+'</th>').join('')}</tr></thead><tbody>${matches.slice(page*pageSize,(page+1)*pageSize).map(({row,scope,info},i)=>{
      const values=[
        esc(info?.city || '北京'),
        '<strong>'+esc(row.version)+'</strong><small>'+esc(states[scope])+(row.inBothSources?' · 两份明细均有记录':'')+(row.product && row.version!==row.product?' · '+esc(row.product):'')+'</small>',
        `<button type="button" class="directory-address" data-directory-home="${page*pageSize+i}" aria-label="查看${esc(info?.address || info?.code || '本套房源')}的详情">${esc(info?.address || '-')}</button>${info?.code?'<small>'+esc(info.code)+'</small>':''}`,
        esc(info?.manager || '-'),`<span class="listing-health" data-grade="${row.level===0?'healthy':'P'+row.level}">${esc(snapshot.levels[row.level])}</span>`,
        eventText(row)
      ];
      return '<tr>'+values.map((v,i)=>`<td data-label="${fields[i]}">${v}</td>`).join('')+'</tr>';
    }).join('')}</tbody></table>`:'<p class="analysis-empty">没有符合这些条件的房源。</p>';
    root.querySelector('[data-search-page]').textContent='第 '+(page+1)+' / '+pages+' 页';
    root.querySelector('[data-step="-1"]').disabled=page===0;
    root.querySelector('[data-step="1"]').disabled=page===pages-1;
    root.querySelector('.health-pager').hidden=matches.length===0;
  }
  function firstPage(){page=0;render();}
  form.addEventListener('input',firstPage);
  form.addEventListener('submit',e=>{e.preventDefault();firstPage();});
  form.addEventListener('reset',event=>{
    event.preventDefault();
    for(const field of form.querySelectorAll('input,select'))field.value='';
    firstPage();
  });
  root.addEventListener('click',e=>{
    const button=e.target.closest('button');
    if(!button)return;
    if(button.hasAttribute('data-step')){
      page+=Number(button.dataset.step);render();
      root.querySelector('[data-search-summary]').scrollIntoView({block:'start'});
    }else if(button.hasAttribute('data-directory-home')){
      const {row,scope,info}=matches[Number(button.dataset.directoryHome)];
      onDetails(row,scope,info);
    }
  });
  render();
}
