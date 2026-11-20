const pageSize = 5;
const collator = new Intl.Collator('zh-CN', {numeric:true});

const normalize = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();
const joinFacts = values => values.filter(value => typeof value === 'string' && value.trim()).join(' · ');

function listingFacts(property) {
  const layout = property.layout || (property.bedrooms ? property.bedrooms+'居' : '');
  const area = Number.isFinite(property.area) && property.area>0 ?
    (property.areaScope==='listed_bedroom' ? '卧室 ' : '')+property.area+'㎡' : property.areaDisplay;
  const floor=Number.isFinite(property.floor) ? (Number.isFinite(property.totalFloors)
    ? property.floor+'/'+property.totalFloors+'层' : property.floor+'层') : '';
  const orientation=property.orientation && !property.orientation.startsWith('朝')
    ? '朝'+property.orientation : property.orientation;
  return joinFacts([layout,property.roomLabel,area,floor,orientation]);
}

function indexedListing(entry) {
  const p=entry.property;
  const identifiers=[entry.id,p.realListingId,p.businessId,p.officialHouseCode].filter(Boolean).map(normalize);
  const district=entry.district || '';
  const business=p.businessArea || (entry.businessLabel || '').split('（')[0];
  const names=[entry.name,business].filter(Boolean).map(normalize);
  const room=String(p.roomLabel || '').match(/^(\d+)卧$/);
  const bedrooms=Number(p.bedrooms);
  const parts=[...identifiers,...names,district,district && !district.endsWith('区') ? district+'区' : '',
    p.listingLabel,p.layout,p.roomLabel,listingFacts(p)];
  if (room) parts.push('卧室'+room[1], '卧室'+Number(room[1]),Number(room[1])+'卧');
  if (bedrooms>0) parts.push(bedrooms+'居',bedrooms+'室');
  if (bedrooms>=1 && bedrooms<=9) parts.push('一二三四五六七八九'[bedrooms-1]+'居');
  return {entry,identifiers,names,fields:parts.filter(Boolean).map(normalize)};
}

function findListings(index, input) {
  const query=normalize(input);
  const words=query.split(/[\s·,，/、]+/).filter(Boolean);
  if (!words.length) return [];
  const compact=words.join('');
  const ranked=[];
  for (const row of index) {
    let rank;
    if (row.identifiers.includes(compact)) rank=0;
    else if (!words.every(word=>row.fields.some(field=>field.includes(word)))) continue;
    else if (row.names.includes(query)) rank=1;
    else if (row.identifiers.some(id=>id.startsWith(compact))) rank=2;
    else rank=3;
    ranked.push({row,rank});
  }
  return ranked.sort((a,b)=>a.rank-b.rank || collator.compare(a.row.entry.name,b.row.entry.name) ||
    collator.compare(a.row.entry.id,b.row.entry.id)).map(hit=>hit.row.entry);
}

