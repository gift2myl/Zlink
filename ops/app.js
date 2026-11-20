import { SceneViewer } from './scene-viewer.js';
import { PropertyMapWorkspace } from './property-map-workspace.js';
import { HouseholdWorkspace } from './household-workspace.js';
import { inventoryStatistics, housingGroup, mergeCollectedProperties, listingIdentity } from './inventory-statistics.js';

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PROPERTY_PAGE_SIZE=24;
const MODEL_PROPERTY_ID='810151211';
const textValue=(v,fallback='')=>typeof v==='string'||typeof v==='number'?String(v).trim():fallback;
const finiteNumber=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
const countValue=v=>Math.max(0,Math.trunc(finiteNumber(v)||0));
function safeUrl(value){try{if(typeof value!=='string'||!value.trim())return null;const u=new URL(value,'https://www.ziroom.com/');return ['http:','https:'].includes(u.protocol)?u.href:null;}catch{return null;}}
function normalizeDistrict(value){const s=textValue(value).replace(/^北京市/,'');if(!s)return null;if(['亦庄开发区','北京经济技术开发区','经济技术开发区','经开区'].includes(s))return '亦庄开发区';return s.replace(/[区县]$/,'');}
function normalizeCoordinate(value){if(!Array.isArray(value)||value.length!==2)return null;const p=value.map(finiteNumber);return p.every(Number.isFinite)&&p[0]>=115&&p[0]<=118&&p[1]>=39&&p[1]<=42?p:null;}
function normalizeProperty(raw,kind='historical',observedAt=null){
 if(!raw||typeof raw!=='object')return null;
 const id=textValue(raw.id),name=textValue(raw.name||raw.listingLabel);if(!id||!name)return null;
 const coordinate=normalizeCoordinate(raw.coordinate),imported=kind==='imported';
 return {...raw,id,name,district:normalizeDistrict(raw.district),area:finiteNumber(raw.area),bedrooms:finiteNumber(raw.bedrooms),floor:finiteNumber(raw.floor),totalFloors:finiteNumber(raw.totalFloors),distance:finiteNumber(raw.distance),station:textValue(raw.station)||null,product:textValue(raw.product)||null,roomLabel:textValue(raw.roomLabel)||null,listingLabel:textValue(raw.listingLabel)||null,sourceUrl:safeUrl(raw.sourceUrl),coordinate,coordinateSystem:textValue(raw.coordinateSystem)||null,coordinateStatus:coordinate?(raw.coordinateStatus==='verified'?'verified':'unverified'):'missing',modelReady:!imported&&id===MODEL_PROPERTY_ID,imported,sourceKind:kind,observedAt:textValue(raw.observedAt||raw.importedAt||observedAt)||null};
}
function normalizeProperties(rows,kind,observedAt){const m=new Map();for(const raw of Array.isArray(rows)?rows:[]){const p=normalizeProperty(raw,kind,observedAt);if(p)m.set(p.id,p);}return [...m.values()];}
function formatObservedAt(value){const s=textValue(value);if(!s)return '时间未提供';if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s.replaceAll('-','.');const d=new Date(s);return Number.isFinite(d.getTime())?d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):s;}
function canOpenModel(p){return !!p&&!p.imported&&p.id===MODEL_PROPERTY_ID&&p.modelReady===true;}
function propertyPage(rows,page){const pages=Math.max(1,Math.ceil(rows.length/PROPERTY_PAGE_SIZE)),current=Math.max(1,Math.min(pages,countValue(page)||1)),start=(current-1)*PROPERTY_PAGE_SIZE;return {rows:rows.slice(start,start+PROPERTY_PAGE_SIZE),current,pages,start,total:rows.length};}
async function optionalJson(name){try{const r=await fetch('./ops/assets/'+name,{cache:'no-cache'});return r.ok?await r.json():null;}catch{return null;}}
const paths={
 dashboard:'<rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/>',
 building:'<path d="M4 21V5l10-2v18M14 9h6v12M2 21h20M8 7h2M8 11h2M8 15h2M17 13h1M17 17h1M8 21v-3h2v3"/>',
 devices:'<rect x="5" y="6" width="14" height="12" rx="2"/><path d="M9 10h6v4H9zM9 3v3m6-3v3M9 18v3m6-3v3M2 10h3m-3 4h3m14-4h3m-3 4h3"/>',
 agent:'<rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M9 15h6M8 11h.1m7.9 0h.1M1 11v5m22-5v5"/><circle cx="12" cy="2.5" r=".7"/>',
 ticket:'<path d="M6 3h9l4 4v14H5V3h1Zm9 0v5h4M8 12h8m-8 4h5"/>',
 database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v6c0 4 16 4 16 0v-6"/>',
 layers:'<path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
 pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2.3"/>',
 cube:'<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 20V12M3 7l9 5 9-5M7.5 4.5l9 5"/>',
 play:'<path d="m8 4 12 8-12 8V4Z"/>',
 map:'<path d="m2 5 6-2 8 3 6-2v15l-6 2-8-3-6 2V5Zm6-2v15m8-12v15"/>',
 alert:'<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3v.1"/>',
 shield:'<path d="m12 3 9 3v6c0 6-9 10-9 10S3 18 3 12V6l9-3Z"/><path d="m8 12 3 3 5-6"/>',
 rotate:'<path d="M20 7a8 8 0 1 0 0 10M20 3v5h-5"/>',
 reset:'<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6"/>',
 expand:'<path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6"/>',
 image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m21 15-5-5L5 21"/>',
 search:'<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/>',
 upload:'<path d="M12 16V3m-5 5 5-5 5 5M3 16v5h18v-5"/>',
 download:'<path d="M12 3v13m-5-5 5 5 5-5M3 17v4h18v-4"/>',
 book:'<path d="M12 5c-4-3-8-2-10-1v16c2-1 6-2 10 1 4-3 8-2 10-1V4c-2-1-6-2-10 1Zm0 0v16"/>',
 close:'<path d="m6 6 12 12M18 6 6 18"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 network:'<path d="M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0m-9 4a4.5 4.5 0 0 1 6 0"/><circle cx="12" cy="20" r=".8"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
 battery:'<rect x="2" y="6" width="18" height="12" rx="2"/><path d="M23 10v4M5 9v6m3-6v6"/>',
 tool:'<path d="m15 6 3 3 4-4a7 7 0 0 1-9 9L5 22l-3-3 8-8a7 7 0 0 1 9-9l-4 4Z"/>',
 chart:'<path d="M3 3v18h19M7 16l4-5 4 2 6-8"/>',
 link:'<path d="m9 15 6-6M7 17l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M17 7l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 -1) scale(.9)"/>'
};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.devices}</svg>`;
function hydrateIcons(root=document){root.querySelectorAll('[data-icon]:not([data-icon-ready])').forEach(el=>{el.insertAdjacentHTML('afterbegin',icon(el.dataset.icon));el.dataset.iconReady='1';});}
hydrateIcons();
function timeNow(){return new Date().toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});}
function updateClock(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'}).replaceAll('/','.')+' '+timeNow();}
updateClock();setInterval(updateClock,1000);
let toastTimer;function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4200);}
const initialEvents=[
 {id:'EVT-DEMO-001',priority:'P1',title:'网关与关联设备离线',property:'望京路3号院',propertyId:'810151211',district:'朝阳',device:'gateway',deviceName:'演示智控网关',age:'8 分钟前',agent:'LZ-05 远程诊断工程师',status:'new',summary:'同一房源网关与两个关联设备未返回心跳，需要先核验共同链路。',evidence:[['最近心跳','演示 T−8 分钟'],['关联影响','2 个设备同步未上报'],['现场供电','尚未取得现场确认'],['租赁状态','公开页面为在租快照']]},
 {id:'EVT-DEMO-002',priority:'P2',title:'门锁电量低于阈值',property:'郁花园二里',propertyId:'map-sample-02',district:'大兴',device:'door-lock',deviceName:'演示智能门锁',age:'15 分钟前',agent:'LZ-04 设备健康监控员',status:'new',summary:'演示门锁电量 18%，需确认上报时间与现场可用性后安排更换。',evidence:[['演示电量','18%'],['演示阈值','20%'],['锁具可用性','待人工核验'],['上报采集时间','演示 T−15 分钟']]},
 {id:'EVT-DEMO-003',priority:'P2',title:'空调控制回执延迟',property:'辉煌国际',propertyId:'map-sample-07',district:'海淀',device:'bedroom-ac',deviceName:'演示空调控制器',age:'26 分钟前',agent:'LZ-05 远程诊断工程师',status:'new',summary:'演示控制指令未在设定时限内返回，需核对网络、网关与设备应答。',evidence:[['控制回执','演示等待 12 秒'],['命令状态','未确认执行结果'],['网络证据','待补充'],['现场状态','待人工核验']]},
 {id:'EVT-DEMO-004',priority:'P2',title:'传感器上报中断',property:'东方雅苑',propertyId:'map-sample-10',district:'朝阳',device:'water-sensor',deviceName:'演示水浸传感器',age:'42 分钟前',agent:'LZ-04 设备健康监控员',status:'new',summary:'演示设备未按预期上报。未上报不等于发生漏水，应先核对设备与链路。',evidence:[['上报间隔','演示超过 30 分钟'],['水浸事件','无已验证证据'],['设备在管状态','待核对'],['电池与链路','待核验']]}
];
let saved;try{saved=JSON.parse(localStorage.getItem('lingzhi-demo-v1')||'null');}catch{}
let state={page:'overview',scene:'city',eventFilter:'all',events:structuredClone(initialEvents),tickets:[],activities:[],activeEvent:null,diagnosticProgress:{},imported:[],...saved};
state.page='overview';state.scene='city';state.activeEvent=null;state.propertyPage=1;
let data,ops,geo,viewer,mapWorkspace,geography,mapSources,householdWorkspace,modelCoverage,listingInventory;let diagnosisTimer=null;
let mapInventoryScope='collected';
let crawlStatus=null,crawlSource={},historicalProperties=[],crawledProperties=[],crawledIsCurrent=false;
function initializePropertyData(base,report,dataset){
 const source=base?.source&&typeof base.source==='object'?base.source:{};
 historicalProperties=normalizeProperties(base?.properties,'historical',source.observedAt);
 crawlStatus=report&&typeof report==='object'&&report.schemaVersion===1?report:null;
 crawlSource=dataset?.source&&typeof dataset.source==='object'?dataset.source:{};
 const verified=crawlSource.filterVerified===true&&dataset?.schemaVersion===1;
 const observed=Date.parse(crawlSource.observedAt),started=Date.parse(crawlStatus?.startedAt),finished=Date.parse(crawlStatus?.finishedAt);
 crawledIsCurrent=!!(verified&&crawlStatus&&['partial','complete'].includes(crawlStatus.status)&&crawlStatus.filterVerified===true&&Number.isFinite(observed)&&Number.isFinite(started)&&Number.isFinite(finished)&&observed>=started&&observed<=finished);
 crawledProperties=dataset?.schemaVersion===1?normalizeProperties(dataset.properties,crawledIsCurrent?'crawled':'crawled-history',crawlSource.observedAt):[];
 const districts=(Array.isArray(base?.districts)?base.districts:[]).map(d=>({id:normalizeDistrict(d.name||d.id),name:normalizeDistrict(d.name||d.id),countLabel:textValue(d.countLabel,'—')})).filter(d=>d.id);
 data={source:{...source,url:safeUrl(source.url)},districts,properties:mergeCollectedProperties(historicalProperties,crawledProperties)};
 state.imported=normalizeProperties(state.imported,'imported');
}
function currentCrawlCount(){return crawledIsCurrent?Math.min(crawledProperties.length,countValue(crawlStatus?.uniqueCount)):0;}
function publicDatasetLabel(){return crawledProperties.length?(crawledIsCurrent?(crawlStatus?.retainedHistory===true?'采集台账（含历史）':'本次采集记录'):'上次成功采集记录'):'历史房源样本';}
function fullInventoryVerified(){return !!(crawledIsCurrent&&crawlStatus?.status==='complete'&&crawlStatus.filterVerified===true&&crawlStatus.isFullInventory===true&&crawlSource.isFullInventory===true&&crawledProperties.length>0&&crawledProperties.length===countValue(crawlStatus.uniqueCount));}
function crawlLabel(){if(!crawlStatus)return '采集状态未提供';if(crawlStatus.status==='blocked')return '采集受阻';if(fullInventoryVerified())return '本批次采集完成';if(crawlStatus.status==='partial'&&currentCrawlCount())return '部分采集';return '采集待核验';}
function activeImportedCount(){const ids=new Set((data?.properties||[]).map(p=>p.id));return state.imported.filter(p=>!ids.has(p.id)).length;}
function collectedStats(){return inventoryStatistics(data?.properties||[],listingInventory,geography);}
function mapLastAttempt(){return modelCoverage?.verification||{};}
function mapAddedCount(){const count=mapLastAttempt().newVerifiedListings;return Number.isInteger(count)?count:null;}
function renderInventorySummary(){
 if(!data)return;
 const stats=collectedStats(),verification=mapLastAttempt(),fetched=mapAddedCount();
 const metrics=[['properties',stats.count,'已采集收录的全部房源 · 按记录去重'],['businesses',stats.businesses,`已确认商圈 · ${stats.businessUnknown} 条房源待核验`],['communities',stats.communities,'按已采集小区名称去重'],['districts',stats.districts,`${stats.confirmedDistricts} 个已确认 · ${stats.pendingDistricts} 个归属待核验`]];
 for(const [key,number,note] of metrics){$('#metric-'+key).textContent=number;$('#metric-'+key+'-note').textContent=note;}
 const sourceUrl=safeUrl(data.source.url),status=verification.status==='blocked'?'最近补采受阻':'已收录采集结果';
 $('#inventory-source-status').innerHTML=`<span><strong>北京 · 灵之智能筛选结果</strong><span class="tag ${verification.status==='blocked'?'amber':'neutral'}">${esc(status)}</span></span><span>累计收录 ${stats.count} 条 · 最近补采新增 ${fetched===null?'—':fetched} 条 · 非北京全量</span><button class="text-btn" id="inventory-audit">统计口径</button>${sourceUrl?`<a class="text-btn" href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">自如地图 ↗</a>`:''}`;
 $('#inventory-audit').onclick=showInventoryAudit;
 $('#bedroom-summary').innerHTML=[['1','1 居'],['2','2 居'],['3+','3 居及以上'],['shared','合租单间'],['unknown','待分类']].map(([key,label])=>`<button type="button" class="bedroom-stat" data-bedroom-group="${key}" aria-label="查看${label}采集房源"><span>${label}</span><strong>${stats.bedrooms[key]}</strong><small>${key==='shared'?'按出租卧室计':'条房源记录'}</small></button>`).join('');
 $$('[data-bedroom-group]').forEach(button=>button.onclick=()=>{showPage('properties');$('#inventory-view').value='collected';$('#bedroom-select').value=button.dataset.bedroomGroup;$('#district-select').value='';$('#property-search').value='';state.propertyPage=1;renderProperties();});
}
function persist(){try{localStorage.setItem('lingzhi-demo-v1',JSON.stringify({events:state.events,tickets:state.tickets,activities:state.activities,diagnosticProgress:state.diagnosticProgress,imported:state.imported}));}catch{}}
function addActivity(title,body,kind='agent'){state.activities.unshift({title,body,kind,time:timeNow()});state.activities=state.activities.slice(0,20);persist();renderActivity();}
const agentRoles=[
 {id:'LZ-04',name:'设备健康监控员',icon:'network',task:'汇总设备异常与同户影响，区分离线、未上报和数据待核验。',result:'异常清单 · 证据时间 · 影响范围',owner:'运维业务负责人',state:'监测待办'},
 {id:'LZ-05',name:'远程诊断工程师',icon:'tool',task:'核查原因候选，给出排查顺序、预期结果和转人工条件。',result:'诊断建议单 · 证据缺口',owner:'运维技术负责人',state:'待诊断'},
 {id:'LZ-06',name:'售后工单调度员',icon:'ticket',task:'把已确认的问题变成任务，跟进责任人、时限与复验要求。',result:'工单草稿 · 升级提醒 · 回执',owner:'售后服务负责人',state:'待分派'},
 {id:'LZ-09',name:'专家经验蒸馏师',icon:'book',task:'从已复验的案例提炼规则和反例，组织专家确认与独立测试。',result:'技能草案 · 来源 · 版本记录',owner:'交付专家 / 技能维护人',state:'待沉淀'}
];

async function init(){
 try{
  const [base,operationData,boundaries,report,dataset,locationData,sourceData,coverageData,inventoryData]=await Promise.all([...['properties.json','ops-source.json','beijing.geojson'].map(async n=>{const r=await fetch('./ops/assets/'+n);if(!r.ok)throw Error(n+' 加载失败');return r.json();}),optionalJson('crawl-status.json'),optionalJson('crawled-properties.json'),optionalJson('property-geography.json'),optionalJson('map-sources.json'),optionalJson('three-source-coverage.json'),optionalJson('listing-inventory.json')]);
  ops=operationData;geo=boundaries;geography=locationData||{properties:[]};mapSources=sourceData||{};modelCoverage=coverageData;listingInventory=inventoryData;initializePropertyData(base,report,dataset);
  renderAll();
  $('#scene-labels').hidden=true;$('.scene-orientation').hidden=true;
  $('#scene-loading').lastElementChild.textContent='正在加载北京公共地图';
  mapWorkspace=new PropertyMapWorkspace($('#scene-container'),{
   properties:mapProperties(),events:state.events,geography,sources:mapSources,
   onOpenProperty:showProperty,onOpenModel:()=>showScene('apartment'),onOpenOperations:openHousehold,onEvent:openEvent,onActivateMap:()=>showScene('city'),
   onViewInventory:district=>{showPage('properties');$('#inventory-view').value=mapInventoryScope;$('#property-search').value='';$('#bedroom-select').value='';renderProperties();$('#district-select').value=district||'';state.propertyPage=1;renderPropertiesList();},
   onStatus:status=>{if(state.scene==='city')$('#scene-loading').hidden=['webgl','leaflet','failed'].includes(status.mode);}
  });
  householdWorkspace=new HouseholdWorkspace($('#household-workspace'),{
   entryContainer:$('#household-entry'),properties:allProperties(),events:state.events,tickets:state.tickets,
   onNavigate:openHousehold,onEvent:openEvent,onProperty:showProperty,
   onModel:async(id,deviceId)=>{const property=allProperties().find(p=>p.id===id);if(!canOpenModel(property))return;await showScene('apartment');if(deviceId&&state.page==='overview'&&state.scene==='apartment'){viewer?.focusDevice(deviceId);showDevice(deviceId);}}
  });
  householdWorkspace.setVisible(false);
  renderSceneLegend();
  setMapScope('collected');
  if(!state.activities.length)state.activities=[{title:'健康监控员 · 待核验事件',body:'4 条演示事件已按影响与优先级排列。',kind:'network',time:'演示初始化'},{title:'经验蒸馏师 · 资料已准备',body:'“同户多设备离线”技能草案等待专家核验。',kind:'book',time:'演示初始化'}];
  renderActivity();
 }catch(error){console.error(error);toast('资料加载失败，请刷新页面重试。');$('#scene-loading').textContent='资料未能加载，请刷新页面。';}
}
function renderAll(){renderEvents();renderActivity();renderModelTables();renderProperties();renderAgents();renderTickets();renderModelCoverage();hydrateIcons();}
function allProperties(){const m=new Map(state.imported.map(p=>[String(p.id),p]));for(const p of data?.properties||[])m.set(p.id,p);return [...m.values()].sort((a,b)=>Number(a.imported)-Number(b.imported));}
function inventoryProperties(scope='collected'){
 if(scope==='imported')return allProperties().filter(p=>p.imported);
 const rows=data?.properties||[];return scope==='model'?rows.filter(canOpenModel):rows;
}
function mapProperties(){return inventoryProperties(mapInventoryScope);}
function mapScopeNote(){return mapInventoryScope==='model'?'有三维参考的采集房源 · 非房间精确坐标':'全部已采集房源 · 小区 / 地铁参考位置';}
function setMapScope(scope){
 mapInventoryScope=scope==='model'?'model':'collected';
 $('#map-inventory-scope').value=mapInventoryScope;mapWorkspace?.closeDetail();mapWorkspace?.update(mapProperties(),state.events);
 if(state.scene==='city'){$('#scene-footnote').textContent=mapScopeNote();$('#scene-subtitle').textContent=mapInventoryScope==='model'?'已取得对应户型与照片 · 房源参考位置':'已采集房源分布 · 商圈候选另列';}
}
function inventoryMissing(row){
 if(!row)return '详细字段待补';
 const missing=[];
 if(!row.realListingId)missing.push('真实房源 ID');
 if(row.fields?.businessArea?.verified!==true)missing.push('商圈');
 if(row.fields?.district?.verified!==true)missing.push('行政区归属');
 return missing.length?missing.join('、')+'待补充':'现有字段已有来源记录';
}
function showInventoryAudit(){
 if(!data){toast('采集记录正在加载。');return;}
 const stats=collectedStats(),verification=mapLastAttempt(),audit=new Map((listingInventory?.properties||[]).map(row=>[String(row.id),row]));
 const labels={'1':'1 居','2':'2 居','3+':'3 居及以上',shared:'合租单间',unknown:'待分类'};
 showModal('运维中房源 · 统计口径',`<span class="tag blue">自如北京地图 · 更多 → 灵之智能</span><p>运维中房源为累计已采集并收录的全部房源，包括此前采样和后续新增记录。身份、出租方式、商圈或三维资料待补的记录继续计入。真实房源 ID 优先去重，缺失 ID 时按已保存的本地记录索引去重。</p><div class="source-block"><h3>累计收录 ${stats.count} 条 · 最近补采新增 ${mapAddedCount()??'—'} 条</h3><p>最近原地图访问记录：${esc(formatObservedAt(verification.checkedAt))}。新增为 0 不清空累计收录；当前清单不代表全北京库存。${stats.businesses} 个商圈已确认，${stats.businessUnknown} 条房源商圈待核验；记录覆盖 ${stats.districts} 个行政区，其中 ${stats.confirmedDistricts} 个已确认、${stats.pendingDistricts} 个归属待核验。</p><p>居室按实际出租对象分类。合租卧室单列为“合租单间”，不将所属户型的两居计为一整套两居。本地 CSV 独立展示，不计入公开采集数量。</p></div><div style="overflow:auto"><table><thead><tr><th>已收录房源</th><th>房源身份</th><th>房型</th><th>资料补充</th></tr></thead><tbody>${stats.records.map(row=>`<tr><td>${esc(row.name)}${row.roomLabel?' · '+esc(row.roomLabel):''}</td><td>${esc(listingIdentity(row)||'本地记录 '+row.id)}</td><td>${labels[housingGroup(row)]}</td><td>${esc(inventoryMissing(audit.get(row.id)))}</td></tr>`).join('')}</tbody></table></div><div class="view-menu"><button class="button" id="download-inventory-audit">下载已采集台账</button><button class="button" id="view-collected-records">查看全部房源</button></div>`);
 $('#download-inventory-audit').onclick=()=>downloadFile('北京灵之智能已采集房源.json',JSON.stringify({scope:'全部已采集收录房源',source:data.source,lastMapAttempt:verification,summary:{count:stats.count,businesses:stats.businesses,communities:stats.communities,districts:stats.districts,confirmedDistricts:stats.confirmedDistricts,bedrooms:stats.bedrooms},properties:stats.records},null,2),'application/json;charset=utf-8');
 $('#view-collected-records').onclick=()=>{$('#modal').close();showPage('properties');$('#inventory-view').value='collected';$('#bedroom-select').value='';$('#district-select').value='';$('#property-search').value='';state.propertyPage=1;renderProperties();};
}
function renderModelCoverage(){
 const element=$('#model-coverage');if(!element)return;
 const coverage=modelCoverage?.coverage;if(!coverage){element.textContent='三维资料核验记录暂未加载。';return;}
 element.innerHTML=`<div class="model-coverage-summary"><h3>已采集房源 · 三维资料</h3><div class="model-coverage-counts"><span><strong>${esc(coverage.knownListingRecords)}</strong> 条记录</span><span><strong>${esc(coverage.referenceComplete)}</strong> 套参考齐备</span><span><strong>${esc(coverage.incomplete)}</strong> 套待补资料</span></div></div><p class="model-coverage-note">唯一资料齐备房源为望京路3号院；其余房源需补真实身份、对应户型图和室内照片。房源收录不要求三维资料齐备，模型使用对应房源参考。</p><div class="model-coverage-actions"><button class="button" id="model-coverage-detail">查看逐套缺口</button><button class="button" id="download-model-coverage">下载建模清单</button></div>`;
 $('#model-coverage-detail').onclick=showModelCoverage;
 $('#download-model-coverage').onclick=()=>downloadFile('灵之三维房源资料清单.json',JSON.stringify(modelCoverage,null,2),'application/json;charset=utf-8');
}
function showModelCoverage(){
 const rows=modelCoverage?.properties||[];
 showModal('逐套房源 · 三维资料核验',`<p>目标至少 10 套有独立来源的房源参考。目前 1 套取得户型图和照片，另外 9 套尚待补齐。每套模型只使用对应房源资料。</p><div style="overflow:auto"><table><thead><tr><th>房源</th><th>真实房源 ID</th><th>户型图</th><th>室内照片</th><th>待补资料</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.name)}</td><td>${esc(row.realListingId||'待核验')}</td><td>${esc(row.floorplanCount)}</td><td>${esc(row.interiorPhotoCount)}</td><td>${esc(row.status==='reference_ready'?'参考齐备；实测尺寸待补':(row.missing||[]).join('、'))}</td></tr>`).join('')}</tbody></table></div><p class="small-note">参考齐备表示可进行近似可视化重建；不代表已取得实测尺寸、现场设备清单或实时运行状态。</p>`);
}
function syncHousehold(){householdWorkspace?.update({properties:allProperties(),events:state.events,tickets:state.tickets});}
function openHousehold(id=MODEL_PROPERTY_ID,options={}){if(!householdWorkspace){toast('家庭运行资料正在加载，请稍后。');return;}showPage('household');householdWorkspace.open(id,options);}
function showPage(page,scroll=true){
 const labels={overview:['家庭智能运维管家','一个入口，两个能力：\n让「用得怎么样」看得见，让「怎么办」问得到。'],household:['家庭运行','从整屋概况到具体设备，查看证据并跟进问题。'],properties:['房源资产','汇总自如北京地图已采集房源，连接资料、设备与处理记录。'],devices:['设备监控','保留数据口径，让异常排名真正支持核验与行动。'],agents:['数字员工','灵之百晓生统一承接，四类数字员工协作跟进。'],tickets:['事件工单','发现、诊断、跟进与复验，形成可追溯的处理闭环。']};
 if(!labels[page])return;
 state.page=page;document.body.dataset.page=page;document.body.classList.remove('menu-open');$('#menu-toggle')?.setAttribute('aria-expanded','false');syncHeader();
 $$('.page').forEach(p=>p.classList.toggle('active',p.id===page+'-page'));$$('.nav-item[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
 $('#page-title').textContent=labels[page][0];$('#page-description').textContent=labels[page][1];
 mapWorkspace?.setVisible(page==='overview'&&state.scene==='city');viewer?.setActive(page==='overview'&&state.scene==='apartment');householdWorkspace?.setVisible(page==='household');
 if(page==='overview')requestAnimationFrame(()=>{mapWorkspace?.resize();viewer?.resize();});
 if(scroll)window.scrollTo({top:page==='overview'?$('#app').getBoundingClientRect().top+window.scrollY-150:0,behavior:motionBehavior()});
}
async function showScene(mode){
 if(!mapWorkspace){toast('房源资料正在加载，请稍后。');return;}
 showPage('overview',false);
 state.scene=mode;state.activeDevice=null;$$('[data-scene]').forEach(b=>b.classList.toggle('selected',b.dataset.scene===mode));$('#rotate-btn').classList.remove('active');$('#top-view-btn').classList.remove('active');$('#scene-detail').hidden=true;
 mapWorkspace.setVisible(mode==='city');viewer?.setActive(false);
 $('#geo-filters').hidden=mode!=='city';$('#geo-map-status').hidden=mode!=='city';$('#geo-terrain-btn').hidden=mode!=='city';
 $('#scene-labels').hidden=mode!=='apartment';$('.scene-orientation').hidden=mode!=='apartment';
 $('.render-mode-note')?.toggleAttribute('hidden',mode!=='apartment');
 $('#scene-title').textContent=mode==='city'?'北京房源地图':'望京路3号院 · 三维房源样板';
 $('#scene-subtitle').textContent=mode==='city'?(mapInventoryScope==='model'?'已取得对应户型与照片 · 房源参考位置':'已采集房源分布 · 商圈候选另列'):'50.83㎡ · 1室1厅 · 5/7层 · 据实际户型与照片重建';
 $('#scene-breadcrumb').innerHTML=mode==='city'?'<span>北京</span><span class="crumb-divider">/</span><strong>全部区域</strong>':'<button class="text-btn" id="back-city">北京</button><span class="crumb-divider">/</span><span>朝阳</span><span class="crumb-divider">/</span><strong>望京路3号院</strong>';
 if($('#back-city'))$('#back-city').onclick=()=>showScene('city');
 $('#scene-footnote').textContent=mode==='city'?mapScopeNote():'结构按参考重建 · 设备位置与状态为演示';
 renderSceneLegend();
 $('#apartment-actions').hidden=mode!=='apartment';
 $('.map-panel').scrollIntoView({behavior:motionBehavior(),block:'start'});
 if(mode==='city'){
  $('#scene-loading').hidden=['webgl','leaflet','failed'].includes(mapWorkspace.mode);
  $('#top-view-btn').disabled=mapWorkspace.mode!=='webgl';$('#rotate-btn').disabled=mapWorkspace.mode!=='webgl';
  mapWorkspace.resize();
 }else{
  $('#top-view-btn').disabled=false;$('#rotate-btn').disabled=false;$('#scene-loading').hidden=false;
  try{
   if(!viewer){
    viewer=new SceneViewer($('#scene-container'),{geojson:geo,districts:[],onDistrict:showDistrict,onDevice:showDevice,active:false});
    if(viewer.software){const note=document.createElement('span');note.className='render-mode-note';note.textContent='兼容渲染 · 完整材质需 WebGL';$('#scene-container').append(note);}
   }
   await viewer.show('apartment');
   if(state.scene!=='apartment')return;
   viewer.setActive(true);viewer.setDeviceState('gateway',state.events[0].status==='resolved'?'online':'offline');
  }catch(error){console.error(error);toast('三维房源模型未能加载，可继续使用地图和房源清单。');}
  finally{if(state.scene==='apartment')$('#scene-loading').hidden=true;}
 }
}
function showDistrict(id){
 state.activeDevice=null;showScene('city');mapWorkspace?.focusDistrict(id);
}
function renderSceneLegend(){
 const resolved=state.events[0].status==='resolved';
 $('#scene-legend').innerHTML=state.scene==='city'?'<span><i class="legend-dot"></i>小区参考点</span><span><i class="legend-dot blue"></i>地铁参考点</span><span><i class="legend-dot amber"></i>演示待办</span>':`<span><i class="legend-dot blue"></i>演示设备</span><span><i class="legend-dot ${resolved?'blue':'amber'}"></i>${resolved?'网关演示已恢复':'待核验网关'}</span>`;
}
function showDevice(id){
 state.activeDevice=id;
 const names={gateway:'演示网关','living-light':'餐厅照明（演示）','bedroom-ac':'卧室空调（演示）','door-lock':'入户门锁（演示）','smoke-sensor':'烟感（演示）','water-sensor':'漏水传感器（演示）','curtain-sensor':'窗帘驱动（演示）'};
 $('#scene-detail').hidden=false;$('#scene-detail').innerHTML=`<button class="icon-btn close-scene-detail" aria-label="关闭设备详情">${icon('close')}</button><h3>${esc(names[id]||id)}</h3><span class="tag ${['gateway','living-light','bedroom-ac'].includes(id)&&state.events[0].status!=='resolved'?'amber':'blue'}">${['gateway','living-light','bedroom-ac'].includes(id)&&state.events[0].status!=='resolved'?'演示待核验':'演示在线'}</span><p>设备安装位置和遥测均为演示，不代表该房源实际设备配置。</p><button class="button" id="device-action">${id==='gateway'?'查看关联事件':'查看设备信息'}</button>`;
 $('.close-scene-detail').onclick=()=>$('#scene-detail').hidden=true;$('#device-action').onclick=()=>id==='gateway'?openEvent('EVT-DEMO-001'):showModal('演示设备 · '+(names[id]||id),`<div class="source-state"><span class="tag amber">演示遥测</span><span>尚未接入生产设备</span></div><p>该部件用于展示在三维房源中定位、核查与跟进设备的交互。</p><table><tbody><tr><td>演示对象</td><td>${esc(names[id]||id)}</td></tr><tr><td>房源</td><td>望京路3号院</td></tr><tr><td>设备位置</td><td>业务演示布点，未经现场核验</td></tr><tr><td>接入方式</td><td>待接真实设备台账、网关关系和心跳接口</td></tr></tbody></table>`);
}
function renderEvents(){
 const open=state.events.filter(e=>e.status!=='resolved');$('#event-count').textContent=open.length;
 const events=open.filter(e=>state.eventFilter==='all'||e.priority===state.eventFilter);
 $('#event-list').innerHTML=events.length?events.map(e=>`<button class="event-item" data-event="${e.id}"><div class="event-item-top"><span class="priority ${e.priority.toLowerCase()}">${e.priority}</span><strong>${esc(e.title)}</strong></div><div class="event-item-meta"><span>${esc(e.property)}</span><span>${esc(e.age)}</span></div><div class="event-item-bottom">${icon('agent')}<span>${esc(e.status==='ticketed'?'已生成工单草稿':e.status==='diagnosed'?'诊断建议待核验':e.agent.split(' ')[1])}</span></div></button>`).join(''):`<div class="empty-state">${icon('check')}<h3>当前筛选无待办</h3><p>演示流程可以在工单中心查看。</p></div>`;
 $$('[data-event]').forEach(el=>el.onclick=()=>openEvent(el.dataset.event));
 mapWorkspace?.update(mapProperties(),state.events);syncHousehold();
}
function renderActivity(){
 const rows=state.activities.slice(0,3);$('#activity-feed').innerHTML=rows.map(a=>`<div class="activity"><div class="activity-icon">${icon(a.kind)}</div><div class="activity-main"><div class="activity-head"><b>${esc(a.title)}</b><time>${esc(a.time)}</time></div><p>${esc(a.body)}</p></div></div>`).join('');
}
function renderModelTables(){
 $('#model-summary').innerHTML=ops.model_online_rankings.slice(0,3).map(r=>`<div class="model-row"><span title="${esc(r.model_name)}">${esc(r.model_name)}</span><div class="bar-track ${r.online_rate_percent<70?'warn':''}"><i style="width:${r.online_rate_percent}%"></i></div><span class="percent ${r.online_rate_percent<70?'amber':''}">${esc(r.online_rate_display)}</span><span class="count">离线 ${r.offline_count}</span></div>`).join('');
 $('#model-full-table').innerHTML=`<table><thead><tr><th>型号</th><th>设备数</th><th>在线</th><th>离线</th><th>在线率</th><th>核验入口</th></tr></thead><tbody>${ops.model_online_rankings.map(r=>`<tr><td>${esc(r.model_name)}</td><td>${r.device_count.toLocaleString()}</td><td>${r.online_count.toLocaleString()}</td><td class="amber">${r.offline_count}</td><td>${r.online_rate_display}</td><td><button class="text-btn" data-model-rank="${r.rank}">查看口径</button></td></tr>`).join('')}</tbody></table>`;
 $('#offline-table').innerHTML=`<table><thead><tr><th>设备代号</th><th>型号</th><th>城市 / 房源代号</th><th>最后在线</th><th>原报告时长描述</th></tr></thead><tbody>${ops.offline_device_rankings.map(r=>`<tr><td>${esc(r.device_alias)}</td><td>${esc(r.model_name)}</td><td>${esc(r.city)} · ${esc(r.property_alias)}</td><td class="${r.last_online_status==='never_reported_online'?'amber':''}">${esc(r.last_online_display)}</td><td>${esc(r.offline_duration_display)}</td></tr>`).join('')}</tbody></table>`;
 $$('[data-model-rank]').forEach(b=>b.onclick=()=>{const r=ops.model_online_rankings.find(r=>r.rank===+b.dataset.modelRank);showModal(r.model_name,`<span class="tag blue">用户提供运维快照 · 采样日期未知</span><p>设备数 ${r.device_count} 台，在线 ${r.online_count} 台，离线 ${r.offline_count} 台，显示在线率 ${r.online_rate_display}。</p><p>原报表只纳入 ≥50 台的型号，并按在线率升序排列。截图只显示 7 行，不能由此推算全量在线率或全国总设备数。</p>${r.source_note?`<div class="source-block"><h3>原报告备注</h3><p>${esc(r.source_note)}</p></div>`:''}<h3>建议核验顺序</h3><ul><li>确认采样时间、在线判定规则和设备在管状态。</li><li>按房源聚合同户异常，再核查共同网关、供电与上报链路。</li><li>资料完整后形成任务，并通过真实回执复验。</li></ul>`);});
}
function renderProperties(){
 const current=$('#district-select').value,all=inventoryProperties($('#inventory-view').value),names=new Set(all.map(p=>p.district).filter(Boolean));
 $('#district-select').innerHTML='<option value="">全部区域</option>'+[...names].sort((a,b)=>a.localeCompare(b,'zh-CN')).map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')+(all.some(p=>!p.district)?'<option value="__unknown__">区域待确认</option>':'');
 $('#district-select').value=names.has(current)||current==='__unknown__'?current:'';renderInventorySummary();renderPropertiesList();
 mapWorkspace?.update(mapProperties(),state.events);syncHousehold();
}
function renderPropertiesList(){
 const q=$('#property-search').value.trim().toLowerCase(),district=$('#district-select').value,scope=$('#inventory-view').value,bedroom=$('#bedroom-select').value;
 const sourceRows=inventoryProperties(scope),labels={collected:'全部采集房源',model:'有三维参考',imported:'本地导入 · 未核验'};
 $('#property-dataset-tag').textContent=labels[scope]||labels.collected;
 $('#property-scope').textContent=scope==='imported'?`本地导入 ${sourceRows.length} 条，以提供的资料为准，未计入公开采集成果。`:scope==='model'?`已采集房源中 ${sourceRows.length} 套具备对应户型图和室内照片；建模资料齐备度不影响累计房源数量。`:`累计已采集 ${sourceRows.length} 条 · 最近补采新增 ${mapAddedCount()??'—'} 条；来源为自如北京地图“更多 → 灵之智能”，采样日期 ${formatObservedAt(data.source.observedAt)}。`;
 const filtered=sourceRows.filter(p=>(!district||(district==='__unknown__'?!p.district:p.district===district))&&(!bedroom||housingGroup(p)===bedroom)&&(!q||[p.name,p.listingLabel,p.roomLabel,p.station,p.id,p.district,p.product].some(s=>String(s||'').toLowerCase().includes(q))));
 const page=propertyPage(filtered,state.propertyPage);state.propertyPage=page.current;
 $('#property-list').innerHTML=page.rows.length?page.rows.map(p=>`<article class="property-row"><div class="property-name"><strong>${esc(p.name)}${p.roomLabel?' · '+esc(p.roomLabel):''}</strong><span>${esc(p.district||'区域待确认')} · ${esc(p.product||(p.imported?'用户导入':'产品标签未返回'))}</span></div><div class="property-meta">${p.areaScope==='listed_bedroom'?'卧室 ':''}${esc(p.area)}㎡ · ${p.areaScope==='listed_bedroom'?'所属户型 ':''}${esc(p.bedrooms)}居 · ${esc(p.floor)}/${esc(p.totalFloors)}层<p>${p.station?esc(p.station)+'站'+(p.distance!==null?' · 步行约 '+esc(p.distance)+'m':''):'未提供地铁信息'}</p></div><div class="property-status"><span class="tag ${canOpenModel(p)?'green':''}">${canOpenModel(p)?'已有三维样板':'待补建模资料'}</span><p style="margin-top:5px">${p.coordinate?(p.coordinateStatus==='verified'?'来源坐标已核验':'来源坐标待核验'):'精确坐标待补充'}</p></div><div class="property-actions"><button class="button" data-household="${esc(p.id)}">运行看板</button><button class="button ${canOpenModel(p)?'primary':''}" data-property="${esc(p.id)}">${canOpenModel(p)?'进入三维':'查看资料'}</button></div></article>`).join(''):`<div class="empty-state">${icon('search')}<h3>${scope==='collected'&&!sourceRows.length?'尚未收录房源':'没有匹配的房源'}</h3><p>${scope==='collected'&&!sourceRows.length?'当前采集台账为空，可查看采集状态或补充来源资料。':'可调整居室、区域或关键词。'}</p><button class="button" id="clear-property-search">清除筛选</button>${scope==='collected'?'<button class="button" id="empty-inventory-audit">查看核验情况</button>':''}</div>`;
 $('#property-pagination').innerHTML=`<span class="pagination-summary" aria-live="polite">筛选结果 ${esc(page.total)} 条${page.total?` · 当前 ${esc(page.start+1)}–${esc(page.start+page.rows.length)} 条`:''}</span><div class="pagination-actions"><button class="button" id="property-prev" ${page.current===1?'disabled':''}>上一页</button><span>第 ${esc(page.current)} / ${esc(page.pages)} 页</span><button class="button" id="property-next" ${page.current===page.pages?'disabled':''}>下一页</button></div>`;
 const move=delta=>{state.propertyPage+=delta;renderPropertiesList();$('.asset-panel').scrollIntoView({behavior:motionBehavior(),block:'start'});};$('#property-prev').onclick=()=>move(-1);$('#property-next').onclick=()=>move(1);
 $$('[data-property]').forEach(b=>b.onclick=()=>{const p=allProperties().find(p=>p.id===b.dataset.property);if(!p)return;canOpenModel(p)?showScene('apartment'):showProperty(p.id);});
 $$('[data-household]').forEach(b=>b.onclick=()=>openHousehold(b.dataset.household));
 if($('#empty-inventory-audit'))$('#empty-inventory-audit').onclick=showInventoryAudit;
 if($('#clear-property-search'))$('#clear-property-search').onclick=()=>{$('#property-search').value='';$('#district-select').value='';$('#bedroom-select').value='';state.propertyPage=1;renderPropertiesList();};
}
function showProperty(id){
 const p=allProperties().find(p=>p.id===String(id));if(!p)return;
 const location=(geography?.properties||[]).find(row=>String(row.id)===p.id),business=location?.businessDistrict;
 const audit=listingInventory?.properties?.find(row=>String(row.id)===p.id),references=modelCoverage?.properties?.find(row=>String(row.id)===p.id);
 const sourceName=p.imported?'本地 CSV 台账':'自如地图已采集 · 已计入运维中房源';
 const businessText=business?.status==='confirmed_existing_detail_read'?`${business.name} · 历史详情已确认`:business?.candidate?`${business.candidate} · 待核验候选`:'商圈待核验';
 const rows=[['记录身份',audit?.realListingId?'自如房源 ID '+audit.realListingId:p.imported?'本地导入 ID '+p.id:'本地索引 '+p.id+'；真实房源 ID 待核验'],['资料补充',audit?inventoryMissing(audit):'详细字段待补'],['行政区',p.district||'待核验'],[p.areaScope==='listed_bedroom'?'卧室面积':'房源面积',`${p.area??'—'}㎡`],['居室与楼层',`${p.bedrooms??'—'}居 · ${p.floor??'—'}/${p.totalFloors??'—'}层`],['产品标签',p.product||'待补'],['商圈',businessText],['地图位置',location?.label||'尚未取得核验位置'],['真实设备状态','未接入'],['三维参考',references?`户型图 ${references.floorplanCount} 张 · 室内照片 ${references.interiorPhotoCount} 张`:'尚未提供对应素材']];
 showModal(p.name,`<div class="source-state"><span class="tag blue">${esc(sourceName)}</span><span>${esc(formatObservedAt(p.observedAt))} · 非实时库存</span></div><table><tbody>${rows.map(([key,value])=>`<tr><td>${esc(key)}</td><td>${esc(value)}</td></tr>`).join('')}</tbody></table>${location?`<p class="small-note">${esc(location.matchBasis)}；小区和地铁参考点不代表房间精确位置。</p>`:''}<h3>${canOpenModel(p)?'三维样板资料已具备':'待补三维资料'}</h3><p>${canOpenModel(p)?'本样板按对应户型图和室内照片近似重建，实测尺寸与现场设备配置仍待补齐。':esc(references?.missing?.join('、')||'对应真实房源身份、户型图、主要房间照片与必要尺寸。')}</p><div class="view-menu"><button class="button primary" id="property-running">查看家庭运行</button>${canOpenModel(p)?'<button class="button" id="property-model">进入三维样板</button>':''}${location?.coordinate?'<button class="button" id="property-on-map">在地图中查看</button>':''}${p.sourceUrl?`<a class="button" href="${esc(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看房源来源</a>`:''}</div>`);
 $('#property-running').onclick=()=>{$('#modal').close();openHousehold(p.id);};
 if($('#property-model'))$('#property-model').onclick=()=>{$('#modal').close();showScene('apartment');};
 if($('#property-on-map'))$('#property-on-map').onclick=async()=>{$('#modal').close();setMapScope('collected');await showScene('city');mapWorkspace?.focusProperty(p.id);};
}
function renderAgents(){$('#agent-grid').innerHTML=agentRoles.map(a=>`<article class="agent-card"><div class="agent-symbol">${icon(a.icon)}</div><span class="eyebrow">${a.id}</span><h2>${a.name}</h2><p>${a.task}</p><dl><dt>主要交付成果</dt><dd>${a.result}</dd><dt>真人管理责任</dt><dd>${a.owner}</dd></dl><span class="tag blue">${a.state}</span></article>`).join('');}
function renderTickets(){
 const n=state.tickets.length;$('#nav-ticket-count').textContent=n;$('#nav-ticket-count').style.display=n?'block':'none';
 $('#ticket-list').innerHTML=n?state.tickets.map(t=>`<article class="ticket"><div class="ticket-top"><span class="tag ${t.status==='closed'?'green':'amber'}">${t.status==='closed'?'已完成演示复验':'派单草稿'}</span><h3>${esc(t.title)}</h3><span class="dim" style="font-size:.75rem">${esc(t.id)}</span></div><p>${esc(t.property)} · ${esc(t.assignee)} · ${esc(t.note)}</p><div class="ticket-details"><span>生成：${esc(t.createdAt)}</span><span>建议时限：${esc(t.deadline)}</span><span>${t.status==='closed'?'复验：模拟心跳恢复，结果仅限演示':'待业务负责人确认派单与处理方式'}</span></div><button class="button" data-ticket-event="${t.eventId}">${t.status==='closed'?'查看记录':'打开工作台'}</button></article>`).join(''):`<div class="empty-state">${icon('ticket')}<h3>从一次异常开始</h3><p>运行数字员工诊断后，可以在这里生成、跟进和复验演示工单。</p><button class="button primary" id="ticket-start">演示异常闭环</button></div>`;
 $$('[data-ticket-event]').forEach(b=>b.onclick=()=>openEvent(b.dataset.ticketEvent));if($('#ticket-start'))$('#ticket-start').onclick=()=>openEvent('EVT-DEMO-001');
 syncHousehold();
}
function openEvent(id){state.activeEvent=id;$('#event-drawer').hidden=false;$('#drawer-backdrop').hidden=false;document.body.classList.add('drawer-open');renderDrawer();$('.close-drawer').focus();}
function closeDrawer(){$('#event-drawer').hidden=true;$('#drawer-backdrop').hidden=true;document.body.classList.remove('drawer-open');state.activeEvent=null;}
function diagnosticSteps(e){return e.id==='EVT-DEMO-001'?[['核对同户影响','演示日志：网关与 2 个设备同一时段失去心跳。'],['检查共同依赖','需核对网关供电、上联网络和平台上报链路。'],['形成原因候选','共同链路异常优先；现有证据不足以判定具体根因。'],['制定升级与复验','请求现场核查供电/网络；恢复后校验心跳与场景。']]:e.id==='EVT-DEMO-002'?[['核对上报证据','演示电量 18%，需核对采样时效与连续读数。'],['核查资产与使用状态','确认锁具在管、可正常开关及备用进入方式。'],['生成处理建议','安排合适时间人工更换电池，不发送开锁指令。'],['制定复验条件','更换后核对电量与真实锁具使用反馈。']]:e.id==='EVT-DEMO-003'?[['确认指令与回执','区分已发送、已执行与已确认状态。'],['核对通信依赖','检查网关、网络与设备回执链路。'],['形成排查建议','先补日志，再检查控制协议和设备状态。'],['制定复验条件','以真实执行回执和状态变化确认恢复。']]:[['核对未上报时段','演示未上报，不等同于传感器确认漏水。'],['核对设备在管状态','确认上报能力、采样周期及资产是否仍使用。'],['检查电池与网关','补充现场电池信息和网关通信日志。'],['制定复验条件','依据传感器真实心跳与测试事件验证恢复。']];}
function renderDrawer(){
 const e=state.events.find(e=>e.id===state.activeEvent);if(!e)return;const progress=state.diagnosticProgress[e.id]||0;const running=e.status==='diagnosing';const completed=['diagnosed','ticketed','resolved'].includes(e.status);const ticket=state.tickets.find(t=>t.eventId===e.id);const steps=diagnosticSteps(e);
 $('#drawer-title').textContent=e.status==='resolved'?'事件复验记录':'事件工作台';
 $('#drawer-body').innerHTML=`<div class="event-summary"><div class="event-summary-title"><span class="priority ${e.priority.toLowerCase()}">${e.priority}</span><strong>${esc(e.title)}</strong></div><p>${esc(e.property)} · 北京${esc(e.district)} · ${esc(e.id)}</p><span class="tag ${e.status==='resolved'?'green':'amber'}">${e.status==='resolved'?'已完成演示复验':'演示遥测 · 未连接生产设备'}</span></div><dl class="detail-grid"><div><dt>处理数字员工</dt><dd>${esc(e.agent)}</dd></div><div><dt>当前状态</dt><dd>${({new:'待核验',diagnosing:'诊断演示中',diagnosed:'建议待确认',ticketed:'已生成工单草稿',resolved:'演示已复验'})[e.status]||'待核验'}</dd></div><div><dt>关联对象</dt><dd>${esc(e.deviceName)}</dd></div><div><dt>真人管理责任</dt><dd>运维业务负责人</dd></div></dl><section class="drawer-section"><h3>当前证据</h3>${e.evidence.map(([k,v])=>`<div class="evidence-row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}<p class="small-note">${esc(e.summary)}</p></section><section class="drawer-section"><h3>数字员工诊断路径</h3><div class="diagnostic-steps">${steps.map(([title,body],i)=>`<div class="diag-step ${progress>i?'complete':running&&progress===i?'current':''}"><span class="diag-node">${progress>i?'✓':i+1}</span><div><strong>${title}</strong><p>${progress>i||completed?body:'等待核验演示'}</p></div></div>`).join('')}</div>${completed?`<div class="diagnostic-conclusion"><strong>处理建议 · 仍需核验</strong>${e.id==='EVT-DEMO-001'?'优先核查共同网关供电与上联链路；当前证据不足以直接认定网关损坏。不执行重置或配置变更。':'先补齐真实设备、现场与上报证据，再确认处理方式；建议文本不是执行回执。'}<br>升级条件：关键证据缺失、远程无法验证或存在现场风险时转人工。</div>`:''}</section>${e.status==='resolved'?'<div class="diagnostic-conclusion"><strong>演示复验已记录</strong>已模拟恢复心跳、核对关联设备并保存演示记录。未向真实设备发送任何指令，案例可继续交由专家形成技能草案。</div>':''}<div class="drawer-actions">${!completed?`<button class="button primary" id="diagnose-btn" ${running?'disabled':''}>${running?'正在演示诊断…':'启动数字员工诊断'}</button>`:!ticket?'<button class="button primary" id="create-ticket-btn">生成工单草稿</button>':e.status!=='resolved'?'<button class="button primary" id="verify-btn">模拟恢复并复验</button>':'<button class="button" id="view-ticket-btn">查看工单记录</button>'}${e.propertyId==='810151211'?'<button class="button" id="locate-model-btn">定位三维设备</button>':''}</div><p class="small-note">${ticket?'工单 '+esc(ticket.id)+' · 仅保存于当前浏览器。':'所有诊断步骤与回执均为交互演示；真实执行须接入设备系统并遵循业务授权。'}</p>`;
 if($('#diagnose-btn'))$('#diagnose-btn').onclick=()=>runDiagnosis(e.id);if($('#create-ticket-btn'))$('#create-ticket-btn').onclick=()=>createTicket(e.id);if($('#verify-btn'))$('#verify-btn').onclick=()=>verifyEvent(e.id);if($('#view-ticket-btn'))$('#view-ticket-btn').onclick=()=>{closeDrawer();showPage('tickets');};if($('#locate-model-btn'))$('#locate-model-btn').onclick=async()=>{closeDrawer();await showScene('apartment');viewer?.focusDevice(e.device);showDevice(e.device);};
 $('.drawer-actions').insertAdjacentHTML('beforeend','<button class="button" id="event-running">查看家庭运行</button>');
 $('#event-running').onclick=()=>{closeDrawer();openHousehold(e.propertyId);};
}
function runDiagnosis(id){
 if(diagnosisTimer){toast('已有一项演示诊断正在进行。');return;}
 const e=state.events.find(e=>e.id===id);if(!e||e.status==='resolved')return;e.status='diagnosing';state.diagnosticProgress[id]=0;renderDrawer();
 addActivity('远程诊断工程师 · 开始核验',`${e.property}：读取演示证据，核查共同依赖。`,'tool');
 diagnosisTimer=setInterval(()=>{state.diagnosticProgress[id]++;if(state.diagnosticProgress[id]>=4){clearInterval(diagnosisTimer);diagnosisTimer=null;e.status='diagnosed';addActivity('远程诊断工程师 · 建议已形成',`${e.property}：保留原因候选、证据缺口和升级条件。`,'tool');renderEvents();}persist();if(state.activeEvent===id)renderDrawer();},950);
}
function createTicket(id){
 if(state.tickets.some(t=>t.eventId===id)){toast('该事件已有演示工单。');return;}
 const e=state.events.find(e=>e.id===id);if(!e||e.status!=='diagnosed')return;
 const t={id:'LZ-DEMO-'+String(state.tickets.length+1).padStart(3,'0'),eventId:id,title:e.title,property:e.property,assignee:'LZ-06 售后工单调度员',status:'draft',createdAt:timeNow(),deadline:e.priority==='P1'?'2 小时内确认处理（演示）':'当日确认处理（演示）',note:'先补充现场与链路证据，处理后复验设备状态'};
 state.tickets.unshift(t);e.status='ticketed';persist();renderDrawer();renderTickets();renderEvents();addActivity('工单调度员 · 草稿已生成',`${t.id} · ${e.property}，待真人确认责任人与处理方式。`,'ticket');toast('工单草稿已生成，仅保存在本 Demo。');
}
function verifyEvent(id){
 const e=state.events.find(e=>e.id===id),t=state.tickets.find(t=>t.eventId===id);if(!e||!t||e.status==='resolved')return;e.status='resolved';t.status='closed';t.verifiedAt=timeNow();persist();renderDrawer();renderEvents();renderTickets();renderSceneLegend();if(id==='EVT-DEMO-001'){viewer?.setDeviceState('gateway','online');if(state.activeDevice==='gateway'&&!$('#scene-detail').hidden)showDevice('gateway');}addActivity('监控与调度 · 演示复验完成',`${e.property}：模拟恢复已记录；案例进入待专家核验队列。`,'check');toast('演示事件已闭环，真实设备状态未改变。');
}
function showModal(title,body){$('#modal-title').textContent=title;$('#modal-body').innerHTML=body;$('#modal').showModal();hydrateIcons($('#modal'));}
function showCrawlStatus(){
 if(!data){toast('采集记录仍在加载。');return;}
 const verification=mapLastAttempt(),stats=collectedStats(),url=safeUrl(data.source.url);
 const rows=[['主数据源','自如北京地图'],['筛选','更多 → 灵之智能 → 确定'],['运维中房源',`${stats.count} 条累计已采集记录`],['最近原地图访问',formatObservedAt(verification.checkedAt)],['最近补采新增',`${mapAddedCount()??'—'} 条`],['有效列表页',verification.validListingPages??'—'],['全北京总量','尚未取得完整清单'],['请求结果',verification.status==='blocked'?'原地图返回校验页；保留累计收录':'以来源记录为准']];
 showModal('自如地图 · 采集状态',`<span class="tag blue">累计收录 ${stats.count} 条</span><p>累计房源与最近新增分别记录。最近一次补采未新增数据，不影响已收录房源的运维展示。</p><table><tbody>${rows.map(([key,value])=>`<tr><td>${esc(key)}</td><td>${esc(value)}</td></tr>`).join('')}</tbody></table><div class="view-menu"><button class="button" id="crawl-audit">查看已采集台账</button>${url?`<a class="button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">打开自如北京地图</a>`:''}</div><p class="small-note">地图 URL 不保存筛选状态，打开后需重新选择“更多 → 灵之智能 → 确定”。这里展示最近一次保存的访问记录。</p>`);
 $('#crawl-audit').onclick=()=>{$('#modal').close();showInventoryAudit();};
}
function showSources(){
 if(!data){toast('资料仍在加载，请稍后查看。');return;}
 const verification=mapLastAttempt(),stats=collectedStats(),source=safeUrl(data.source.url);
 showModal('数据来源与重建范围',`<div class="source-block"><h3>① 自如北京地图 · 已采集房源</h3><p>主来源为自如北京地图，筛选“更多 → 灵之智能 → 确定”。运维中房源计入全部已采集收录记录，当前累计 ${stats.count} 条；包含资料待补记录，按真实房源 ID 或本地记录索引去重。本地 CSV 不计入公开采集数量。</p><p>最近原地图访问记录为 ${esc(formatObservedAt(verification.checkedAt))}，新增 ${mapAddedCount()??'—'} 条，累计收录保留。房源按实际出租对象分类，合租单间独立列示；现有清单不是北京全量，也不表示真实设备已接入。</p>${source?`<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">打开自如北京地图（需重新选择灵之智能）</a>`:''} · <a href="./ops/assets/properties.json" target="_blank" rel="noopener noreferrer">已收录原始记录</a></div><div class="source-block"><h3>② 三维参考资料</h3><p>仅望京路3号院（810151211）具备 1 张户型图、10 张照片，支持对应房源的近似重建；其余 9 条历史记录尚缺独立房源身份、户型图及照片。部分尺寸和遮挡结构为推断，设备位置与运行状态为演示。</p><a href="./ops/assets/three-source-coverage.json" target="_blank" rel="noopener noreferrer">逐套建模资料</a> · <a href="https://github.com/img2threejs/img2threejs" target="_blank" rel="noopener noreferrer">img2threejs 方法参考</a></div><div class="source-block"><h3>③ 家庭运行与问题承接</h3><p>连接、执行、联动、安防、耗材和使用六个维度；仅参考样板使用 7 台演示设备的数据。日、周、月指标来自固定演示窗口，模拟复验只更新当前演示状态，不改写历史统计。其他房源的真实遥测均未接入。</p><p>灵之百晓生是本地规则问答演示，使用当前房源、维度、演示事件与浏览器中的工单记录；未连接大模型，未向真实设备发送命令或实际派单。</p></div><div class="source-block"><h3>④ 公共地图与商圈</h3><p>OpenStreetMap 底图、MapLibre 与 Three.js 业务图层；支持 WebGL2 时可叠加 Mapzen / AWS 地形，其他环境显示二维兼容地图。地形不代表楼栋或室内结构。</p><p>历史参考中有 7 条小区参考位置、3 条地铁代理位置，均不是房间精确坐标。太阳宫已计入确认商圈，其余 9 条为待核验候选，单独列示。</p><div class="view-menu"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a><a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener noreferrer">Mapzen / AWS</a><a href="./ops/assets/property-geography.json" target="_blank" rel="noopener noreferrer">位置核验依据</a></div></div><div class="source-block"><h3>⑤ 原运维报表与演示</h3><p>设备报表来自用户提供截图，采样日期未知，可读 7 个型号、8 台设备记录，不能推算全局在线率，也不与北京房源建立未经核验的映射。4 条事件与工单草稿仅保存在当前浏览器。</p></div>`);
}
function showReferences(){showModal('望京路3号院 · 参考图对照',`<div class="source-state"><span class="tag blue">实际房源参考</span><span>1 张户型图 · 10 张实景照片 · 观察日期 2026.11.19</span></div><div class="reference-grid"><figure><img src="./ops/assets/reference/floorplan.webp" alt="望京路3号院实际户型图"><figcaption>户型：南阳台—卧室—餐厅/玄关，西北卫生间，东北厨房与洗衣阳台。</figcaption></figure><figure><img src="./ops/assets/reference/bedroom.webp" alt="望京路3号院卧室实景"><figcaption>卧室实景：床、衣柜、灰色窗帘与材质差异。</figcaption></figure><figure><img src="./ops/assets/reference/room4.webp" alt="房源餐厅及室内参考"><figcaption>室内结构与家具关系参考。</figcaption></figure><figure><img src="./ops/assets/reference/room9.webp" alt="房源厨卫参考"><figcaption>厨卫及设施材质参考。</figcaption></figure></div><h3>可核验与推断的界线</h3><p>房间连接关系、主要家具、门窗位置与视觉材质以参考资料为依据；未给出实测尺寸的高度与遮挡结构保留推断标记。设备布点和遥测用于演示，不是现场设备台账。</p><div class="view-menu"><button class="button" id="reference-top">关闭对照并查看俯视</button><a class="button" href="https://www.ziroom.com/x/810151211.html" target="_blank" rel="noopener noreferrer">打开房源原页</a></div>`);$('#reference-top').onclick=()=>{$('#modal').close();viewer?.toggleTop();$('#top-view-btn').classList.toggle('active',viewer?.topView);};}
function showSkill(){showModal('技能草案：同一房源多设备离线',`<span class="tag amber">示范技能 · 尚未完成专家与留出案例验证</span><h3>适用条件</h3><p>同一房源多个设备在相近时间未上报，且存在共同网关、网络或供电依赖。</p><h3>判断顺序</h3><ol style="color:var(--muted);line-height:1.9"><li>核对房源、设备在管状态与采样时间，排除台账或采集问题。</li><li>识别同户设备与网关关系，按共同依赖聚合影响范围。</li><li>依次收集供电、网络、网关状态与平台日志证据。</li><li>形成可验证的原因候选；证据不足保留未知项并转人工。</li><li>处理后以设备心跳、执行回执和必要现场反馈复验。</li></ol><h3>反例与边界</h3><p>外网正常并不证明网关正常；没有上报记录也不等同于持续故障。不把重启或恢复出厂设置作为默认动作。</p><h3>发布前还需完成</h3><p>专家核对来源与适用版本，使用未参与提炼的新案例测试，并与现行流程比较准确性、耗时与转人工成本。</p><div class="source-block"><strong>草案版本 v0.1</strong><p>来源：本 Demo 的业务情景、用户提供运维讨论与公开蒸馏方法。不是已验证生产 SOP。</p></div>`);}
function downloadFile(name,text,type='text/plain;charset=utf-8'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function parseCsv(text){const rows=[];let row=[],cell='',quote=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quote&&text[i+1]==='"'){cell+='"';i++;}else quote=!quote;}else if(c===','&&!quote){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=c;}if(quote)throw Error('CSV 存在未闭合引号');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows;}
async function importCsv(file){
 if(!file)return;if(file.size>5*1024*1024){toast('请导入不超过 5MB 的 CSV 文件。');return;}
 try{const rows=parseCsv((await file.text()).replace(/^\uFEFF/,''));if(rows.length<2)throw Error('文件中没有房源数据');const headers=rows.shift().map(v=>v.trim());for(const k of ['id','name'])if(!headers.includes(k))throw Error('缺少必填列 '+k);const imported=[];for(const [index,values]of rows.entries()){const o=Object.fromEntries(headers.map((h,i)=>[h,values[i]?.trim()||'']));if(!o.id||!o.name)throw Error(`第 ${index+2} 行缺少 id 或 name`);if(data.properties.some(p=>p.id===o.id))throw Error(`第 ${index+2} 行 ID 与已验证公开样本重复，请使用独立 ID 保存导入记录`);const lon=o.longitude||o.lng,lat=o.latitude||o.lat;let coordinate=null;if(lon||lat){if(!lon||!lat||!Number.isFinite(+lon)||!Number.isFinite(+lat)||+lon<115||+lon>118||+lat<39||+lat>42)throw Error(`第 ${index+2} 行坐标不符合北京范围`);coordinate=[+lon,+lat];}const num=k=>o[k]&&Number.isFinite(+o[k])?+o[k]:null;imported.push({id:o.id,name:o.name,district:o.district||null,area:num('area'),bedrooms:num('bedrooms'),floor:num('floor'),totalFloors:num('totalFloors'),orientation:o.orientation||null,station:o.station||null,distance:num('distance'),product:o.product||'用户导入',modelReady:false,sourceUrl:null,coordinate,imported:true,importedAt:new Date().toISOString()});}if(imported.length>10000)throw Error('单次导入最多 10,000 条房源');const m=new Map(state.imported.map(p=>[p.id,p]));for(const p of imported)m.set(p.id,p);state.imported=normalizeProperties([...m.values()],'imported');state.propertyPage=1;persist();renderProperties();addActivity('房源资料 · 已导入',`${imported.length} 条台账已更新；未自动地图布点或三维建模。`,'database');toast(`成功导入 ${imported.length} 条房源，未自动生成未经验证的模型。`);}catch(e){toast('导入失败：'+e.message);}finally{$('#import-file').value='';}
}
function resetDemo(){showModal('重置演示记录',`<p>重置 4 条演示事件、诊断进度与本地演示工单。已导入的房源台账保留。</p><button class="button primary" id="confirm-reset">重置事件与工单</button>`);$('#confirm-reset').onclick=()=>{clearInterval(diagnosisTimer);diagnosisTimer=null;state.events=structuredClone(initialEvents);state.tickets=[];state.diagnosticProgress={};state.activities=[];persist();renderAll();$('#modal').close();renderSceneLegend();viewer?.setDeviceState('gateway','offline');if(state.activeDevice==='gateway'&&!$('#scene-detail').hidden)showDevice('gateway');toast('演示事件与工单已重置。');};}

function motionBehavior(){return window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';}
function syncHeader(){document.body.classList.add('header-scrolled');}
$('#brand-home').onclick=e=>{e.preventDefault();showPage('overview',false);window.scrollTo({top:0,behavior:motionBehavior()});};
$('.footer-brand').onclick=$('#brand-home').onclick;
$('#menu-toggle').onclick=()=>{if(window.matchMedia('(max-width:640px)').matches){const open=document.body.classList.toggle('menu-open');$('#menu-toggle').setAttribute('aria-expanded',String(open));}else{$('#app').scrollIntoView({behavior:motionBehavior(),block:'start'});}};
syncHeader();
$$('.nav-item[data-page]').forEach(b=>b.onclick=()=>showPage(b.dataset.page));$$('[data-go]').forEach(b=>b.onclick=()=>showPage(b.dataset.go));
$$('[data-event-filter]').forEach(b=>b.onclick=()=>{state.eventFilter=b.dataset.eventFilter;$$('[data-event-filter]').forEach(v=>v.classList.toggle('selected',v===b));renderEvents();});
$$('[data-scene]').forEach(b=>b.onclick=()=>showScene(b.dataset.scene));
$('#show-apartment-btn').onclick=()=>showScene('apartment');$('#tour-btn').onclick=async()=>{await showScene('apartment');openEvent('EVT-DEMO-001');};
 $('#agent-home-entry').onclick=()=>openHousehold();$('#agent-ask-entry').onclick=()=>openHousehold(MODEL_PROPERTY_ID,{ask:true});$('#apartment-running-btn').onclick=()=>openHousehold();
 $('#map-inventory-scope').addEventListener('change',event=>setMapScope(event.target.value));
const activeScene=()=>state.scene==='city'?mapWorkspace:viewer;
$('#reset-camera').onclick=()=>{activeScene()?.reset();$('#scene-detail').hidden=true;$('#top-view-btn').classList.remove('active');$('#rotate-btn').classList.remove('active');activeScene()?.setRotate(false);};
$('#rotate-btn').onclick=()=>{const active=!$('#rotate-btn').classList.contains('active');$('#rotate-btn').classList.toggle('active',!!activeScene()?.setRotate(active));};
$('#top-view-btn').onclick=()=>$('#top-view-btn').classList.toggle('active',!!activeScene()?.toggleTop());
$('#geo-terrain-btn').onclick=()=>mapWorkspace?.toggleTerrain();
$('#fullscreen-btn').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('.map-panel').requestFullscreen();}catch{toast('当前浏览器未开启全屏，可放大页面查看。');}};
$('#reference-btn').onclick=showReferences;$('#cutaway-btn').onclick=()=>{const cutaway=viewer?.toggleWalls();$('#cutaway-btn').innerHTML=icon('layers')+(cutaway?'显示完整墙体':'恢复剖切视图');};
$('#source-btn').onclick=showSources;$('#nav-data').onclick=showSources;$('#footer-source').onclick=showSources;$('#owner-btn').onclick=()=>showModal('管理责任',`<p>数字员工的业务负责人确认工作规则、输出质量和授权；技术负责人维护接口、版本和运行记录。本 Demo 使用岗位角色占位，未登记具体人员或任命关系。</p><p>当前演示能力：只读资料、诊断步骤、工单草稿、模拟复验。真实设备操作应由后端权限、审批与回执共同约束。</p>`);
$('.close-drawer').onclick=closeDrawer;$('#drawer-backdrop').onclick=closeDrawer;$('#modal-close').onclick=()=>$('#modal').close();$('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))$('#modal').close();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#event-drawer').hidden)closeDrawer();});
$('#property-search').addEventListener('input',()=>{state.propertyPage=1;renderPropertiesList();});$('#district-select').addEventListener('change',()=>{state.propertyPage=1;renderPropertiesList();});$('#crawl-status-btn').onclick=showCrawlStatus;$('#import-btn').onclick=()=>$('#import-file').click();$('#import-file').onchange=e=>importCsv(e.target.files[0]);
 $('#inventory-view').addEventListener('change',()=>{state.propertyPage=1;$('#district-select').value='';renderProperties();});$('#bedroom-select').addEventListener('change',()=>{state.propertyPage=1;renderPropertiesList();});
$('#export-sample-btn').onclick=()=>downloadFile('灵之房源导入模板.csv','\uFEFFid,name,district,area,bedrooms,floor,totalFloors,longitude,latitude,product\nUSER-001,填写真实小区名,朝阳,50.83,1,5,7,,,用户房源台账\n','text/csv;charset=utf-8');
$('#skill-btn').onclick=showSkill;$('#reset-demo-btn').onclick=resetDemo;
// Recover an interrupted demo diagnosis as a pending event; do not pretend a timer kept running.
for(const e of state.events)if(e.status==='diagnosing'){e.status='new';state.diagnosticProgress[e.id]=0;}
init();
