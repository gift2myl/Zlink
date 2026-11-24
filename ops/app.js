import { loadOperationsData, openOperationsAccess } from './operations-access.js';
import { homeDisplayName, houseEvents, occupancyLabels } from './house-events.js?v=20261124-cohorts';
import { renderOperationsStage } from './home-operations.js';
import { mountHomeDirectory } from './home-directory.js?v=20261124-first-paint';
import { mountHealthAnalysis } from './health-analysis.js?v=20261124-goals';
import { mountOccupancyHealth } from './occupancy-health.js?v=20261124-cohorts';
import {createOfficialVrPlayer, verifiedVrUrl} from './official-vr.js';
import { attachReviewedTwins } from './reviewed-twin-records.js';
import { mountMapListingSearch } from './map-listing-search.js';
import { mountListingPlanViewer, loadListingPlanIndex } from './listing-plan-viewer.js';
import { mountRentalMonitor } from './rental-monitor.js';
import { projectPublicInventory } from './public-inventory-data.js';
import { mountReferenceGallery } from './reference-gallery.js';
import { buildInventoryHierarchy } from './inventory-hierarchy.js';
import { mountPropertyDetail } from './property-detail.js';
import { housingGroup, mergeCollectedProperties, listingIdentity } from './inventory-statistics.js';
import { TwinWorkspace, configurationCatalogHtml } from './twin-workspace.js';
import { buildDeviceConfiguration, CONFIG_SOURCE } from './device-configuration.js';