export function mountMapListingSearch(container, {getEntries,onLocate}) {
  const events=new AbortController();
  const listen=(el,event,handler)=>el.addEventListener(event,handler,{signal:events.signal});
  container.classList.add('map-listing-search');
  const prefix=container.id || 'map-listing-search';
  container.innerHTML=`
    <div class="map-find-field">
      <label for="${prefix}-input">地图找房</label>
      <input id="${prefix}-input" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false"
        aria-controls="${prefix}-list" autocomplete="off" spellcheck="false" placeholder="输入挂牌号、业务编号、小区或商圈">
      <button type="button" class="map-find-clear" aria-label="清除找房关键词" hidden>清除</button>
    </div>
    <div class="map-find-menu" hidden>
      <div class="map-find-status" role="status"></div>
      <div class="map-find-list" id="${prefix}-list" role="listbox" aria-label="匹配房源"></div>
      <div class="map-find-paging" hidden>
        <button type="button" data-map-search-page="-1" aria-label="上一页房源">上一页</button>
        <button type="button" data-map-search-page="1" aria-label="下一页房源">下一页</button>
      </div>
    </div>`;
  const input=container.querySelector('input');
  const clear=container.querySelector('.map-find-clear');
  const menu=container.querySelector('.map-find-menu');
  const status=container.querySelector('.map-find-status');
  const list=container.querySelector('.map-find-list');
  const paging=container.querySelector('.map-find-paging');
  const prev=paging.firstElementChild;
  const next=paging.lastElementChild;
  let previousEntries, index=[], results=[], offset=0, active=-1, composing=false;

  function hide() {
    menu.hidden=true;
    input.setAttribute('aria-expanded','false');
    input.removeAttribute('aria-activedescendant');
    active=-1;
  }
  function close() {
    hide();
    input.value='';
    clear.hidden=true;
    results=[];
    list.replaceChildren();
  }
  function render() {
    list.replaceChildren();
    const total=results.length;
    const end=Math.min(offset+pageSize,total);
    status.textContent=total ? (total>pageSize ? `共 ${total} 套，显示第 ${offset+1}–${end} 套` : `找到 ${total} 套房源`) : '没有匹配的房源，请调整关键词或地图数据范围。';
    for(let item=offset;item<end;item++){
      const {id,name,district,businessLabel,property:p}=results[item];
      const button=document.createElement('button');
      button.type='button';
      button.tabIndex=-1;
      button.dataset.mapSearchId=id;
      button.id=prefix+'-option-'+item;
      button.setAttribute('role','option');
      button.setAttribute('aria-selected',String(item===active));
      const title=document.createElement('strong');
      title.textContent=name;
      const code=document.createElement('span');
      code.className='map-find-id';
      code.textContent=(p.realListingId ? '挂牌 ' : '记录 ')+(p.realListingId || id);
      const details=document.createElement('small');
      const codes=[...new Set([p.officialHouseCode,p.businessId].filter(Boolean))].join(' · ');
      details.textContent=joinFacts([district,p.businessArea || (businessLabel || '').split('（')[0],listingFacts(p),codes]);
      button.append(title,code,details);
      list.append(button);
    }
    paging.hidden=total<=pageSize;
    prev.disabled=offset===0;
    next.disabled=end===total;
    menu.hidden=false;
    input.setAttribute('aria-expanded','true');
    if (active>=0) {
      input.setAttribute('aria-activedescendant',prefix+'-option-'+active);
      const row=list.children[active-offset].getBoundingClientRect();
      const clip=list.getBoundingClientRect();
      if(row.top<clip.top)list.scrollTop+=row.top-clip.top;
      else if(row.bottom>clip.bottom)list.scrollTop+=row.bottom-clip.bottom;
    } else input.removeAttribute('aria-activedescendant');
  }
  function search() {
    clear.hidden=!input.value;
    if(!normalize(input.value)){ hide();return; }
    const entries=getEntries() || [];
    if(entries!==previousEntries){
      previousEntries=entries;
      index=entries.map(indexedListing);
    }
    results=findListings(index,input.value);
    active=-1;offset=0;
    render();
  }
  function locate(id) {
    if (!getEntries()?.some(entry=>entry.id===id)) { search();return; }
    close();
    onLocate(id);
  }
  function changePage(delta) {
    if ((delta<0 && prev.disabled) || (delta>0 && next.disabled)) return;
    offset+=delta*pageSize;
    active=-1;
    input.focus({preventScroll:true});
    render();
  }

  listen(input,'compositionstart',()=>{composing=true;});
  listen(input,'compositionend',()=>{composing=false;search();});
  listen(input,'input',event=>{if(!composing && !event.isComposing)search();});
  listen(input,'focus',()=>{if(menu.hidden && !composing && input.value)search();});
  listen(input,'click',()=>{if(menu.hidden && !composing && input.value)search();});
  listen(input,'keydown',event=>{
    if(composing || event.isComposing || event.keyCode===229) return;
    if(event.key==='Escape' && !menu.hidden) { event.preventDefault();hide();return; }
    if (!['ArrowDown','ArrowUp','PageDown','PageUp','Enter'].includes(event.key) || !normalize(input.value)) return;
    if (menu.hidden) search();
    if (!results.length) return;
    event.preventDefault();
    if(event.key==='Enter'){locate(results[active<0 ? offset : active].id);return;}
    if(event.key==='PageDown' || event.key==='PageUp'){changePage(event.key==='PageDown'?1:-1);return;}
    active=active<0 ? (event.key==='ArrowDown'?offset:Math.min(offset+pageSize,results.length)-1)
      : Math.max(0,Math.min(results.length-1,active+(event.key==='ArrowDown'?1:-1)));
    offset=Math.floor(active/pageSize)*pageSize;
    render();
  });
  listen(list,'click',event=>{
    const match=event.target.closest('[data-map-search-id]');
    if(match && list.contains(match))locate(match.dataset.mapSearchId);
  });
  listen(paging,'click',event=>{
    const button=event.target.closest('[data-map-search-page]');
    if(button && !button.disabled)changePage(Number(button.dataset.mapSearchPage));
  });
  listen(clear,'click',()=>{close();input.focus();});
  listen(container,'focusout',event=>{if(event.relatedTarget && !container.contains(event.relatedTarget))hide();});
  listen(document,'pointerdown',event=>{if(!menu.hidden && !container.contains(event.target))hide();});
  return {close,destroy(){events.abort();container.replaceChildren();container.classList.remove('map-listing-search');}};
}
