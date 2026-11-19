import { SceneViewer } from './scene-viewer.js';

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
state.page='overview';state.scene='city';state.activeEvent=null;
let data,ops,geo,viewer;let diagnosisTimer=null;
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
  [data,ops,geo]=await Promise.all(['properties.json','ops-source.json','beijing.geojson'].map(async n=>{const r=await fetch('./ops/assets/'+n);if(!r.ok)throw Error(n+' 加载失败');return r.json();}));
  renderAll();
  const districts=data.districts.map(d=>{const feature=geo.features.find(f=>f.properties.name.replace(/区$/,'')===d.name);const cp=feature?.properties?.centroid||feature?.properties?.center;return {...d,count:parseInt(d.countLabel),labelLng:cp?.[0],labelLat:cp?.[1]};}).filter(d=>Number.isFinite(d.labelLng));
  try{viewer=new SceneViewer($('#scene-container'),{geojson:geo,districts,onDistrict:showDistrict,onDevice:showDevice});}
  catch(error){console.error(error);$('#scene-loading').innerHTML=`<div class="loading-error">${icon('cube')}<p>当前浏览器无法创建 WebGL 三维场景。</p><p>房源、设备和数字员工工作台仍可使用。</p><button class="button" id="fallback-property">查看房源列表</button></div>`;$('#fallback-property').onclick=()=>showPage('properties');}
  if(viewer?.software){const note=document.createElement('span');note.className='render-mode-note';note.textContent='兼容渲染 · 完整材质需 WebGL';$('#scene-container').append(note);}
  const special=document.createElement('button');special.className='map-special';special.innerHTML='亦庄开发区 <b>1 套</b><small>独立统计</small>';special.onclick=()=>showDistrict('亦庄开发区');$('#scene-container').append(special);
  if(!state.activities.length)state.activities=[{title:'健康监控员 · 待核验事件',body:'4 条演示事件已按影响与优先级排列。',kind:'network',time:'演示初始化'},{title:'经验蒸馏师 · 资料已准备',body:'“同户多设备离线”技能草案等待专家核验。',kind:'book',time:'演示初始化'}];
  renderActivity();
 }catch(error){console.error(error);toast('资料加载失败，请刷新页面重试。');$('#scene-loading').textContent='资料未能加载，请刷新页面。';}
}
function renderAll(){renderEvents();renderActivity();renderModelTables();renderProperties();renderAgents();renderTickets();$('#sample-count').textContent=allProperties().length;hydrateIcons();}
function allProperties(){const m=new Map((data?.properties||[]).map(p=>[p.id,p]));for(const p of state.imported||[])m.set(p.id,p);return [...m.values()];}
function showPage(page){state.page=page;$$('.page').forEach(p=>p.classList.toggle('active',p.id===page+'-page'));$$('.nav-item[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));const labels={overview:['全域运维','从一套房、一个设备出发，让每个异常都有处理结果。'],properties:['房源资产','从区域到一套房，连接房源资料、设备与处理记录。'],devices:['设备监控','保留数据口径，让异常排名真正支持核验与行动。'],agents:['数字员工','岗位、责任与成果清晰可见，持续沉淀专家经验。'],tickets:['事件工单','发现、诊断、跟进与复验，形成可追溯的处理闭环。']};$('#page-title').textContent=labels[page][0];$('#page-description').textContent=labels[page][1];if(page==='overview')requestAnimationFrame(()=>viewer?.resize());window.scrollTo({top:0,behavior:'smooth'});}
async function showScene(mode){
 if(!viewer){toast('三维场景尚未就绪。');return;}
 showPage('overview');
 try{await viewer.show(mode);}catch(error){console.error(error);toast('三维房源模型未能加载，请刷新重试。');return;}
 state.scene=mode;state.activeDevice=null;$$('[data-scene]').forEach(b=>b.classList.toggle('selected',b.dataset.scene===mode));$('#rotate-btn').classList.remove('active');$('#top-view-btn').classList.remove('active');$('#scene-detail').hidden=true;
 $('#scene-title').textContent=mode==='city'?'北京灵之房源分布':'望京路3号院 · 三维房源样板';
 $('#scene-subtitle').textContent=mode==='city'?'区域聚合视图 · 点击区域查看房源':'50.83㎡ · 1室1厅 · 5/7层 · 据实际户型与照片重建';
 $('#scene-breadcrumb').innerHTML=mode==='city'?'<span>北京</span><span class="crumb-divider">/</span><strong>全部区域</strong>':'<button class="text-btn" id="back-city">北京</button><span class="crumb-divider">/</span><span>朝阳</span><span class="crumb-divider">/</span><strong>望京路3号院</strong>';
 if($('#back-city'))$('#back-city').onclick=()=>showScene('city');
 $('#scene-footnote').textContent=mode==='city'?'行政区聚合，非楼栋精确定位':'结构按参考重建 · 设备位置与状态为演示';
 renderSceneLegend();
 $('#apartment-actions').hidden=mode!=='apartment';$('.map-special').hidden=mode!=='city';
 viewer.setDeviceState('gateway',state.events[0].status==='resolved'?'online':'offline');
}
function showDistrict(id){
 state.activeDevice=null;
 const d=data.districts.find(d=>d.id===id);if(!d)return;viewer?.focusDistrict(id);
 $('#scene-breadcrumb').innerHTML=`<button class="text-btn" id="clear-region">北京</button><span class="crumb-divider">/</span><strong>${esc(d.name)}</strong>`;$('#clear-region').onclick=()=>{viewer?.reset();$('#scene-detail').hidden=true;$('#scene-breadcrumb').innerHTML='<span>北京</span><span class="crumb-divider">/</span><strong>全部区域</strong>';};
 const samples=allProperties().filter(p=>p.district===id);
 $('#scene-detail').hidden=false;$('#scene-detail').innerHTML=`<button class="icon-btn close-scene-detail" aria-label="关闭区域详情">${icon('close')}</button><h3>${esc(d.name)} · 灵之房源</h3><div class="district-count">${esc(d.countLabel)} <small>套可租 · 地图原标签</small></div><p>本 Demo 已收录 ${samples.length} 条列表样本。区域信标不表示具体房源地址。</p><button class="button" id="district-properties">查看该区样本</button>`;
 $('.close-scene-detail').onclick=()=>$('#scene-detail').hidden=true;$('#district-properties').onclick=()=>{showPage('properties');$('#district-select').value=id;renderPropertiesList();};
}
function renderSceneLegend(){
 const resolved=state.events[0].status==='resolved';
 $('#scene-legend').innerHTML=state.scene==='city'?'<span><i class="legend-dot blue"></i>灵之可租房源</span><span><i class="legend-dot amber"></i>演示事件</span>':`<span><i class="legend-dot blue"></i>演示设备</span><span><i class="legend-dot ${resolved?'blue':'amber'}"></i>${resolved?'网关演示已恢复':'待核验网关'}</span>`;
}
function showDevice(id){
 state.activeDevice=id;
 const names={gateway:'智控网关','living-light':'客厅照明','bedroom-ac':'空调控制器','door-lock':'智能门锁','smoke-sensor':'烟雾传感器','water-sensor':'水浸传感器','curtain-sensor':'窗帘传感器'};
 $('#scene-detail').hidden=false;$('#scene-detail').innerHTML=`<button class="icon-btn close-scene-detail" aria-label="关闭设备详情">${icon('close')}</button><h3>${esc(names[id]||id)}</h3><span class="tag ${id==='gateway'&&state.events[0].status!=='resolved'?'amber':'blue'}">${id==='gateway'&&state.events[0].status!=='resolved'?'演示离线':'演示在线'}</span><p>设备安装位置和遥测均为演示，不代表该房源实际设备配置。</p><button class="button" id="device-action">${id==='gateway'?'查看关联事件':'查看设备信息'}</button>`;
 $('.close-scene-detail').onclick=()=>$('#scene-detail').hidden=true;$('#device-action').onclick=()=>id==='gateway'?openEvent('EVT-DEMO-001'):showModal('演示设备 · '+(names[id]||id),`<div class="source-state"><span class="tag amber">演示遥测</span><span>尚未接入生产设备</span></div><p>该部件用于展示在三维房源中定位、核查与跟进设备的交互。</p><table><tbody><tr><td>演示对象</td><td>${esc(names[id]||id)}</td></tr><tr><td>房源</td><td>望京路3号院</td></tr><tr><td>设备位置</td><td>业务演示布点，未经现场核验</td></tr><tr><td>接入方式</td><td>待接真实设备台账、网关关系和心跳接口</td></tr></tbody></table>`);
}
function renderEvents(){
 const open=state.events.filter(e=>e.status!=='resolved');$('#open-events').textContent=open.length;$('#event-count').textContent=open.length;$('#events-sub').textContent=`${open.filter(e=>e.priority==='P1').length} 项优先处理`;
 const events=open.filter(e=>state.eventFilter==='all'||e.priority===state.eventFilter);
 $('#event-list').innerHTML=events.length?events.map(e=>`<button class="event-item" data-event="${e.id}"><div class="event-item-top"><span class="priority ${e.priority.toLowerCase()}">${e.priority}</span><strong>${esc(e.title)}</strong></div><div class="event-item-meta"><span>${esc(e.property)}</span><span>${esc(e.age)}</span></div><div class="event-item-bottom">${icon('agent')}<span>${esc(e.status==='ticketed'?'已生成工单草稿':e.status==='diagnosed'?'诊断建议待核验':e.agent.split(' ')[1])}</span></div></button>`).join(''):`<div class="empty-state">${icon('check')}<h3>当前筛选无待办</h3><p>演示流程可以在工单中心查看。</p></div>`;
 $$('[data-event]').forEach(el=>el.onclick=()=>openEvent(el.dataset.event));
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
function renderProperties(){const current=$('#district-select').value;$('#district-select').innerHTML='<option value="">全部区域</option>'+data.districts.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');$('#district-select').value=current;renderPropertiesList();}
function renderPropertiesList(){
 const q=$('#property-search').value.trim().toLowerCase(),district=$('#district-select').value;const props=allProperties().filter(p=>(!district||p.district===district)&&(!q||[p.name,p.station,p.id].some(s=>String(s||'').toLowerCase().includes(q))));
 $('#property-scope').textContent=state.imported.length?`公开地图 10 条样本，另已导入 ${state.imported.length} 条房源；导入仅更新台账，坐标与来源以文件为准。`:'自如地图筛选快照，10 条列表样本；尚非全量房源清单。';
 $('#property-list').innerHTML=props.length?props.map(p=>`<article class="property-row"><div class="property-name"><strong>${esc(p.name)}${p.roomLabel?' · '+esc(p.roomLabel):''}</strong><span>${esc(p.district||'区域待确认')} · ${esc(p.product||'用户导入')}</span></div><div class="property-meta">${esc(p.area)}㎡ · ${esc(p.bedrooms)}居 · ${esc(p.floor)}/${esc(p.totalFloors)}层<p>${p.station?esc(p.station)+'站 · 步行约 '+esc(p.distance)+'m':'用户导入房源资料'}</p></div><div class="property-status"><span class="tag ${p.modelReady?'green':''}">${p.modelReady?'参考图齐备':'待补建模资料'}</span><p style="margin-top:5px">${p.coordinate?'已导入坐标':'精确坐标待补充'}</p></div><div class="property-actions"><button class="button ${p.modelReady?'primary':''}" data-property="${esc(p.id)}">${p.modelReady?'进入三维':'查看资料'}</button></div></article>`).join(''):`<div class="empty-state">${icon('search')}<h3>没有匹配的样本</h3><p>当前仅含实读样本和已导入台账，可调整筛选或导入更多房源。</p><button class="button" id="clear-property-search">清除筛选</button></div>`;
 $$('[data-property]').forEach(b=>b.onclick=()=>{const p=allProperties().find(p=>p.id===b.dataset.property);p.modelReady?showScene('apartment'):showProperty(p.id);});if($('#clear-property-search'))$('#clear-property-search').onclick=()=>{$('#property-search').value='';$('#district-select').value='';renderPropertiesList();};
}
function showProperty(id){const p=allProperties().find(p=>p.id===id);if(!p)return;showModal(p.name,`<div class="source-state"><span class="tag blue">${p.imported?'用户导入':'自如公开列表快照'}</span><span>${p.imported?'以导入记录为准':'2026.11.19 · 灵之智能筛选返回'}</span></div><table><tbody><tr><td>区域</td><td>${esc(p.district)}</td></tr><tr><td>${p.areaScope==='listed_bedroom'?'卧室面积':'房源面积'}</td><td>${esc(p.area)}㎡</td></tr><tr><td>户型与楼层</td><td>${esc(p.bedrooms)}居 · ${esc(p.floor)}/${esc(p.totalFloors)}层</td></tr><tr><td>产品标签</td><td>${esc(p.product)}</td></tr><tr><td>三维资料</td><td>尚无足够户型、照片或实测资料</td></tr><tr><td>精确坐标</td><td>${p.coordinate?esc(p.coordinate.join(', ')):'未取得，不使用随机坐标代替'}</td></tr></tbody></table><h3>补充后可继续重建</h3><p>需取得对应房源的户型图、主要房间照片与必要尺寸；楼栋重建还需建筑轮廓、楼层及立面资料。当前示范模型只对应望京路3号院，不套用到其他房源。</p>${p.sourceUrl?`<a class="button" href="${esc(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看房源来源</a>`:''}`);}
function renderAgents(){$('#agent-grid').innerHTML=agentRoles.map(a=>`<article class="agent-card"><div class="agent-symbol">${icon(a.icon)}</div><span class="eyebrow">${a.id}</span><h2>${a.name}</h2><p>${a.task}</p><dl><dt>主要交付成果</dt><dd>${a.result}</dd><dt>真人管理责任</dt><dd>${a.owner}</dd></dl><span class="tag blue">${a.state}</span></article>`).join('');}
function renderTickets(){
 const n=state.tickets.length;$('#nav-ticket-count').textContent=n;$('#nav-ticket-count').style.display=n?'block':'none';
 $('#ticket-list').innerHTML=n?state.tickets.map(t=>`<article class="ticket"><div class="ticket-top"><span class="tag ${t.status==='closed'?'green':'amber'}">${t.status==='closed'?'已完成演示复验':'派单草稿'}</span><h3>${esc(t.title)}</h3><span class="dim" style="font-size:.75rem">${esc(t.id)}</span></div><p>${esc(t.property)} · ${esc(t.assignee)} · ${esc(t.note)}</p><div class="ticket-details"><span>生成：${esc(t.createdAt)}</span><span>建议时限：${esc(t.deadline)}</span><span>${t.status==='closed'?'复验：模拟心跳恢复，结果仅限演示':'待业务负责人确认派单与处理方式'}</span></div><button class="button" data-ticket-event="${t.eventId}">${t.status==='closed'?'查看记录':'打开工作台'}</button></article>`).join(''):`<div class="empty-state">${icon('ticket')}<h3>从一次异常开始</h3><p>运行数字员工诊断后，可以在这里生成、跟进和复验演示工单。</p><button class="button primary" id="ticket-start">演示异常闭环</button></div>`;
 $$('[data-ticket-event]').forEach(b=>b.onclick=()=>openEvent(b.dataset.ticketEvent));if($('#ticket-start'))$('#ticket-start').onclick=()=>openEvent('EVT-DEMO-001');
}
function openEvent(id){state.activeEvent=id;$('#event-drawer').hidden=false;$('#drawer-backdrop').hidden=false;document.body.classList.add('drawer-open');renderDrawer();$('.close-drawer').focus();}
function closeDrawer(){$('#event-drawer').hidden=true;$('#drawer-backdrop').hidden=true;document.body.classList.remove('drawer-open');state.activeEvent=null;}
function diagnosticSteps(e){return e.id==='EVT-DEMO-001'?[['核对同户影响','演示日志：网关与 2 个设备同一时段失去心跳。'],['检查共同依赖','需核对网关供电、上联网络和平台上报链路。'],['形成原因候选','共同链路异常优先；现有证据不足以判定具体根因。'],['制定升级与复验','请求现场核查供电/网络；恢复后校验心跳与场景。']]:e.id==='EVT-DEMO-002'?[['核对上报证据','演示电量 18%，需核对采样时效与连续读数。'],['核查资产与使用状态','确认锁具在管、可正常开关及备用进入方式。'],['生成处理建议','安排合适时间人工更换电池，不发送开锁指令。'],['制定复验条件','更换后核对电量与真实锁具使用反馈。']]:e.id==='EVT-DEMO-003'?[['确认指令与回执','区分已发送、已执行与已确认状态。'],['核对通信依赖','检查网关、网络与设备回执链路。'],['形成排查建议','先补日志，再检查控制协议和设备状态。'],['制定复验条件','以真实执行回执和状态变化确认恢复。']]:[['核对未上报时段','演示未上报，不等同于传感器确认漏水。'],['核对设备在管状态','确认上报能力、采样周期及资产是否仍使用。'],['检查电池与网关','补充现场电池信息和网关通信日志。'],['制定复验条件','依据传感器真实心跳与测试事件验证恢复。']];}
function renderDrawer(){
 const e=state.events.find(e=>e.id===state.activeEvent);if(!e)return;const progress=state.diagnosticProgress[e.id]||0;const running=e.status==='diagnosing';const completed=['diagnosed','ticketed','resolved'].includes(e.status);const ticket=state.tickets.find(t=>t.eventId===e.id);const steps=diagnosticSteps(e);
 $('#drawer-title').textContent=e.status==='resolved'?'事件复验记录':'事件工作台';
 $('#drawer-body').innerHTML=`<div class="event-summary"><div class="event-summary-title"><span class="priority ${e.priority.toLowerCase()}">${e.priority}</span><strong>${esc(e.title)}</strong></div><p>${esc(e.property)} · 北京${esc(e.district)} · ${esc(e.id)}</p><span class="tag ${e.status==='resolved'?'green':'amber'}">${e.status==='resolved'?'已完成演示复验':'演示遥测 · 未连接生产设备'}</span></div><dl class="detail-grid"><div><dt>处理数字员工</dt><dd>${esc(e.agent)}</dd></div><div><dt>当前状态</dt><dd>${({new:'待核验',diagnosing:'诊断演示中',diagnosed:'建议待确认',ticketed:'已生成工单草稿',resolved:'演示已复验'})[e.status]||'待核验'}</dd></div><div><dt>关联对象</dt><dd>${esc(e.deviceName)}</dd></div><div><dt>真人管理责任</dt><dd>运维业务负责人</dd></div></dl><section class="drawer-section"><h3>当前证据</h3>${e.evidence.map(([k,v])=>`<div class="evidence-row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}<p class="small-note">${esc(e.summary)}</p></section><section class="drawer-section"><h3>数字员工诊断路径</h3><div class="diagnostic-steps">${steps.map(([title,body],i)=>`<div class="diag-step ${progress>i?'complete':running&&progress===i?'current':''}"><span class="diag-node">${progress>i?'✓':i+1}</span><div><strong>${title}</strong><p>${progress>i||completed?body:'等待核验演示'}</p></div></div>`).join('')}</div>${completed?`<div class="diagnostic-conclusion"><strong>处理建议 · 仍需核验</strong>${e.id==='EVT-DEMO-001'?'优先核查共同网关供电与上联链路；当前证据不足以直接认定网关损坏。不执行重置或配置变更。':'先补齐真实设备、现场与上报证据，再确认处理方式；建议文本不是执行回执。'}<br>升级条件：关键证据缺失、远程无法验证或存在现场风险时转人工。</div>`:''}</section>${e.status==='resolved'?'<div class="diagnostic-conclusion"><strong>演示复验已记录</strong>已模拟恢复心跳、核对关联设备并保存演示记录。未向真实设备发送任何指令，案例可继续交由专家形成技能草案。</div>':''}<div class="drawer-actions">${!completed?`<button class="button primary" id="diagnose-btn" ${running?'disabled':''}>${running?'正在演示诊断…':'启动数字员工诊断'}</button>`:!ticket?'<button class="button primary" id="create-ticket-btn">生成工单草稿</button>':e.status!=='resolved'?'<button class="button primary" id="verify-btn">模拟恢复并复验</button>':'<button class="button" id="view-ticket-btn">查看工单记录</button>'}${e.propertyId==='810151211'?'<button class="button" id="locate-model-btn">定位三维设备</button>':''}</div><p class="small-note">${ticket?'工单 '+esc(ticket.id)+' · 仅保存于当前浏览器。':'所有诊断步骤与回执均为交互演示；真实执行须接入设备系统并遵循业务授权。'}</p>`;
 if($('#diagnose-btn'))$('#diagnose-btn').onclick=()=>runDiagnosis(e.id);if($('#create-ticket-btn'))$('#create-ticket-btn').onclick=()=>createTicket(e.id);if($('#verify-btn'))$('#verify-btn').onclick=()=>verifyEvent(e.id);if($('#view-ticket-btn'))$('#view-ticket-btn').onclick=()=>{closeDrawer();showPage('tickets');};if($('#locate-model-btn'))$('#locate-model-btn').onclick=async()=>{closeDrawer();await showScene('apartment');viewer?.focusDevice(e.device);};
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
function showSources(){
 showModal('数据来源与重建范围',`<div class="source-block"><h3>① 北京灵之在租房源</h3><p>2026.11.19 从自如地图实读：更多→灵之智能→确定。原始聚合标签为 <strong>500+ 套</strong>，10 个区域；本 Demo 保存了 10 条列表样本，未取得全量明细和精确坐标。不能将其视为当前实时库存。</p><a href="${esc(data.source.url)}" target="_blank" rel="noopener noreferrer">打开自如地图（需重新勾选灵之智能）</a></div><div class="source-block"><h3>② 三维房源样板</h3><p>望京路3号院 · 50.83㎡ · 1室1厅 · 5/7层。使用 1 张户型图与 10 张室内照片进行程序化重建，保留主要轮廓、房间关系、门窗与材质识别点。</p><p>没有实测尺寸与完整三维扫描，部分高度、遮挡结构为合理推断；此模型不能作为施工或测绘依据。设备位置、型号和状态仅为业务演示。</p><a href="https://www.ziroom.com/x/810151211.html" target="_blank" rel="noopener noreferrer">查看对应房源详情</a></div><div class="source-block"><h3>③ 运维报表快照</h3><p>来自 source folder“灵之智能”内的型号在线率与单设备离线时长截图，采样日期未知。实际可见 7 个型号、8 台设备记录；仅逐项还原可读行，不把 TOP10 截图当全量设备数据。</p><p>原始设备和房源标识采用一致匿名代号。该快照含不同城市，不与北京在租房源建立未经核验的对应关系。</p></div><div class="source-block"><h3>④ 地图与模型方法</h3><p>北京行政区边界来自阿里云 DataV GeoAtlas，模型厚度为可视化表达；区域信标并非房屋经纬度，也未虚构真实楼栋。亦庄开发区保留自如地图的独立统计。</p><a href="https://geo.datav.aliyun.com/areas_v3/bound/110000_full.json" target="_blank" rel="noopener noreferrer">DataV 北京边界数据</a><p>参考 img2threejs 的分层观察、结构规格、材质区分和多角度对照方法。本 Demo 采用方法参考，未执行上游完整自动化高保真评测。</p><a href="https://github.com/img2threejs/img2threejs" target="_blank" rel="noopener noreferrer">img2threejs 项目</a></div><div class="source-block"><h3>⑤ 本 Demo 的交互数据</h3><p>4 条事件、设备遥测、数字员工诊断和工单回执为可交互演示，未连接生产设备或真实工单系统。操作只保存在当前浏览器，不发送控制、派单或对外消息。</p>${state.imported.length?`<p>当前另导入 ${state.imported.length} 条用户房源记录，单独保留导入来源；不会自动认定为实时或已建模。</p>`:''}</div>`);
}
function showReferences(){showModal('望京路3号院 · 参考图对照',`<div class="source-state"><span class="tag blue">实际房源参考</span><span>1 张户型图 · 10 张实景照片 · 观察日期 2026.11.19</span></div><div class="reference-grid"><figure><img src="./ops/assets/reference/floorplan.webp" alt="望京路3号院实际户型图"><figcaption>户型：南阳台—卧室—餐厅/玄关，西北卫生间，东北厨房与洗衣阳台。</figcaption></figure><figure><img src="./ops/assets/reference/bedroom.webp" alt="望京路3号院卧室实景"><figcaption>卧室实景：床、衣柜、灰色窗帘与材质差异。</figcaption></figure><figure><img src="./ops/assets/reference/room4.webp" alt="房源餐厅及室内参考"><figcaption>室内结构与家具关系参考。</figcaption></figure><figure><img src="./ops/assets/reference/room9.webp" alt="房源厨卫参考"><figcaption>厨卫及设施材质参考。</figcaption></figure></div><h3>可核验与推断的界线</h3><p>房间连接关系、主要家具、门窗位置与视觉材质以参考资料为依据；未给出实测尺寸的高度与遮挡结构保留推断标记。设备布点和遥测用于演示，不是现场设备台账。</p><div class="view-menu"><button class="button" id="reference-top">关闭对照并查看俯视</button><a class="button" href="https://www.ziroom.com/x/810151211.html" target="_blank" rel="noopener noreferrer">打开房源原页</a></div>`);$('#reference-top').onclick=()=>{$('#modal').close();viewer?.toggleTop();$('#top-view-btn').classList.toggle('active',viewer?.topView);};}
function showSkill(){showModal('技能草案：同一房源多设备离线',`<span class="tag amber">示范技能 · 尚未完成专家与留出案例验证</span><h3>适用条件</h3><p>同一房源多个设备在相近时间未上报，且存在共同网关、网络或供电依赖。</p><h3>判断顺序</h3><ol style="color:var(--muted);line-height:1.9"><li>核对房源、设备在管状态与采样时间，排除台账或采集问题。</li><li>识别同户设备与网关关系，按共同依赖聚合影响范围。</li><li>依次收集供电、网络、网关状态与平台日志证据。</li><li>形成可验证的原因候选；证据不足保留未知项并转人工。</li><li>处理后以设备心跳、执行回执和必要现场反馈复验。</li></ol><h3>反例与边界</h3><p>外网正常并不证明网关正常；没有上报记录也不等同于持续故障。不把重启或恢复出厂设置作为默认动作。</p><h3>发布前还需完成</h3><p>专家核对来源与适用版本，使用未参与提炼的新案例测试，并与现行流程比较准确性、耗时与转人工成本。</p><div class="source-block"><strong>草案版本 v0.1</strong><p>来源：本 Demo 的业务情景、用户提供运维讨论与公开蒸馏方法。不是已验证生产 SOP。</p></div>`);}
function downloadFile(name,text,type='text/plain;charset=utf-8'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function parseCsv(text){const rows=[];let row=[],cell='',quote=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quote&&text[i+1]==='"'){cell+='"';i++;}else quote=!quote;}else if(c===','&&!quote){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=c;}if(quote)throw Error('CSV 存在未闭合引号');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows;}
async function importCsv(file){
 if(!file)return;if(file.size>5*1024*1024){toast('请导入不超过 5MB 的 CSV 文件。');return;}
 try{const rows=parseCsv((await file.text()).replace(/^\uFEFF/,''));if(rows.length<2)throw Error('文件中没有房源数据');const headers=rows.shift().map(v=>v.trim());for(const k of ['id','name'])if(!headers.includes(k))throw Error('缺少必填列 '+k);const imported=[];for(const [index,values]of rows.entries()){const o=Object.fromEntries(headers.map((h,i)=>[h,values[i]?.trim()||'']));if(!o.id||!o.name)throw Error(`第 ${index+2} 行缺少 id 或 name`);if(data.properties.some(p=>p.id===o.id))throw Error(`第 ${index+2} 行 ID 与已验证公开样本重复，请使用独立 ID 保存导入记录`);const lon=o.longitude||o.lng,lat=o.latitude||o.lat;let coordinate=null;if(lon||lat){if(!lon||!lat||!Number.isFinite(+lon)||!Number.isFinite(+lat)||+lon<115||+lon>118||+lat<39||+lat>42)throw Error(`第 ${index+2} 行坐标不符合北京范围`);coordinate=[+lon,+lat];}const num=k=>o[k]&&Number.isFinite(+o[k])?+o[k]:null;imported.push({id:o.id,name:o.name,district:o.district||null,area:num('area'),bedrooms:num('bedrooms'),floor:num('floor'),totalFloors:num('totalFloors'),orientation:o.orientation||null,station:o.station||null,distance:num('distance'),product:o.product||'用户导入',modelReady:false,sourceUrl:null,coordinate,imported:true,importedAt:new Date().toISOString()});}if(imported.length>10000)throw Error('单次导入最多 10,000 条房源');const m=new Map(state.imported.map(p=>[p.id,p]));for(const p of imported)m.set(p.id,p);state.imported=[...m.values()];persist();renderProperties();$('#sample-count').textContent=allProperties().length;addActivity('房源资料 · 已导入',`${imported.length} 条台账已更新；未自动地图布点或三维建模。`,'database');toast(`成功导入 ${imported.length} 条房源，未自动生成未经验证的模型。`);}catch(e){toast('导入失败：'+e.message);}finally{$('#import-file').value='';}
}
function resetDemo(){showModal('重置演示记录',`<p>重置 4 条演示事件、诊断进度与本地演示工单。已导入的房源台账保留。</p><button class="button primary" id="confirm-reset">重置事件与工单</button>`);$('#confirm-reset').onclick=()=>{clearInterval(diagnosisTimer);diagnosisTimer=null;state.events=structuredClone(initialEvents);state.tickets=[];state.diagnosticProgress={};state.activities=[];persist();renderAll();$('#modal').close();renderSceneLegend();viewer?.setDeviceState('gateway','offline');if(state.activeDevice==='gateway'&&!$('#scene-detail').hidden)showDevice('gateway');toast('演示事件与工单已重置。');};}

$$('[data-page]').forEach(b=>b.onclick=()=>showPage(b.dataset.page));$$('[data-go]').forEach(b=>b.onclick=()=>showPage(b.dataset.go));
$$('[data-event-filter]').forEach(b=>b.onclick=()=>{state.eventFilter=b.dataset.eventFilter;$$('[data-event-filter]').forEach(v=>v.classList.toggle('selected',v===b));renderEvents();});
$$('[data-scene]').forEach(b=>b.onclick=()=>showScene(b.dataset.scene));
$('#show-apartment-btn').onclick=()=>showScene('apartment');$('#tour-btn').onclick=async()=>{await showScene('apartment');openEvent('EVT-DEMO-001');};
$('#reset-camera').onclick=()=>{viewer?.reset();$('#scene-detail').hidden=true;$('#top-view-btn').classList.remove('active');};$('#rotate-btn').onclick=()=>{$('#rotate-btn').classList.toggle('active');viewer?.setRotate($('#rotate-btn').classList.contains('active'));};$('#top-view-btn').onclick=()=>$('#top-view-btn').classList.toggle('active',viewer?.toggleTop());
$('#fullscreen-btn').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('.map-panel').requestFullscreen();}catch{toast('当前浏览器未开启全屏，可放大页面查看。');}};
$('#reference-btn').onclick=showReferences;$('#cutaway-btn').onclick=()=>{const cutaway=viewer?.toggleWalls();$('#cutaway-btn').innerHTML=icon('layers')+(cutaway?'显示完整墙体':'恢复剖切视图');};
$('#source-btn').onclick=showSources;$('#nav-data').onclick=showSources;$('#footer-source').onclick=showSources;$('#owner-btn').onclick=()=>showModal('管理责任',`<p>数字员工的业务负责人确认工作规则、输出质量和授权；技术负责人维护接口、版本和运行记录。本 Demo 使用岗位角色占位，未登记具体人员或任命关系。</p><p>当前演示能力：只读资料、诊断步骤、工单草稿、模拟复验。真实设备操作应由后端权限、审批与回执共同约束。</p>`);
$('.close-drawer').onclick=closeDrawer;$('#drawer-backdrop').onclick=closeDrawer;$('#modal-close').onclick=()=>$('#modal').close();$('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))$('#modal').close();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#event-drawer').hidden)closeDrawer();});
$('#property-search').addEventListener('input',renderPropertiesList);$('#district-select').addEventListener('change',renderPropertiesList);$('#import-btn').onclick=()=>$('#import-file').click();$('#import-file').onchange=e=>importCsv(e.target.files[0]);
$('#export-sample-btn').onclick=()=>downloadFile('灵之房源导入模板.csv','\uFEFFid,name,district,area,bedrooms,floor,totalFloors,longitude,latitude,product\nUSER-001,填写真实小区名,朝阳,50.83,1,5,7,,,用户房源台账\n','text/csv;charset=utf-8');
$('#skill-btn').onclick=showSkill;$('#reset-demo-btn').onclick=resetDemo;
// Recover an interrupted demo diagnosis as a pending event; do not pretend a timer kept running.
for(const e of state.events)if(e.status==='diagnosing'){e.status='new';state.diagnosticProgress[e.id]=0;}
init();