const $=s=>document.querySelector(s);
$('#standards-unlock').onclick=()=>openOperationsAccess('#health-standards');
$('#health-standards').addEventListener('toggle',event=>{
 if(event.newState==='closed' && location.hash==='#health-standards')history.replaceState(null,'','#household');
});
const cityMapKey = $('#scene-legend').innerHTML;
$('#health-standards').addEventListener('click',event=>{
 const key=event.target.closest('[data-standard-event]')?.dataset.standardEvent;
 if(!key)return;
 const row=document.getElementById('standard-event-'+key);
 if(row){row.focus({preventScroll:true});row.scrollIntoView({block:'center',behavior:'instant'});}
});
const $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MODEL_PROPERTY_ID='810151211';
const textValue=(v,fallback='')=>typeof v==='string'||typeof v==='number'?String(v).trim():fallback;
const finiteNumber=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
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
function originalTwin(p){return !!p&&!p.imported&&p.id===MODEL_PROPERTY_ID&&p.modelReady===true;}
function canOpenModel(p){return originalTwin(p)||p?.reviewedRoomDemo===true;}
async function readAsset(name) {
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetch('./ops/assets/'+name,{cache:'no-cache',signal:controller.signal});
  if(!response.ok)throw Error(name+' 加载失败');
  return await response.json();
 }finally{clearTimeout(timeout);}
}
async function optionalJson(name){try{return await readAsset(name);}catch{return null;}}
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
const state={page:'overview',scene:'city'};
let data,geo,viewer,mapWorkspace,geography,mapSources,health,modelCoverage,listingInventory,twinWorkspace;
let activeTwinPropertyId=MODEL_PROPERTY_ID, activeOperation=null, healthAnalysis=null;
let roomAudits=null, reviewedView=null, reviewedId=null;
let propertyDetailController=null;
let mapListingSearch=null, rentalMonitor=null;
let rentalCommunityProperties = [];
let mapInventoryScope='collected', planCatalog=new Map(), listingPlanView=null;
let overviewPlanView=null, overviewPlanId=null, overviewTwinOptions='';
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
}
let officialVrPlayer;
let publicOverview = false;
function mergedRows(previous, additions, combine) {
 const rows=new Map((previous||[]).map(row=>[row.id,row]));
 for(const row of additions) rows.set(row.id,rows.has(row.id)?combine(rows.get(row.id),row):row);
 return [...rows.values()];
}
function applyInventorySources(base,report,dataset,locations,coverage,audit,snapshot,communityMap,availability,listingFacts,listingOffers){
 if(!Array.isArray(snapshot?.listings)||!Array.isArray(snapshot?.checks)||!snapshot.date)
  throw new Error('官网房源快照格式不完整');
 const projected=projectPublicInventory(snapshot,communityMap,availability,listingFacts,listingOffers);
 initializePropertyData(base,report,dataset);
 const prior=data.properties;
 const priorById=new Map(prior.map(p=>[listingIdentity(p),p]));
 const additions=projected.properties.map(row=>{
  const saved=priorById.get(row.realListingId);
  if(!saved)return row;
  const current=Object.fromEntries(Object.entries(row).filter(([,v])=>v!=null));
  return {...saved,...current,publicFloorplanUrl:row.publicFloorplanUrl,publicVrUrl:row.publicVrUrl,modelReady:saved.modelReady===true};
 });
 data.properties=mergeCollectedProperties(prior, additions);
 if(projected.properties.length)data.source={...projected.source};
 listingInventory={...audit,properties:mergedRows(audit?.properties,projected.audits,(old,row)=>({
  ...old,...row,fields:{...old.fields,...Object.fromEntries(Object.entries(row.fields).filter(([,f])=>f.verified))}
 }))};
 geography={...locations,properties:mergedRows(locations?.properties,projected.locations,(old,row)=>({
  ...(Array.isArray(old.coordinate) && (!Array.isArray(row.coordinate) || (old.matchType==='community' && row.matchType!=='community'))?{...row,...old}:{...old,...row}),businessDistrict:row.businessDistrict?.status==='confirmed'?row.businessDistrict:old.businessDistrict||row.businessDistrict
 }))};
 const references=mergedRows(coverage?.properties,projected.references,(old,row)=>{
  if(old.modelReady!==true)return {...old,...row};
  return {...row,...old,publicFloorplanUrl:row.publicFloorplanUrl,publicVrUrl:row.publicVrUrl,vr:row.vr};
 });
 attachReviewedTwins(data.properties,references,planCatalog,roomAudits);
 modelCoverage={...coverage,properties:references};

}
function currentInventoryHierarchy(){return buildInventoryHierarchy({properties:data.properties,report:listingInventory,geography,coverage:modelCoverage,source:data.source,events:[]});}
function loadFailure(element,message){
 if(element.querySelector('[data-initial-data]'))return;
 element.replaceChildren(document.createTextNode(message+' '));
 const retry=document.createElement('button');
 retry.type='button';retry.className='button';retry.textContent='重新加载';
 retry.onclick=()=>location.reload();
 element.append(retry);
}
async function loadHealthViews(){
 try{
  const {snapshot:healthSnapshot,directory}=await loadOperationsData(readAsset);
  publicOverview = healthSnapshot.publicOverview === true;
  $('#standards-unlock').hidden = !publicOverview;
   health=mountOccupancyHealth(healthSnapshot,$('#occupancy-overview'),$('#household-workspace'),{
    directory:directory?.date===healthSnapshot.date ? directory : null,
    onOperations:goRecordOperations,
    onScope:scope=>{const hash=scope==='rental'?'#rental-map':'#occupied-map';if(location.hash===hash)followInventoryLink();else location.hash=hash;},
    onMap:async(scope,id)=>{
     if(!mapWorkspace){location.hash='map-listing-'+id;followInventoryLink();return;}
     history.replaceState(null,'','#map-listing-'+id);setMapScope(scope);await showScene('city');mapWorkspace.focusProperty(id);
    }
   });
  if (publicOverview) {
    for(const [id,label] of [['monitor-health','查看各版本健康状况与异常排行'],['home-directory','检索完整房源与服务管家'],['severe-homes','安全监控异常 · '+healthSnapshot.safetyTotal+' 套']]){
      const host=document.getElementById(id);
      host.innerHTML='<section class="health-block ops-protected"><h2>'+esc(label)+'</h2><button type="button" class="button">输入运维口令</button></section>';
      host.querySelector('button').onclick=()=>openOperationsAccess();
    }
  } else {
   const onDetails=(row,scope,title)=>showAnomalyModal(title,{row,scope},row.mapId);
   healthAnalysis=mountHealthAnalysis(healthSnapshot,$('#monitor-health'),$('#anomaly-ranking'),$('#severe-homes'),onDetails,()=>health.open(),health.displayName);
   if(directory?.date===healthSnapshot.date || !$('#home-directory [data-initial-data]'))mountHomeDirectory($('#home-directory'),healthSnapshot,directory,(row,scope,info)=>onDetails(row,scope,info?.address || homeDisplayName(row)));
  }
  if(healthRoute()!==null)followInventoryLink();
  return healthSnapshot;
 }catch(error){
  console.error('健康明细加载失败',error);
  for(const id of ['occupancy-overview','monitor-health','home-directory','severe-homes'])loadFailure(document.getElementById(id),'本期房源健康数据暂时无法读取。');
  return null;
 }
}
async function init(){
 followInventoryLink();
 const healthReady=loadHealthViews();
 try{
  const [base,boundaries,report,dataset,locationData,sourceData,coverageData,inventoryData,snapshot,communityMap,availability,listingFacts,listingOffers,catalog,audits,{PropertyMapWorkspace}]=await Promise.all([readAsset('properties.json'),readAsset('beijing.geojson'),optionalJson('crawl-status.json'),optionalJson('crawled-properties.json'),optionalJson('property-geography.json'),optionalJson('map-sources.json'),optionalJson('three-source-coverage.json'),optionalJson('listing-inventory.json'),readAsset('public-inventory.json'),optionalJson('beijing-community-map.json'),optionalJson('plan-previews/availability.json'),optionalJson('beijing-listing-facts.json'),optionalJson('beijing-listing-offers.json'),loadListingPlanIndex().catch(()=>new Map()),optionalJson('plan-references/room-verification.json'),import('./property-map-workspace.js')]);
  planCatalog=catalog;roomAudits=audits;geo=boundaries;mapSources=sourceData||{};applyInventorySources(base,report,dataset,locationData,coverageData,inventoryData,snapshot,communityMap,availability,listingFacts,listingOffers);
  hydrateIcons();
  $('#scene-labels').hidden=true;$('.scene-orientation').hidden=true;
  $('#scene-loading').lastElementChild.textContent='正在加载北京公共地图';
  mapWorkspace=new PropertyMapWorkspace($('#scene-container'),{
   properties:mapProperties(),geography,sources:mapSources,
   onOpenRoom:(id,profile)=>openTwin(id,profile,'room'),onOpenProperty:showProperty,onOpenPlan:openOverviewPlan,onClosePlan:closeOverviewPlan,onOpenModel:(id,profile)=>profile?openTwin(id,profile):goPropertyOperations(id),onOpenOperations:openHousehold,onOpenAnomalies:showHouseAnomalies,onActivateMap:()=>showScene('city'),
   onFilterPath:path=>{if(['rental','occupied'].includes(mapInventoryScope))rentalMonitor?.selectFromMap(path);},
   onStatus:status=>{
    if(state.scene==='city')$('#scene-loading').hidden=['webgl','leaflet','failed'].includes(status.mode);
    $('#scene-container').classList.toggle('interactive-map-ready',['webgl','leaflet'].includes(status.mode));
   }
  });
  mapListingSearch=mountMapListingSearch($('#map-listing-search'),{
   getEntries:()=>mapWorkspace.entries,
   onLocate:id=>mapWorkspace.focusProperty(id,{reveal:false})
  });
  const healthSnapshot=await healthReady;
  if(healthSnapshot){
   rentalCommunityProperties = healthSnapshot.vacant.rows.filter(row=>row.communityRef && row.mapId).map(row=>{
    const ref = row.communityRef;
    const property = {id:row.mapId, city:'北京', name:ref.name, district:ref.district, businessArea:ref.business,
     communityId:ref.communityId, product:row.version, floor:row.floor, listingLabel:[ref.name,row.building,Number.isInteger(row.floor)?row.floor+'层':'',row.version].filter(Boolean).join(' · '), rentalCommunity:true};
    geography.properties.push({id:row.mapId, ...ref, coordinateSystem:'WGS84', matchType:'community',isExactPropertyLocation:false,
     positionBasis:ref.evidence || '按待租明细的行政区与小区名称核对。', businessDistrict:{name:ref.business,status:ref.business?'confirmed':'unknown',sourceUrl:ref.referenceUrl}});
    return property;
   });
  }
  twinWorkspace=new TwinWorkspace({controls:$('#twin-controls'),panel:$('#twin-panel'),healthDate:health?.date,detail:$('#scene-detail'),properties:data.properties,geography,coverage:modelCoverage,onProperty:goPropertyOperations,onChange:syncTwinScene,onFocus:id=>reviewedView?reviewedView.focusDevice(id):originalTwin(twinWorkspace.property)&&viewer?.focusDevice(id),onCatalog:showConfigurationCatalog,onSource:showProperty,onPlan:openOverviewPlan,onExport:payload=>downloadFile('灵之房源设备配置-'+payload.property.id+'.json',JSON.stringify(payload,null,2),'application/json;charset=utf-8')});
  renderSceneLegend();
  officialVrPlayer=createOfficialVrPlayer(id=>allProperties().find(p=>p.id===id));
  rentalMonitor=mountRentalMonitor($('#rental-monitor'),{onSelect:selectRentalOnMap});
  renderRoomDirectory();
  setMapScope('rental');
  if(healthRoute()===null)followInventoryLink();
  else mapWorkspace.setVisible(false);
 }catch(error){
  console.error('地图资料加载失败',error);
  loadFailure($('#rental-monitor'),'地图房源暂时无法读取，可在全量详情检索中查看房源。');
  loadFailure($('#scene-loading'),'地图暂时无法载入。');
  $('#geo-coverage-summary').textContent='地图清单暂不可用。';
  $('#geo-map-status').textContent='地图暂不可用';
  $('#geo-property-list').textContent='';
 }
}
function allProperties(){return [...(data?.properties || []),...rentalCommunityProperties];}
function inventoryProperties(scope='collected'){
 if(scope==='rental'||scope==='occupied')return allProperties().filter(p=>health?.has(scope,p.id));
 if(scope==='current'||scope==='current-vr')return (data?.properties||[]).filter(p=>p.currentFilteredListing===true && (scope==='current'||verifiedVrUrl(p)));
 if(scope==='beijing')return (data?.properties||[]).filter(p=>p.city==='北京' && p.publicDetailVerified===true);
 if(scope==='references')return (data?.properties||[]).filter(p=>p.reviewedRoomDemo);
 const rows=data?.properties||[];return scope==='model'?rows.filter(originalTwin):rows;
}
function selectRentalOnMap(path){
 if(!mapWorkspace)return;
 mapWorkspace.focusRentalPath(path);
 if(path.listingId)$('#scene-container').scrollIntoView({behavior:motionBehavior(),block:'center'});
}
function mapProperties(){return inventoryProperties(mapInventoryScope);}
function mapScopeNote(){return mapInventoryScope==='rental'?'待租库存 · 已匹配房源':mapInventoryScope==='occupied'?'已入住 BI · 已匹配房源':mapInventoryScope==='current-vr'?'本次官网筛选 · 已核验的实景 VR':mapInventoryScope==='current'?'本次官网筛选 · 房源已去重':mapInventoryScope==='beijing'?'北京目标房源 · 位置精确到小区':mapInventoryScope==='references'?'逐套核对的户型参考 · 小区级位置':mapInventoryScope==='model'?'有三维参考的采集房源 · 非房间精确坐标':'全部已采集房源 · 小区 / 地铁参考位置';}
function renderRoomDirectory(){
 const box=$('#room-demo-directory');
 const rows=(data?.properties||[]).filter(p=>p.reviewedRoomDemo).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
 box.hidden=!rows.length;
 $('#open-room-directory').hidden=!rows.length;
 box.querySelector('summary').textContent=rows.length+' 套三维设备运维';
 box.querySelector('.room-demo-rows').innerHTML=rows.map(p=>`<a href="#room-${esc(p.id)}" data-room-demo-id="${esc(p.id)}"><span><strong>${esc(p.name)}</strong><small>${esc(p.layout)} · ${esc(p.area)}㎡</small></span><span>进入房间 ›</span></a>`).join('');
}
function setMapScope(scope){
 if(publicOverview && scope==='occupied'){$('#map-inventory-scope').value=mapInventoryScope;openOperationsAccess('#occupied-map');return;}
 mapListingSearch?.close();
 mapInventoryScope=['model','references','beijing','current','current-vr','rental','occupied'].includes(scope)?scope:'collected';
 const cohort=['rental','occupied'].includes(mapInventoryScope);
 const initialMap=$('#initial-map');
 if(initialMap)initialMap.hidden=initialMap.dataset.scope!==mapInventoryScope;
 if(health){
  for(const property of allProperties()){
   const record=health.match(property.id,mapInventoryScope);
   property.healthRecord=record?.row;
   property.healthLabel=record ? occupancyLabels[record.scope]+' · '+health.levelName(record.row) : '';
  }
 }
 $('#rental-monitor').hidden=!cohort;
 if(cohort){
  const rows=mapProperties();
  rentalMonitor?.selectFromMap({});
  rentalMonitor?.update(rows,{pending:health?.pending(scope),date:health?.date,available:Boolean(health),label:scope==='occupied'?'已入住':'待租'});
 }
 $('#room-demo-directory').open=mapInventoryScope==='references';
 $('#map-inventory-scope').value=mapInventoryScope;mapWorkspace?.closeDetail();mapWorkspace?.update(mapProperties());
 if(state.scene==='city'){$('#scene-footnote').textContent=mapScopeNote();$('#scene-subtitle').textContent=mapInventoryScope==='model'?'已取得对应户型与照片 · 房源参考位置':'北京房源分布 · 小区级定位';}
}
function showHouseAnomalies(id){
 if(publicOverview){openOperationsAccess();return;}
 const property=allProperties().find(p=>p.id===id);
 if(!property)return;
 const selection=health?.match(id,mapInventoryScope);
 showAnomalyModal(selection?health.displayName(selection.row,selection.scope):property.name,selection,id);
}

