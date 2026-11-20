import { lingzhiEvidence } from './inventory-hierarchy.js';

const text = value => value == null ? '' : String(value).trim();
const esc = value => text(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const VIEWS = { properties:'房源', businesses:'商圈', communities:'小区' };
const BEDROOMS = {'1':'1 居','2':'2 居','3+':'3 居及以上',shared:'合租单间',unknown:'居室待分类'};
const PAGE_SIZE = 10;
let explorerSequence = 0;

function number(value, fallback='—') {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;
}

function dateLabel(value) {
  if (!value) return '采样日期待核验';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll('-', '.');
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN', {timeZone:'Asia/Shanghai'}) : '采样日期待核验';
}

/** Read-only navigation over the complete collected inventory. No source request is made here. */
export class InventoryExplorer {
  constructor(container, {hierarchy, onProperty, onTwin, onHousehold, onReferences}={}) {
    if (!container) throw new TypeError('An inventory explorer container is required.');
    this.container = container;
    this.callbacks = {onProperty, onTwin, onHousehold, onReferences};
    this.hierarchy = hierarchy || {rows:[], businesses:[], communities:[], totals:{}};
    this.state = {view:'properties', businessKey:'', communityKey:'', bedroomGroup:'', query:''};
    this.page = 1;
    this.uid = 'ivx-' + (++explorerSequence);
    this.abort = new AbortController();
    this.renderShell();
    this.bind();
    this.render();
  }

  renderShell() {
    this.container.innerHTML = `<section class="ivx" aria-labelledby="${this.uid}-title">
      <header class="ivx-header"><div><p class="ivx-eyebrow">BEIJING OPERATIONS INVENTORY</p><h2 id="${this.uid}-title" tabindex="-1">房源、商圈、小区，逐级查看。</h2><p>从已采集房源进入详情，联查三维资料与智能设备。</p></div><span class="ivx-scope-label">北京 · 累计收录</span></header>
      <div class="ivx-navigation"><div class="ivx-views" role="group" aria-label="选择房源数据维度">${Object.entries(VIEWS).map(([key,label])=>`<button type="button" data-iv-action="view" data-iv-key="${key}" aria-pressed="${key===this.state.view}">${label}</button>`).join('')}</div><button type="button" class="ivx-reset" data-iv-action="reset">查看全部房源</button></div>
      <nav class="ivx-breadcrumb" aria-label="房源分级路径" data-iv-ref="breadcrumb"></nav>
      <div class="ivx-toolbar"><label class="ivx-search" for="${this.uid}-search"><span>搜索房源</span><input id="${this.uid}-search" type="search" placeholder="小区、商圈、房源编号或挂牌号" autocomplete="off" data-iv-ref="search"></label><label class="ivx-bedroom" for="${this.uid}-bedroom"><span>居室分类</span><select id="${this.uid}-bedroom" data-iv-ref="bedroom"><option value="">全部居室</option>${Object.entries(BEDROOMS).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label></div>
      <div class="ivx-results-head"><h3 data-iv-ref="resultTitle" tabindex="-1"></h3><p class="ivx-result-count" data-iv-ref="summary" role="status" aria-live="polite"></p></div>
      <div data-iv-ref="results"></div><footer class="ivx-footer" data-iv-ref="footer"></footer>
    </section>`;
    this.elements = Object.fromEntries([...this.container.querySelectorAll('[data-iv-ref]')].map(element=>[element.dataset.ivRef, element]));
  }

  bind() {
    const options = {signal:this.abort.signal};
    this.container.addEventListener('click', event=>{
      const button = event.target.closest?.('[data-iv-action]');
      if (!button || !this.container.contains(button) || button.disabled) return;
      const action = button.dataset.ivAction, key = button.dataset.ivKey || '';
      if (action === 'property' || action === 'twin' || action === 'household' || action === 'references') {
        if (!this.rows.some(row=>row.id===key)) return;
        const callback = {property:'onProperty',twin:'onTwin',household:'onHousehold',references:'onReferences'}[action];
        this.callbacks[callback]?.(key);
        return;
      }
      if (action === 'page') {
        this.page += key === 'next' ? 1 : -1;
        this.render();
        this.elements.resultTitle.focus({preventScroll:true});
        this.elements.resultTitle.scrollIntoView({block:'center'});
        return;
      }
      if (action === 'reset' || action === 'root') this.state = {view:'properties',businessKey:'',communityKey:'',bedroomGroup:'',query:''};
      else if (action === 'view' && VIEWS[key]) {
        this.state.view = key;
        if (key === 'businesses') {this.state.businessKey=''; this.state.communityKey='';}
        if (key === 'communities') this.state.communityKey='';
      } else if (action === 'business' || action === 'business-properties') {
        if (!this.rows.some(row=>row.businessKey===key)) return;
        this.state.businessKey = key; this.state.communityKey = '';
        this.state.view = action==='business' ? 'communities' : 'properties';
      } else if (action === 'community') {
        if (!this.rows.some(row=>row.communityKey===key)) return;
        this.state.communityKey = key; this.state.view = 'properties';
      } else if (action === 'business-parent') {
        this.state.communityKey=''; this.state.view='communities';
      } else if (action === 'all-businesses') {
        this.state.businessKey=''; this.state.communityKey=''; this.state.view='businesses';
      } else return;
      this.page=1; this.syncControls(); this.render();
      this.elements.resultTitle.focus({preventScroll:true});
    }, options);
    this.elements.search.addEventListener('input', ()=>{this.state.query=this.elements.search.value; this.page=1; this.render();}, options);
    this.elements.bedroom.addEventListener('change', ()=>{this.state.bedroomGroup=this.elements.bedroom.value; this.page=1; this.render();}, options);
  }

  get rows() {return Array.isArray(this.hierarchy?.rows) ? this.hierarchy.rows : [];}

  update(hierarchy) {
    this.hierarchy = hierarchy || {rows:[],businesses:[],communities:[],totals:{}};
    if (this.state.businessKey && !this.rows.some(row=>row.businessKey===this.state.businessKey)) {this.state.businessKey='';this.state.communityKey='';}
    if (this.state.communityKey && !this.rows.some(row=>row.communityKey===this.state.communityKey)) this.state.communityKey='';
    this.render();
  }

  open(options={}) {
    this.page=1;
    this.state = {view:VIEWS[options.view]?options.view:'properties',businessKey:text(options.businessKey),communityKey:text(options.communityKey),bedroomGroup:BEDROOMS[options.bedroomGroup]?options.bedroomGroup:'',query:text(options.query)};
    this.syncControls(); this.update(this.hierarchy);
    this.container.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    this.elements.resultTitle.focus({preventScroll:true});
  }

  syncControls() {
    this.elements.search.value = this.state.query;
    this.elements.bedroom.value = this.state.bedroomGroup;
  }

  filteredRows() {
    const {businessKey,communityKey,bedroomGroup,query}=this.state, search=text(query).toLocaleLowerCase();
    return this.rows.filter(row=>(!businessKey || row.businessKey===businessKey)
      && (!communityKey || row.communityKey===communityKey)
      && (!bedroomGroup || row.bedroomGroup===bedroomGroup)
      && (!search || [row.communityName,row.businessName,row.businessCandidate,row.district,row.id,row.realListingId,row.property?.businessId,row.property?.listingLabel,row.property?.product,row.property?.station,row.property?.lingzhiLabelVisible?'灵之智能':''].some(value=>text(value).toLocaleLowerCase().includes(search))));
  }

  groups(rows, type) {
    const keyName=type==='businesses'?'businessKey':'communityKey', result=new Map();
    for(const row of rows) {
      const key=text(row[keyName]), current=result.get(key);
      if(current)current.rows.push(row);
      else result.set(key,{key,label:type==='businesses'?row.businessName:row.communityName,verified:type==='businesses'?row.businessVerified:true,district:row.district,rows:[row]});
    }
    return [...result.values()].sort((a,b)=>Number(b.verified)-Number(a.verified)||text(a.label).localeCompare(text(b.label),'zh-CN'));
  }

  renderBreadcrumb() {
    const {view,businessKey,communityKey}=this.state;
    const business=this.rows.find(row=>row.businessKey===businessKey), community=this.rows.find(row=>row.communityKey===communityKey);
    let html='<button type="button" data-iv-action="root">北京</button>';
    if(business)html+=`<span aria-hidden="true">/</span><button type="button" data-iv-action="all-businesses">商圈</button><span aria-hidden="true">/</span><button type="button" data-iv-action="business-parent" ${!community?'aria-current="page"':''}>${esc(business.businessName)}</button>`;
    if(community)html+=`<span aria-hidden="true">/</span><span aria-current="page">${esc(community.communityName)}</span>`;
    if(!business&&!community)html+=`<span aria-hidden="true">/</span><span aria-current="page">全部${VIEWS[view]}</span>`;
    this.elements.breadcrumb.innerHTML=html;
  }

  render() {
    const rows=this.filteredRows(), businesses=this.groups(rows,'businesses'), communities=this.groups(rows,'communities');
    const confirmed=businesses.filter(group=>group.verified).length, pending=rows.filter(row=>!row.businessVerified).length;
    const headings={properties:'已采集房源清单',businesses:'按商圈查看房源',communities:'按小区查看房源'};
    this.elements.resultTitle.textContent=headings[this.state.view];
    this.elements.summary.textContent=`当前 ${rows.length} 条房源 · ${confirmed} 个已确认商圈${pending?' · '+pending+' 条商圈待核验':''} · ${communities.length} 个小区`;
    for(const button of this.container.querySelectorAll('[data-iv-action="view"]'))button.setAttribute('aria-pressed',String(button.dataset.ivKey===this.state.view));
    this.renderBreadcrumb();
    const items=this.state.view==='properties'?rows:this.state.view==='businesses'?businesses:communities;
    const pages=Math.ceil(items.length/PAGE_SIZE);
    this.page=Math.max(1, Math.min(this.page, pages));
    const start=(this.page-1)*PAGE_SIZE, visible=items.slice(start, start+PAGE_SIZE);
    const pager=pages>1?`<nav class="property-pagination" aria-label="分级台账分页"><span class="pagination-summary">显示第 ${start+1}–${start+visible.length} 项，共 ${items.length} 项</span><div class="pagination-actions"><button class="button" type="button" data-iv-action="page" data-iv-key="previous" ${this.page===1?'disabled':''}>上一页</button><span>第 ${this.page} / ${pages} 页</span><button class="button" type="button" data-iv-action="page" data-iv-key="next" ${this.page===pages?'disabled':''}>下一页</button></div></nav>`:'';
    this.elements.results.innerHTML=rows.length?(this.state.view==='properties'?this.propertyTable(visible):this.groupCards(visible))+pager:'<div class="ivx-empty"><h4>当前条件下没有房源</h4><p>可调整关键词、居室或分级范围，查看已收录记录。</p><button type="button" data-iv-action="reset" class="ivx-button">查看全部房源</button></div>';
    this.elements.footer.textContent=`数据范围：已采集收录 ${this.rows.length} 条，非北京全量。采样日期：${dateLabel(this.hierarchy.observedAt)}。商圈待核验记录单独保留；设备配置与实际运行状态分别呈现。`;
  }

  groupCards(groups) {
    const businessView=this.state.view==='businesses';
    return `<div class="ivx-groups">${groups.map(group=>{
      const count=group.rows.length, communityCount=new Set(group.rows.map(row=>row.communityKey)).size;
      const modelCount=group.rows.filter(row=>row.referenceReady).length;
      const pendingEvents=group.rows.reduce((sum,row)=>sum+(Array.isArray(row.pendingEvents)?row.pendingEvents.length:0),0);
      const districts=[...new Set(group.rows.map(row=>text(row.district)).filter(Boolean))];
      const label=businessView&&!group.verified?'商圈归属待核验':businessView?'已确认商圈':`${text(group.district)||'区域待核验'} · 小区`;
      const nextAction=businessView?'business':'community';
      return `<article class="ivx-group-card${businessView&&!group.verified?' ivx-group-pending':''}"><div class="ivx-group-top"><span>${esc(label)}</span>${pendingEvents?`<span class="ivx-tag ivx-tag-warning">演示待办 ${pendingEvents}</span>`:''}</div><h4>${esc(group.label||'名称待核验')}</h4><p class="ivx-group-location">${esc(businessView?(districts.join(' / ')||'区域待核验'):[...new Set(group.rows.map(row=>row.businessName))].join(' / '))}</p><div class="ivx-group-metrics"><div><strong>${count}</strong><span>条房源</span></div>${businessView?`<div><strong>${communityCount}</strong><span>个小区</span></div>`:''}<div><strong>${modelCount}</strong><span>套有三维参考</span></div></div>${businessView&&!group.verified?'<p class="ivx-group-note">保留全部待核验房源；地铁周边候选不计入已确认商圈。</p>':''}<div class="ivx-group-actions"><button type="button" class="ivx-button ivx-button-primary" data-iv-action="${nextAction}" data-iv-key="${esc(group.key)}" aria-label="${esc(businessView?'查看'+group.label+'的小区':'查看'+group.label+'的房源')}">${businessView?'查看小区':'查看房源'}</button>${businessView?`<button type="button" class="ivx-button" data-iv-action="business-properties" data-iv-key="${esc(group.key)}" aria-label="查看${esc(group.label)}全部房源">全部房源</button>`:''}</div></article>`;
    }).join('')}</div>`;
  }

  propertyTable(rows) {
    return `<div class="ivx-table-wrap"><table class="ivx-table"><caption class="ivx-sr-only">当前筛选房源，以及对应详情、三维和设备入口</caption><thead><tr><th scope="col">房源 / 小区</th><th scope="col">商圈 / 区域</th><th scope="col">居室 / 面积</th><th scope="col">资料与设备</th><th scope="col">查看详情</th></tr></thead><tbody>${rows.map(row=>{
      const property=row.property||{}, pending=Array.isArray(row.pendingEvents)?row.pendingEvents.length:0;
      const floor=typeof property.floor==='number'&&typeof property.totalFloors==='number'?`${property.floor}/${property.totalFloors} 层`:'楼层待核验';
      const room=BEDROOMS[row.bedroomGroup]||BEDROOMS.unknown;
      const evidence=lingzhiEvidence(property);
      return `<tr><td data-label="房源 / 小区"><strong class="ivx-property-name">${esc(row.communityName)}${property.roomLabel?' · '+esc(property.roomLabel):''}</strong><span class="ivx-meta">${esc(property.product||'产品标签待核验')}</span><span class="ivx-meta">${row.realListingId?'挂牌号 '+esc(row.realListingId):'采集记录 '+esc(row.id)}</span>${property.businessId?`<span class="ivx-meta">房源编号 ${esc(property.businessId)}</span>`:''}${evidence?`<span class="ivx-meta">${esc(evidence)}</span>`:''}</td><td data-label="商圈 / 区域"><button type="button" class="ivx-inline-link" data-iv-action="business" data-iv-key="${esc(row.businessKey)}" aria-label="按${esc(row.businessName)}查看小区">${esc(row.businessName)}</button><span class="ivx-meta">北京 · ${esc(row.district||'区域待核验')}</span>${!row.businessVerified&&row.businessCandidate?`<span class="ivx-candidate">参考片区：${esc(row.businessCandidate)}</span>`:''}</td><td data-label="居室 / 面积"><span>${esc(room)}</span><span class="ivx-meta">${property.areaScope==='listed_bedroom'?'卧室 ':''}${number(property.area)}㎡ · ${esc(floor)}</span></td><td data-label="资料与设备"><div class="ivx-tags"><span class="ivx-tag ${row.referenceReady?'ivx-tag-ready':''}">${row.referenceReady?'有三维参考':row.publicFloorplanUrl?'有官网户型图 · 可查看':'户型待补'}</span><span class="ivx-tag">${row.vrVerified?'原始 VR 已核验':'原始 VR 待补'}</span></div><span class="ivx-meta">${row.deviceInstallationVerified?'设备实装已核验':'设备配置可查看 · 实装待核验'}</span>${pending?`<span class="ivx-event-note">${pending} 条演示待办</span>`:''}</td><td data-label="查看详情"><div class="ivx-row-actions"><button type="button" class="ivx-button" data-iv-action="property" data-iv-key="${esc(row.id)}" aria-label="查看${esc(row.communityName)}${property.roomLabel?' '+esc(property.roomLabel):''}房源详情">房源详情</button><button type="button" class="ivx-button ivx-button-primary" data-iv-action="twin" data-iv-key="${esc(row.id)}" aria-label="查看${esc(row.communityName)}${property.roomLabel?' '+esc(property.roomLabel):''}三维 VR 与设备情况">3D / VR · 设备</button></div></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  destroy() {this.abort.abort();this.container.replaceChildren();}
}