function showAnomalyModal(title,selection,id){
 const body=selection ? health.recordDetails(selection.row,selection.scope,false,title) :
   '<p>本期暂无匹配的房源健康明细。</p><button class="button" data-home-operations>进入本套运维</button>';
 showModal(title+' · 家的异常详情',body);
 for(const button of $('#modal-body').querySelectorAll('[data-event-demo],[data-home-operations]')){
  button.onclick=()=>{
   $('#modal').close();
   if(selection)goRecordOperations(selection.row,selection.scope,button.dataset.eventDemo);
   else goPropertyOperations(id);
  };
 }
}

function openHousehold(id,selection=health?.match(id,mapInventoryScope)){
 if(publicOverview){openOperationsAccess('#household');return;}
 const scope=selection?.scope || 'occupied';
 healthAnalysis?.setMonitorScope(scope,selection?.row.version);
 if(selection)health.openRecord(scope,selection.row);
 else health?.open(scope,id,allProperties().find(p=>p.id===id)?.name);
 history.replaceState(null,'','#health-'+scope);
 showPage('household');
 if(selection)$('#household-workspace [data-selected]').scrollIntoView({block:'start'});
}

function goRecordOperations(row,scope,eventKey){
 const route='#ops/'+scope+'/'+row.operationsKey+(eventKey?'/'+encodeURIComponent(eventKey):'');
 if(!row.operationsKey){void openRecordOperations({row,scope},eventKey);return;}
 if(location.hash!==route)history.pushState(null,'',route);
 followInventoryLink();
}

function goPropertyOperations(id){
 const selection=health?.match(id,mapInventoryScope);
 if(selection){goRecordOperations(selection.row,selection.scope);return;}
 const route='#ops/listing/'+encodeURIComponent(id);
 if(location.hash!==route)history.pushState(null,'',route);
 followInventoryLink();
}

function openRecordOperations(selection,eventKey){
 const {row}=selection;
 const publicProperty=row.mapId && allProperties().find(p=>p.id===row.mapId);
 const property=publicProperty || {id:'health-'+selection.scope+'-'+(row.operationsKey || row.row),
   name:row.areaLabel || health.displayName(row,selection.scope),product:row.version,floor:row.floor,healthOnly:true};
 return openTwin(property.id,undefined,'3d',eventKey,{...selection,property});
}

function showPage(page,scroll=true){
 const labels={overview:['运维总览','北京待租库存与已入住房源健康'],household:['家的运维监控','北京待租与已入住房源 · 产品健康分布与异常排行'],anomalies:['全量详情检索','查找北京待租与已入住房源，查看服务管家、健康等级和异常项。'],severe:['安全监控异常','北京待租与已入住房源的安全报警']};
 if(!labels[page])return;
 if(page!=='overview'){closeOverviewPlan();closeReviewedView();mapListingSearch?.close();}
 state.page=page;document.body.dataset.page=page;syncHeader();
 $$('.page').forEach(p=>p.classList.toggle('active',p.id===page+'-page'));$$('.nav-item[data-page]').forEach(b=>{b.classList.toggle('active',b.dataset.page===page);if(b.dataset.page===page)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 $('#page-title').textContent=labels[page][0];$('#page-description').textContent=labels[page][1];
 mapWorkspace?.setVisible(page==='overview'&&state.scene==='city');viewer?.setActive(page==='overview'&&state.scene==='apartment'&&originalTwin(activeOperation?.property));
 if(page==='overview')requestAnimationFrame(()=>{mapWorkspace?.resize();viewer?.resize();});
 if(scroll)window.scrollTo({top:page==='overview'?$('#app').getBoundingClientRect().top+window.scrollY-150:0,behavior:motionBehavior()});
}
function showConfigurationCatalog(device){showModal(device?device.name+' · 型号与配置':'心舍 3.0.1 · 设备配置依据',configurationCatalogHtml(device));}
function closeReviewedView(){
 reviewedView?.destroy();reviewedView=null;reviewedId=null;$('#reviewed-twin-stage').hidden=true;
}
function syncTwinScene(){
 if(!twinWorkspace || (activeOperation && twinWorkspace.propertyId!==activeOperation.property.id))return;
 if(state.scene==='apartment' && activeOperation){activeOperation.event=twinWorkspace.selectedEvent;updateOperationStage();}
 if(overviewPlanView && state.scene==='apartment' && overviewPlanId===twinWorkspace.propertyId){
  const options=twinWorkspace.configurationOptions(),signature=JSON.stringify(options);
  if(signature!==overviewTwinOptions){overviewPlanView.setConfigurationOptions(options);overviewTwinOptions=signature;}
 }
 if(state.scene==='apartment' && reviewedView && reviewedId===twinWorkspace.propertyId){
  reviewedView.setConfigurationOptions(twinWorkspace.configurationOptions());
  reviewedView.setOperations({result:twinWorkspace.result,showLabels:twinWorkspace.showLabels});
 }
 if(state.scene==='apartment'&&originalTwin(twinWorkspace.property)&&viewer?.apartment){
  const result=viewer.setDeviceConfiguration(twinWorkspace.configuration.devices,{event:twinWorkspace.selectedEvent,propertyId:twinWorkspace.propertyId,profile:twinWorkspace.profile});
  viewer.setDeviceLabelsVisible(twinWorkspace.showLabels);twinWorkspace.setResult(result);
 }
 renderSceneLegend();
}
function selectOperation(property,selection,eventKey) {
 const row=selection?.row;
 const events=houseEvents(row);
 return {property,row,scope:selection?.scope,event:events.find(e=>e.key===eventKey),snapshotOnly:!!(property.rentalCommunity || property.healthOnly)};
}

function updateOperationStage(){
 const stage=$('#twin-empty');
 if(state.scene!=='apartment' || !activeOperation){stage.hidden=true;return;}
 const {property,row,event}=activeOperation;
 if(!canOpenModel(property)){
  renderOperationsStage(stage,{property,row,event,date:health?.date,grade:row && health.levelName(row),
   plan:planCatalog.get(property.id),onPlan:()=>openOverviewPlan(property.id,twinWorkspace.profile),onSource:()=>showProperty(property.id)});
  stage.hidden=false;
 }else stage.hidden=true;
 const buttons=$('#home-run-panel').querySelectorAll('[data-event-demo]');
 for(const button of buttons)button.setAttribute('aria-pressed',String(button.dataset.eventDemo===event?.key));
}

function renderOperationPanel(){
 const panel=$('#home-run-panel');
 if(state.scene!=='apartment' || !activeOperation){panel.hidden=true;return;}
 const {property,row,scope}=activeOperation;
 panel.hidden=false;
 const details=row ? health.recordDetails(row,scope,Boolean(row.mapId),health.displayName(row,scope),true) : '<p>当前健康快照暂无这套房源的记录。</p>';
 const context=[occupancyLabels[scope] || '',row?.version || property.product,
  row?.product!==row?.version?row?.product:'',row && health.date].filter(Boolean).map(esc).join(' · ');
 panel.innerHTML=`<header><h2 id="home-run-heading" tabindex="-1">本套运行明细</h2><small>${context}</small></header>${details}`;
}
$('#home-run-panel').addEventListener('click',e=>{
 const button=e.target.closest('button');
 if(!button || !activeOperation)return;
 const {property,row,scope,snapshotOnly}=activeOperation;
 if(button.hasAttribute('data-locate') && row?.mapId){
  history.pushState(null,'','#map-listing-'+row.mapId);
  setMapScope(scope);void showScene('city').then(()=>mapWorkspace.focusProperty(row.mapId,{reveal:false}));
 }
 if(button.hasAttribute('data-event-demo')){
  const key=button.dataset.eventDemo;
  activeOperation.event=houseEvents(row).find(event=>event.key===key);
  if(!snapshotOnly)twinWorkspace.setScenario(key);
  else updateOperationStage();
  const target=canOpenModel(property)?$('#twin-controls'):$('#twin-empty');
  target.scrollIntoView({block:'center',behavior:motionBehavior()});
 }
});

async function openTwin(id=MODEL_PROPERTY_ID,profile,initialMode='3d',eventKey,selection){
 const property=selection?.property || allProperties().find(p=>p.id===String(id));
 if(!property)return;
 activeOperation=selectOperation(property,selection || health?.match(id,mapInventoryScope),eventKey);
 closeOverviewPlan();
 activeTwinPropertyId=property.id;
 if(!activeOperation.snapshotOnly){
  twinWorkspace?.open(property.id,profile,eventKey,activeOperation.row);
  activeOperation.event=twinWorkspace?.selectedEvent;
 }
 await showScene('apartment',initialMode);
 if(eventKey && state.scene==='apartment' && activeOperation?.property===property && !activeOperation.snapshotOnly && canOpenModel(property))
  $('#twin-controls').scrollIntoView({block:'start',behavior:motionBehavior()});
}
async function showScene(mode,initialMode='3d'){
 if(!mapWorkspace){toast('房源资料正在加载，请稍后。');return;}
 const returningFromApartment=state.scene==='apartment' && mode==='city';
 if(mode!==state.scene){closeOverviewPlan();mapListingSearch?.close();}
 showPage('overview',false);
 state.scene=mode;document.body.dataset.scene=mode;state.activeDevice=null;$$('button[data-scene]').forEach(b=>b.classList.toggle('selected',b.dataset.scene===mode));$('#rotate-btn').classList.remove('active');$('#top-view-btn').classList.remove('active');$('#scene-detail').hidden=true;
 if(!activeOperation){
  const initial=allProperties().find(p=>p.id===activeTwinPropertyId);
  if(initial)activeOperation=selectOperation(initial,health?.match(initial.id,mapInventoryScope));
 }
 const {property,row,scope,snapshotOnly}=activeOperation || {};
 const referenceReady=canOpenModel(property), apartment=mode==='apartment';
 if(apartment && !property)return;
 const reviewed=apartment && property?.reviewedRoomDemo===true;
 const jump=$('#jump-to-room-devices');
 jump.hidden=!apartment;
 jump.textContent=snapshotOnly?'查看运行明细 ↓':'查看设备 ↓';
 jump.setAttribute('aria-controls',snapshotOnly?'home-run-panel':'twin-panel');
 if(!reviewed || reviewedId!==property.id)closeReviewedView();
 twinWorkspace?.setVisible(apartment && !snapshotOnly);
 renderOperationPanel();updateOperationStage();$('.geo-panel').hidden=mode!=='city';
 mapWorkspace.setVisible(mode==='city');viewer?.setActive(false);
 if(returningFromApartment && mapWorkspace.selectedId===activeTwinPropertyId)mapWorkspace.setPlanProfile(activeTwinPropertyId,twinWorkspace.profile);
 $('#map-listing-search').hidden=mode!=='city';$('#geo-filters').hidden=mode!=='city';$('#geo-map-status').hidden=mode!=='city';$('#geo-terrain-btn').hidden=mode!=='city';
 $('#scene-labels').hidden=mode!=='apartment'||!referenceReady;$('.scene-orientation').hidden=mode!=='apartment'||!referenceReady;
 $('.render-mode-note')?.toggleAttribute('hidden',mode!=='apartment'||!originalTwin(property));
 if(reviewed){$('#scene-labels').hidden=true;$('.scene-orientation').hidden=true;}
 $('#scene-title').textContent=mode==='city'?'灵之房源运维监控大盘':(snapshotOnly && row?health.displayName(row,scope):property.name)+' · '+(referenceReady?'三维设备运维':'房源运维');
 $('#scene-subtitle').textContent=mode==='city'?(mapInventoryScope==='model'?'已取得对应户型与照片 · 房源参考位置':'北京房源分布 · 小区级定位'):`${property.areaScope==='listed_bedroom'?'卧室 ':''}${property.area??'—'}㎡ · ${property.areaScope==='listed_bedroom'?'合租单间（所属'+(property.bedrooms??'—')+'居）':(property.bedrooms??'—')+'居'} · ${referenceReady?'官方户型 / 照片近似重建':property.publicFloorplanUrl?'已有本套户型与配置方案':'户型图待补 · 可查看配置方案'}`;
 if(apartment && snapshotOnly)$('#scene-subtitle').textContent=[occupancyLabels[scope],row?.version,row && health.levelName(row)].filter(Boolean).join(' · ');
 else if(apartment && row)$('#scene-subtitle').textContent+=' · '+health.levelName(row);
 $('#scene-breadcrumb').innerHTML=mode==='city'?'<span>北京</span><span class="crumb-divider">/</span><strong>全部区域</strong>':`<button class="text-btn" id="back-city">北京</button><span class="crumb-divider">/</span><span>${esc(property.district || (row?.areaLabel?.includes(' · ')?row.areaLabel.split(' · ')[0]:'区域待确认'))}</span><span class="crumb-divider">/</span><strong>${esc(property.name)}</strong>`;
 if($('#back-city'))$('#back-city').onclick=()=>{location.hash=scope==='occupied'?'occupied-map':'rental-map';};
 $('#scene-footnote').textContent=mode==='city'?mapScopeNote():snapshotOnly?'本期健康明细 · 房源级记录':'方案配置推演 · 实装与遥测待接入';
 renderSceneLegend();
 $('#apartment-actions').hidden=mode!=='apartment';
 const vr=$('#reviewed-source-vr');
 vr.hidden=mode!=='apartment' || !verifiedVrUrl(property);
 if(vr.hidden){vr.removeAttribute('href');delete vr.dataset.officialVr;}
 else{vr.href='#vr-'+property.id;vr.dataset.officialVr=property.id;}
 $('#apartment-actions>span').hidden=!referenceReady;
 $('#reference-btn').hidden=$('#cutaway-btn').hidden=!!snapshotOnly;
 $('#reset-camera').disabled=apartment && !referenceReady;
 $('#reference-btn').disabled=!referenceReady;$('#cutaway-btn').disabled=!referenceReady;
 $('.map-panel').scrollIntoView({behavior:motionBehavior(),block:'start'});
 if(mode==='city'){
  $('#scene-loading').hidden=['webgl','leaflet','failed'].includes(mapWorkspace.mode);
  $('#top-view-btn').disabled=mapWorkspace.mode!=='webgl';$('#rotate-btn').disabled=mapWorkspace.mode!=='webgl';
  mapWorkspace.resize();
 }else{
  $('#top-view-btn').disabled=!referenceReady;$('#rotate-btn').disabled=!referenceReady;$('#scene-loading').hidden=!referenceReady;
  if(!referenceReady){$('#scene-labels').hidden=true;return;}
  if(reviewed){
   const host=$('#reviewed-twin-stage');host.hidden=false;$('#scene-loading').hidden=true;
   if(!reviewedView){
    reviewedId=property.id;
    reviewedView=mountListingPlanViewer(host,{property,plan:planCatalog.get(property.id),profile:twinWorkspace.profile,
      configurationOptions:twinWorkspace.configurationOptions(),initialMode,nativeOperations:true,
      onDeviceSelect:id=>{if(reviewedId===property.id && twinWorkspace.propertyId===property.id){
       state.activeDevice=id;twinWorkspace.selectDevice(id,false);
      }}});
   }else if(initialMode==='room'){void reviewedView.setMode('room');}
   syncTwinScene();await reviewedView.ready;return;
  }
  try{
   if(!viewer){
    const {SceneViewer}=await import('./scene-viewer.js');
    if(state.scene!=='apartment' || activeTwinPropertyId!==property.id)return;
    viewer??=new SceneViewer($('#scene-container'),{geojson:geo,districts:[],onDistrict:showDistrict,onDevice:showDevice,active:false});
    if(viewer.software){const note=document.createElement('span');note.className='render-mode-note';note.textContent='兼容渲染 · 完整材质需 WebGL';$('#scene-container').append(note);}
   }
   await viewer.show('apartment');
   if(state.scene!=='apartment'||activeTwinPropertyId!==property.id)return;
   viewer.setActive(true);syncTwinScene();
  }catch(error){console.error(error);toast('三维房源模型未能加载，可继续使用地图和房源清单。');}
  finally{if(state.scene==='apartment')$('#scene-loading').hidden=true;}
 }
}
function showDistrict(id){
 state.activeDevice=null;showScene('city');mapWorkspace?.focusDistrict(id);
}
function renderSceneLegend(){
 if(state.scene==='apartment' && activeOperation?.snapshotOnly){$('#scene-legend').textContent='家的运维监控';return;}
 $('#scene-legend').innerHTML=state.scene==='city'?cityMapKey:'<span><i class="legend-dot"></i>状态未接入</span><span><i class="legend-dot amber"></i>链路受影响</span><span><i class="legend-dot red"></i>演示异常 / 告警</span>';
}
function showDevice(id){
 if(!twinWorkspace){toast('设备配置正在载入。');return;}
 const mapped=twinWorkspace.findLegacyDevice(id);
 if(mapped){state.activeDevice=mapped;twinWorkspace.selectDevice(mapped);return;}
 toast('该设备未包含在当前配置中，可切换方案或查看配置依据。');
}
function showProperty(id){
 const property=allProperties().find(p=>p.id===String(id));if(!property)return;
 const coverageRecord=modelCoverage?.properties?.find(record=>String(record.id)===property.id);
 const row=currentInventoryHierarchy().rows.find(record=>record.id===property.id)||{id:property.id,property,city:'北京',district:property.district,businessKey:'__unknown__',businessName:'商圈待核验',businessVerified:false,businessCandidate:null,communityName:property.name,bedroomGroup:housingGroup(property),realListingId:listingIdentity(property),referenceReady:false,floorplanCount:0,interiorPhotoCount:0,vrUrl:null,vrVerified:false,deviceInstallationVerified:false,telemetryConnected:false,pendingEvents:[],observedAt:property.observedAt};
 showModal(property.name+' · 房源详情','<div id="property-detail-root" class="property-detail-shell"></div>');
 $('#modal').classList.add('property-detail-modal');
 propertyDetailController=mountPropertyDetail($('#property-detail-root'),{row,coverageRecord,
  onTwin:propertyId=>{$('#modal').close();goPropertyOperations(propertyId);},
  onPlan:openListingPlan,
  onHousehold:propertyId=>{$('#modal').close();openHousehold(propertyId);},
  onReferences:propertyId=>showReferences(propertyId),
  onMap:async propertyId=>{$('#modal').close();setMapScope('collected');await showScene('city');mapWorkspace?.focusProperty(propertyId,{reveal:false});}
 });
}
function closeOverviewPlan(){
 if(!overviewPlanView)return;
 overviewPlanView.destroy();overviewPlanView=null;overviewPlanId=null;overviewTwinOptions='';
 $('#overview-plan-pane').hidden=true;
 $('#scene-detail [data-geo-action="plan"]')?.setAttribute('aria-expanded','false');
}
function openOverviewPlan(id,profile='base'){
 const property=allProperties().find(p=>p.id===String(id));
 if(!property || state.page!=='overview')return;
 if(state.scene==='city' && mapWorkspace?.selectedId!==property.id)return;
 if(state.scene==='apartment' && activeTwinPropertyId!==property.id)return;
 const pane=$('#overview-plan-pane');
 if(overviewPlanId!==property.id){
  closeOverviewPlan();
  pane.hidden=false;
  overviewPlanId=property.id;
  const configurationOptions=state.scene==='apartment'?twinWorkspace.configurationOptions():{};
  overviewTwinOptions=JSON.stringify(configurationOptions);
  overviewPlanView=mountListingPlanViewer($('#overview-plan-root'),{property,plan:planCatalog.get(property.id)||null,profile,configurationOptions});
 }
 $('#scene-detail [data-geo-action="plan"]')?.setAttribute('aria-expanded','true');
 $('#overview-plan-close').focus({preventScroll:true});
 pane.scrollIntoView({behavior:motionBehavior(),block:'start'});
}
function openListingPlan(id,profile='base'){
 const property=allProperties().find(p=>p.id===String(id));
 if(!property)return;
 if(canOpenModel(property) && !planCatalog.has(property.id)){
  if($('#modal').open)$('#modal').close();
  openTwin(property.id);return;
 }
 showModal(property.name+' · 户型与设备','<div id="listing-plan-root"></div>');
 $('#modal').classList.add('property-detail-modal');
 listingPlanView=mountListingPlanViewer($('#listing-plan-root'),{property,plan:planCatalog.get(property.id)||null,profile});
}
function disposeListingPlan(){
 listingPlanView?.destroy();listingPlanView=null;
}
function showModal(title,body){disposeListingPlan();propertyDetailController?.destroy?.();propertyDetailController=null;$('#modal').classList.remove('property-detail-modal');$('#modal-title').textContent=title;$('#modal-body').innerHTML=body;$('#modal').showModal();hydrateIcons($('#modal'));}
function showSources(){
 showModal('数据来源','<h3>可立即入住（待租中）</h3><p>'+esc(health?.sourceFile('rental') || '可立即入住房源_新口径')+'，取城市为北京、库存状态为 201 的房源。</p><h3>已入住</h3><p>'+esc(health?.sourceFile('occupied') || '健康度_已入住BI口径')+'，取北京交付房源明细，剔除智爱家。安全事件按类型按天累计，每类每周最多7次。设备离线仅统计网关当日在线的设备，排除空调、门锁和浴霸。</p>'+ (health?.overlapHomes ? '<p>两份明细共有 '+esc(health.overlapHomes)+' 套房源重合，分别计入对应来源，全量按房源编号去重。</p>' : '') +'<h3>地图与室内资料</h3><p>地图使用官网核实的小区位置，地图数据来自 OpenStreetMap，地形来自 Mapzen / AWS。室内三维为户型参考，官方 VR 由自如提供。</p>');
}
let referenceGallery=null;
function showReferences(propertyId){
 const id=typeof propertyId==='string'?propertyId:activeTwinPropertyId;
 const property=allProperties().find(row=>row.id===id),record=modelCoverage?.properties?.find(row=>row.id===id);
 referenceGallery?.destroy?.();
 showModal((property?.name||'房源')+' · 原始资料对照','<div id="reference-gallery"></div>');
 referenceGallery=mountReferenceGallery($('#reference-gallery'),{record,onViewModel:canOpenModel(property)?async()=>{$('#modal').close();await openTwin(property.id);$('#top-view-btn').classList.toggle('active',!!activeScene()?.toggleTop());}:null});
}
function downloadFile(name,text,type='text/plain;charset=utf-8'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function focusOverviewTarget(target, region=target){
 if(!target)return;
 if(document.fullscreenElement && !document.fullscreenElement.contains(target)){
  await document.exitFullscreen();
 }
 target.focus({preventScroll:true});
 region.scrollIntoView({block:'start',behavior:motionBehavior()});
}
$('#open-room-directory').onclick=()=>{
 const directory=$('#room-demo-directory');
 directory.open=true;
 void focusOverviewTarget(directory.querySelector('summary'));
};
$('#jump-to-room-devices').onclick=()=>{
 const heading=activeOperation?.snapshotOnly?$('#home-run-heading'):$('#twin-device-heading');
 if(heading)void focusOverviewTarget(heading,heading.parentElement);
};
$('#twin-panel').addEventListener('click',event=>{
 if(event.target.closest('#return-to-room-scene'))void focusOverviewTarget($('#scene-title'));
});

$('#room-demo-directory').addEventListener('click',event=>{
 const link=event.target.closest('[data-room-demo-id]');
 if(link && location.hash===link.hash){event.preventDefault();void openTwin(link.dataset.roomDemoId,undefined,'room');}
});
function healthRoute(){
 const requestedView=new URLSearchParams(location.search).get('view');
 switch(location.hash || (requestedView ? '#'+requestedView : '')){
  case '#anomalies':return 'anomalies';
  case '#severe':return 'severe';
  case '#health-standards':case '#household':case '#health-rental':case '#health-occupied':return 'household';
  default:return null;
 }
}
function followInventoryLink(){
 const page=healthRoute();
 if(page){
  if(page==='household'){
   healthAnalysis?.setMonitorScope(location.hash==='#health-rental'?'rental':location.hash==='#health-occupied'?'occupied':'');
   health?.open();
  }
  showPage(page);
  if(location.hash==='#health-standards' && !$('#health-standards').matches(':popover-open'))$('#health-standards').showPopover();
  return;
 }
 if(!data || !twinWorkspace || !mapWorkspace){showPage('overview',false);return;}
 if(officialVrPlayer?.handleRoute(location.hash))return;
 const operationRoute=location.hash.match(/^#ops\/(rental|occupied|listing)\/([a-zA-Z0-9-]+)(?:\/([a-z]+-\d+))?$/);
 if(operationRoute){
  if($('#modal').open)$('#modal').close();
  const [,scope,key,event]=operationRoute;
  if(publicOverview && scope!=='listing'){showPage('household');openOperationsAccess();return;}
  if(scope==='listing' && allProperties().some(p=>p.id===key)){void openTwin(key);return;}
  const selection=health?.route(scope+'/'+key);
  if(selection){void openRecordOperations(selection,event);return;}
  showPage('household');health?.open(scope==='rental'?'rental':'occupied');toast('本期快照中没有这套房源。');return;
 }
 const roomId=location.hash.match(/^#room-(\d+)$/)?.[1];
 if(roomId){
  const p=data.properties.find(row=>row.id===roomId && row.reviewedRoomDemo);
  if(!p){toast('这套房源暂无已核验的室内三维演示。');return;}
  if($('#modal').open)$('#modal').close();
  void openTwin(p.id,undefined,'room');return;
 }
 const mapId=location.hash.match(/^#map-listing-(\d+|map-sample-\d+|rental-[a-f0-9]{16})$/)?.[1];
 if(mapId){
  if($('#modal').open)$('#modal').close();
  const known=allProperties().some(p=>String(p.id)===mapId);
  setMapScope(mapId.startsWith('rental-')?'rental':mapId.startsWith('map-sample-')?'collected':'beijing');
  mapWorkspace.reset();
  void showScene('city').then(()=>{if(location.hash==='#map-listing-'+mapId && known)mapWorkspace.focusProperty(mapId,{reveal:false});});
  if(!known)toast('当前北京台账中未找到这套房源。');
  return;
 }
 const planId=location.hash.match(/^#plan-(\d+)$/)?.[1];
 if(planId){openListingPlan(planId);return;}
 switch(location.hash){
  case '#overview': showNavPage('overview');break;
  case '#rental-map':
  case '#occupied-map': {
   const hash=location.hash;setMapScope(hash==='#rental-map'?'rental':'occupied');mapWorkspace.reset();
   void showScene('city').then(()=>{if(location.hash===hash)$('#scene-title').scrollIntoView({block:'start'});});
   break;
  }
  case '#rental-monitor':
   setMapScope('rental');mapWorkspace.reset();
   void showScene('city').then(()=>{if(location.hash==='#rental-monitor')$('#rental-monitor').scrollIntoView({block:'start'});});
   break;
  case '#beijing-current':
  case '#beijing-map':
  case '#floorplan-references':
   setMapScope(location.hash==='#floorplan-references'?'references':location.hash==='#beijing-current'?'current':'beijing');
   mapWorkspace?.reset();
   showScene('city');break;
 }
}
window.addEventListener('hashchange',followInventoryLink);
function motionBehavior(){return window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';}
function syncHeader(){document.body.classList.add('header-scrolled');}
function showNavPage(page){
 if(page==='overview' && mapWorkspace && state.scene!=='city')return showScene('city');
 showPage(page);
}
$('#brand-home').onclick=e=>{e.preventDefault();if(location.hash==='#overview')showNavPage('overview');else location.hash='overview';};
$('.footer-brand').onclick=$('#brand-home').onclick;
syncHeader();
$$('.nav-item[data-page]').forEach(b=>b.onclick=event=>{
 event.preventDefault();
 const hash='#'+b.dataset.page;
 if(location.hash===hash)followInventoryLink();else location.hash=hash;
});
$$('button[data-scene]').forEach(button=>button.onclick=()=>{
 if(button.dataset.scene==='apartment' && state.scene==='city'){
  if(!mapWorkspace?.selectedId && activeOperation?.row)return goRecordOperations(activeOperation.row,activeOperation.scope);
  return goPropertyOperations(mapWorkspace?.selectedId || activeTwinPropertyId);
 }
 if(button.dataset.scene==='city' && location.hash.startsWith('#ops/')){location.hash=activeOperation?.scope==='occupied'?'occupied-map':'rental-map';return;}
 return showScene(button.dataset.scene);
});
$('#overview-plan-close').onclick=()=>{
 closeOverviewPlan();
 const opener=state.scene==='city'?$('#scene-detail [data-geo-action="plan"]'):$('#twin-empty [data-open-plan]');
 opener?.focus();
};
$('#overview-plan-root').addEventListener('change',event=>{
 if(!event.target.matches('select[data-profile]'))return;
 if(state.scene==='city')mapWorkspace?.setPlanProfile(overviewPlanId,event.target.value);
 else if(twinWorkspace?.propertyId===overviewPlanId)twinWorkspace.setProfile(event.target.value);
});
$('#show-apartment-btn').onclick=()=>goPropertyOperations(MODEL_PROPERTY_ID);
$('#apartment-running-btn').onclick=()=>openHousehold(activeTwinPropertyId,activeOperation?.row?activeOperation:undefined);
 $('#map-inventory-scope').addEventListener('change',event=>setMapScope(event.target.value));
const activeScene=()=>state.scene==='city'?mapWorkspace:(reviewedView||viewer);
$('#reset-camera').onclick=()=>{activeScene()?.reset();$('#scene-detail').hidden=true;$('#top-view-btn').classList.remove('active');$('#rotate-btn').classList.remove('active');activeScene()?.setRotate(false);};
$('#rotate-btn').onclick=()=>{const active=!$('#rotate-btn').classList.contains('active');$('#rotate-btn').classList.toggle('active',!!activeScene()?.setRotate(active));};
$('#top-view-btn').onclick=()=>$('#top-view-btn').classList.toggle('active',!!activeScene()?.toggleTop());
$('#geo-terrain-btn').onclick=()=>mapWorkspace?.toggleTerrain();
$('#fullscreen-btn').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('.map-panel').requestFullscreen();}catch{toast('当前浏览器未开启全屏，可放大页面查看。');}};
$('#reference-btn').onclick=showReferences;$('#cutaway-btn').onclick=()=>{const cutaway=activeScene()?.toggleWalls();$('#cutaway-btn').innerHTML=icon('layers')+(cutaway?'显示完整墙体':'恢复剖切视图');};
$('#source-btn').onclick=showSources;$('#nav-data').onclick=showSources;$('#footer-source').onclick=showSources;
$('#modal-close').onclick=()=>$('#modal').close();$('#modal').addEventListener('close',()=>{if(!$('#modal').open)disposeListingPlan();});$('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))$('#modal').close();});
init();
