import { buildDeviceConfiguration, CONFIG_CATALOG, CONFIG_SOURCE } from './device-configuration.js';
import { evaluateTwinState } from './twin-state.js';

const esc=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const REFERENCE_ID='810151211';
const stateName={unknown:'状态未接入',affected:'链路受影响',offline:'演示离线',fault:'演示异常',alarm:'演示告警'};
const roomOrder=['entry','living','bedroom','bedroom-2','bedroom-3','kitchen','bathroom','south-balcony'];
const profiles={base:'基础智能',plus:'基础 + Plus',upgrade:'升级选配'};
const scenarios=[['unknown','配置状态'],['gateway-offline','网关离线'],['local-fault','单灯异常'],['safety-alert','安全告警']];
const deviceFilters=[['all','全部'],['abnormal','异常'],['affected','链路受影响']];
const attentionRank={alarm:3,offline:2,fault:2,affected:1,unknown:0};
const isAbnormal=device=>['alarm','offline','fault'].includes(device.state);
const attentionFirst=devices=>[...devices].sort((a,b)=>(attentionRank[b.state]||0)-(attentionRank[a.state]||0));
const catalogArray=()=>Array.isArray(CONFIG_CATALOG)?CONFIG_CATALOG:Object.values(CONFIG_CATALOG||{});
const itemFor=device=>catalogArray().find(item=>item.id===device.catalogId||item.catalogId===device.catalogId)||{};
const icon=(type='device')=>`<svg viewBox="0 0 32 32" aria-hidden="true">${/light|lamp|spot/.test(type)?'<circle cx="16" cy="12" r="7"/><path d="M12 19v5h8v-5M13 27h6M3 12h3m20 0h3M7 3l2 3m16-3-2 3"/>':/lock/.test(type)?'<rect x="9" y="11" width="14" height="18" rx="3"/><path d="M12 11V7a4 4 0 0 1 8 0v4M16 19v4"/>':/curtain|track/.test(type)?'<path d="M4 5h24M6 7v21l10-5 10 5V7M11 7v17m10-17v17M16 7v16"/>':/sensor|alarm/.test(type)?'<circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="4"/><path d="M16 7v2m0 14v2M7 16h2m14 0h2"/>':'<rect x="6" y="4" width="20" height="24" rx="3"/><path d="M10 9h12v9H10zM12 23h8"/>'}</svg>`;

/** Configuration is a proposal based on the supplied plan, never a live device inventory. */
export class TwinWorkspace {
  constructor({controls,panel,empty,detail,properties,geography,coverage,onProperty,onChange,onFocus,onCatalog,onSource,onPlan,onExport}){
    Object.assign(this,{controls,panel,empty,detail,properties,geography,coverage,onProperty,onChange,onFocus,onCatalog,onSource,onPlan,onExport});
    this.propertyId=REFERENCE_ID;this.profile='base';this.scenario='unknown';this.singleTracks=false;this.visible=false;this.showLabels=true;this.selectedId=null;this.deviceFilter='all';this.roomFilter='';this.focusMessage='';
    this.rebuild();
  }
  get property(){return this.properties.find(p=>p.id===this.propertyId)||this.properties[0];}
  get referenceReady(){return this.property?.id===REFERENCE_ID&&this.property?.modelReady===true;}
  updateProperties(properties){this.properties=properties;this.rebuild();}
  open(id){if(this.properties.some(p=>p.id===String(id))){this.propertyId=String(id);this.scenario='unknown';this.resetDeviceView();this.rebuild();}}
  setVisible(value){this.visible=!!value;this.controls.hidden=!this.visible;this.panel.hidden=!this.visible;this.empty.hidden=!this.visible||this.referenceReady;}
  configurationOptions(){
    const property=this.property,shared=property?.areaScope==='listed_bedroom'||!!property?.roomLabel;
    const rooms=shared?['bedroom']:['living',...Array.from({length:Math.max(0,Math.min(8,Number(property?.bedrooms)||0))},(_,i)=>i?'bedroom-'+(i+1):'bedroom')];
    return {profile:this.profile,entryPresent:false,corridorPresent:false,balconyLength:null,curtainTracks:this.singleTracks&&this.profile!=='base'?Object.fromEntries(rooms.map(room=>[room,1])):null};
  }
  rebuild(){
    if(!this.property)return;
    this.configuration=buildDeviceConfiguration(this.property,this.configurationOptions());
    this.result=evaluateTwinState(this.configuration.devices,{scenario:this.scenario,propertyId:this.propertyId,profile:this.profile});
    if(this.selectedId&&!this.configuration.devices.some(d=>d.id===this.selectedId)){this.selectedId=null;this.detail.hidden=true;}
    this.renderControls();this.renderPanel();this.renderEmpty();this.setVisible(this.visible);
  }
  change(){this.rebuild();this.onChange?.({property:this.property,configuration:this.configuration,scenario:this.scenario,showLabels:this.showLabels});}
  setResult(result){if(!result)return;this.result=result;this.renderPanel();if(this.selectedId)this.selectDevice(this.selectedId,false);}
  setScenario(scenario){if(!scenarios.some(s=>s[0]===scenario))return;this.scenario=scenario;this.resetDeviceView();this.change();}
  findLegacyDevice(id){
    if(this.configuration.devices.some(d=>d.id===id))return id;
    const terms={gateway:/gateway/, 'living-light':/ceiling.*45|45.*ceiling|light.*45/, 'door-lock':/lock/, 'smoke-sensor':/smoke/, 'curtain-sensor':/curtain.*motor/};
    return this.configuration.devices.find(d=>terms[id]?.test([d.catalogId,d.formFactor].join(' ')))?.id||null;
  }
  renderControls(){
    const p=this.property,config=this.configuration;
    this.controls.innerHTML=`<div class="twin-controls-head"><div><p class="eyebrow">HOME DIGITAL TWIN</p><h3>从房间到设备，看清影响范围。</h3></div><button class="button" data-twin-catalog>配置依据</button></div><div class="twin-choices"><label><span>已采集房源</span><select aria-label="切换三维运维房源" id="twin-property-select">${this.properties.map(row=>`<option value="${esc(row.id)}" ${row.id===this.propertyId?'selected':''}>${esc(row.name)}${row.roomLabel?' · '+esc(row.roomLabel):' · '+esc(row.bedrooms)+'居'}${row.id===REFERENCE_ID?' · 有户型参考':''}</option>`).join('')}</select></label><label><span>心舍 3.0.1 配置推演</span><select aria-label="智能设备配置方案" id="twin-profile-select">${Object.entries(profiles).map(([key,label])=>`<option value="${key}" ${this.profile===key?'selected':''}>${label}</option>`).join('')}</select></label><label class="twin-track-choice"><input type="checkbox" id="twin-track-preview" ${this.singleTracks?'checked':''} ${this.profile==='base'?'disabled':''}><span>预览每屋单轨窗帘<small>用户规划 · 窗长待确认</small></span></label></div><div class="twin-scenarios"><span>异常可视化演示</span><div role="group" aria-label="三维异常演示情景">${scenarios.map(([key,label])=>`<button type="button" data-twin-scenario="${key}" aria-pressed="${key===this.scenario}" class="${key===this.scenario?'selected':''}">${label}</button>`).join('')}</div><label class="twin-label-toggle"><input type="checkbox" id="twin-label-toggle" ${this.showLabels?'checked':''}>设备标记</label></div><p class="twin-version-note"><span class="tag">配置推演</span>当前房源标签：${esc(p.product||'产品版本待核验')}。${esc(config.applicability?.reason||'方案型号与数量需逐套核对实装清单。')}<span>资料依据：配置文档第 6–9 页。</span></p>`;
    this.controls.querySelector('#twin-property-select').onchange=e=>this.onProperty?.(e.target.value);
    this.controls.querySelector('#twin-profile-select').onchange=e=>{this.profile=e.target.value;this.resetDeviceView();this.change();};
    this.controls.querySelector('#twin-track-preview').onchange=e=>{this.singleTracks=e.target.checked;this.resetDeviceView();this.change();};
    this.controls.querySelector('#twin-label-toggle').onchange=e=>{this.showLabels=e.target.checked;this.onChange?.({property:p,configuration:this.configuration,scenario:this.scenario,showLabels:this.showLabels});};
    this.controls.querySelectorAll('[data-twin-scenario]').forEach(button=>button.onclick=()=>this.setScenario(button.dataset.twinScenario));
    this.controls.querySelector('[data-twin-catalog]').onclick=()=>this.onCatalog?.();
  }
  resetDeviceView(){this.deviceFilter='all';this.roomFilter='';this.selectedId=null;this.focusMessage='';this.detail.hidden=true;}
  matchesDevice(device){
    return (!this.roomFilter||device.roomId===this.roomFilter)&&
      (this.deviceFilter==='all'||this.deviceFilter==='abnormal'&&isAbnormal(device)||this.deviceFilter==='affected'&&device.state==='affected');
  }
  setDeviceFilter(filter){
    if(!deviceFilters.some(([key])=>key===filter))return;
    this.deviceFilter=filter;this.focusMessage='';this.renderPanel();
    this.panel.querySelector(`[data-twin-filter="${filter}"]`)?.focus({preventScroll:true});
  }
  setRoomFilter(roomId){
    const devices=this.result?.devices||[];
    this.roomFilter=devices.some(device=>device.roomId===roomId)?roomId:'';this.focusMessage='';this.renderPanel();
    this.panel.querySelector('#twin-room-filter')?.focus({preventScroll:true});
  }
  selectRoom(roomId){
    const devices=attentionFirst((this.result?.devices||[]).filter(device=>device.roomId===roomId));
    if(!devices.length)return;
    this.roomFilter=roomId;this.deviceFilter='all';this.focusMessage='';this.renderPanel();this.selectDevice(devices[0].id);
    [...this.panel.querySelectorAll('[data-twin-room]')].find(button=>button.dataset.twinRoom===roomId)?.focus({preventScroll:true});
  }
  focusNextAnomaly(){
    const candidates=attentionFirst((this.result?.devices||[]).filter(device=>(!this.roomFilter||device.roomId===this.roomFilter)&&isAbnormal(device)));
    if(!candidates.length)return;
    const index=(candidates.findIndex(device=>device.id===this.selectedId)+1)%candidates.length,device=candidates[index];
    this.deviceFilter='abnormal';this.renderPanel();
    this.selectDevice(device.id,true,`演示异常 ${index+1} / ${candidates.length} · ${device.roomName} · ${device.name}`);
    this.panel.querySelector('[data-twin-next-anomaly]')?.focus({preventScroll:true});
  }
  renderPanel(){
    const result=this.result||{},house=result.houseState||{},devices=result.devices||this.configuration.devices,counts=result.counts||{},isDemo=!!result.isDemo;
    const rooms=[...(result.roomStates||[])].sort((a,b)=>(roomOrder.indexOf(a.roomId)+1||99)-(roomOrder.indexOf(b.roomId)+1||99));
    if(this.roomFilter&&!rooms.some(room=>room.roomId===this.roomFilter))this.roomFilter='';
    const visible=devices.filter(device=>this.matchesDevice(device)),roomDevices=devices.filter(device=>!this.roomFilter||device.roomId===this.roomFilter);
    if(this.selectedId&&!visible.some(device=>device.id===this.selectedId)){this.selectedId=null;this.detail.hidden=true;this.focusMessage='';}
    const anomalies=roomDevices.filter(isAbnormal),affected=roomDevices.filter(device=>device.state==='affected');
    const abnormal=isDemo?(counts.fault||0)+(counts.alarm||0):'—',dependency=isDemo?counts.affected||0:'—';
    const filterCounts={all:roomDevices.length,abnormal:isDemo?anomalies.length:'—',affected:isDemo?affected.length:'—'};
    const emptyText=!isDemo?'运行数据尚未接入，暂无可确认的异常或受影响设备。':this.deviceFilter==='affected'?'当前房间范围内没有链路受影响的演示设备。':'当前房间范围内没有符合筛选的演示异常设备。';
    const focusStatus=this.focusMessage||(isDemo?'异常与链路影响来自当前演示；点击设备可查看型号。':'运行数据未接入；未知状态不会计为异常。');
    this.panel.innerHTML=`<div class="twin-health ${esc(house.severity||'unknown')}" aria-live="polite"><div class="twin-health-top"><span>${this.property.areaScope==='listed_bedroom'?'出租卧室智能状态':'整屋智能状态'}</span><span class="tag ${isDemo?'amber':''}">${isDemo?'演示情景':'未接实时设备'}</span></div><h3>${esc(house.label||'运行状态待接入')}</h3><p>${esc(house.description||'已按方案生成配置，尚无该房源真实运行数据。')}</p><div class="twin-health-numbers"><div><strong>${devices.length}</strong><span>配置点位</span></div><div><strong>${abnormal}</strong><span>${isDemo?'演示异常':'已知异常'}</span></div><div><strong>${dependency}</strong><span>链路受影响</span></div></div><small>${isDemo?'色彩表达当前演示情景，不作为房屋真实状态。':'实装与运行数据待接入，暂不能判断整屋是否正常。'}</small></div>
      <div class="twin-panel-scroll"><section class="twin-room-section"><h4>房间影响</h4><div class="twin-room-states">${rooms.map(room=>`<button type="button" class="twin-room-state ${esc(room.state)}${this.roomFilter===room.roomId?' selected':''}" data-twin-room="${esc(room.roomId)}" aria-pressed="${this.roomFilter===room.roomId}" aria-label="查看${esc(room.roomName)}设备，优先定位需关注设备"><span>${esc(room.roomName)}</span><b>${esc(room.label||stateName[room.state]||'状态未接入')}</b><small>${room.deviceIds?.length||0} 个配置点位</small></button>`).join('')}</div></section>
      <section class="twin-device-section"><div class="twin-section-heading"><h4>设备与型号</h4><span>${devices.length} 个规划点位</span></div>
      <div class="twin-device-filters"><div class="twin-state-filters" role="group" aria-label="按设备状态筛选">${deviceFilters.map(([key,label])=>`<button type="button" data-twin-filter="${key}" aria-pressed="${this.deviceFilter===key}" class="${this.deviceFilter===key?'selected':''}">${label}<span>${filterCounts[key]}</span></button>`).join('')}</div>
      <div class="twin-device-filter-row"><label for="twin-room-filter"><span>房间范围</span><select id="twin-room-filter"><option value="">全部房间</option>${rooms.map(room=>`<option value="${esc(room.roomId)}"${this.roomFilter===room.roomId?' selected':''}>${esc(room.roomName)}</option>`).join('')}</select></label><button type="button" class="twin-locate-anomaly" data-twin-next-anomaly ${anomalies.length?'':'disabled'} aria-label="${this.referenceReady?'循环定位':'循环查看'}当前房间范围内的演示异常设备">${this.referenceReady?'定位异常':'查看异常'}${anomalies.length?` <span>${anomalies.length}</span>`:''}</button></div>
      <p class="twin-filter-summary" aria-live="polite">显示 ${visible.length} / ${devices.length} 个规划点位${this.roomFilter?' · '+esc(rooms.find(room=>room.roomId===this.roomFilter)?.roomName):''}</p><p class="twin-focus-status" role="status" aria-live="polite">${esc(focusStatus)}</p></div>
      <div class="twin-device-list">${visible.length?visible.map(device=>`<button type="button" class="twin-device-row ${esc(device.state||'unknown')} ${this.selectedId===device.id?'selected':''}" data-twin-device="${esc(device.id)}" aria-pressed="${this.selectedId===device.id}"><span class="twin-device-symbol">${icon(device.formFactor||device.catalogId)}</span><span class="twin-device-copy"><strong>${esc(device.name)}</strong><small>${esc(device.roomName)} · ${esc(device.model||'型号待核验')}</small></span><span class="twin-device-state">${esc(device.stateLabel||stateName[device.state]||'状态未接入')}</span></button>`).join(''):`<div class="twin-filter-empty"><p>${emptyText}</p><button type="button" class="button" data-twin-reset-filters>查看全部配置</button></div>`}</div></section>
      <details class="twin-rule-details"><summary>按需配置与待确认项 <span>${this.configuration.conditionalRules?.length||0}</span></summary>${(this.configuration.conditionalRules||[]).map(rule=>`<div><strong>${esc(rule.label)}</strong><p>${esc(rule.reason)}</p></div>`).join('')}<p>配置数量根据文档和已知居室推演，尚未核对安装清单、网关绑定或设备序列号。</p></details></div><div class="twin-panel-footer"><button class="button" data-twin-export>下载本套配置</button><button class="button" data-twin-source>房源资料</button></div>`;
    this.panel.querySelectorAll('[data-twin-device]').forEach(button=>button.onclick=()=>this.selectDevice(button.dataset.twinDevice));
    this.panel.querySelectorAll('[data-twin-room]').forEach(button=>button.onclick=()=>this.selectRoom(button.dataset.twinRoom));
    this.panel.querySelectorAll('[data-twin-filter]').forEach(button=>button.onclick=()=>this.setDeviceFilter(button.dataset.twinFilter));
    this.panel.querySelector('#twin-room-filter').onchange=event=>this.setRoomFilter(event.target.value);
    this.panel.querySelector('[data-twin-next-anomaly]').onclick=()=>this.focusNextAnomaly();
    const reset=this.panel.querySelector('[data-twin-reset-filters]');
    if(reset)reset.onclick=()=>{this.resetDeviceView();this.renderPanel();this.panel.querySelector('[data-twin-filter="all"]')?.focus({preventScroll:true});};
    this.panel.querySelector('[data-twin-export]').onclick=()=>this.onExport?.(this.exportData());
    this.panel.querySelector('[data-twin-source]').onclick=()=>this.onSource?.(this.propertyId);
  }
  renderEmpty(){
    const p=this.property,ref=this.coverage?.properties?.find(row=>row.id===p.id);
    this.empty.innerHTML=`<div class="twin-empty-icon">${icon('panel')}</div><span class="eyebrow">${esc(p.name)}</span><h3>${p.publicFloorplanUrl?'这套房源已有官网户型图':'等待这套房源的真实户型'}</h3><p>${p.publicFloorplanUrl?'可从本套来源资料查看户型和室内照片。设备点位仍需与现场安装清单核对。':'已为本套整理设备配置。取得对应 VR 或户型图后，才能将设备放进实际空间。'}</p><div class="twin-reference-checks"><div><span>公开房源记录</span><strong>已收录</strong></div><div><span>对应户型图</span><strong>${ref?.floorplanCount||0} 张</strong></div><div><span>室内参考照片</span><strong>${Math.max(ref?.interiorPhotoCount||0,p.publicPhotoUrls?.length||0)} 张</strong></div><div><span>VR / 实测尺寸</span><strong>${p.publicVrUrl?'有官网 VR / 尺寸待补':'待补充'}</strong></div></div><p class="twin-empty-foot">${p.areaScope==='listed_bedroom'?'合租单间 · 所属户型 '+esc(p.bedrooms)+'居':esc(p.bedrooms)+' 居'} · ${p.areaScope==='listed_bedroom'?'出租卧室 ':''}${esc(p.area)}㎡ · 设备实装待核验</p><button class="button" data-missing-source>查看本套来源资料</button>${p.publicFloorplanUrl?'<button class="button primary" data-open-plan>打开本套户型与设备</button>':''}`;
    const openPlan=this.empty.querySelector('[data-open-plan]');if(openPlan)openPlan.onclick=()=>this.onPlan?.(p.id,this.profile);
    this.empty.querySelector('[data-missing-source]').onclick=()=>this.onSource?.(p.id);
  }
  selectDevice(id,focus=true,announcement=''){
    const device=(this.result.devices||[]).find(d=>d.id===id);if(!device)return;
    if(!this.matchesDevice(device)){this.deviceFilter='all';this.roomFilter='';this.renderPanel();}
    this.selectedId=id;if(focus)this.onFocus?.(id);
    this.panel.querySelectorAll('[data-twin-device]').forEach(row=>{const selected=row.dataset.twinDevice===id;row.classList.toggle('selected',selected);row.setAttribute('aria-pressed',String(selected));});
    this.focusMessage=announcement||`${this.referenceReady?'已定位':'已选择'} ${device.roomName} · ${device.name} · ${device.stateLabel||stateName[device.state]||'状态未接入'}`;
    const status=this.panel.querySelector('.twin-focus-status');if(status)status.textContent=this.focusMessage;
    const item=itemFor(device),pages=device.configurationSource?.pages||item.sourcePages||[6,7];
    this.detail.innerHTML=`<button class="icon-btn close-scene-detail" aria-label="关闭设备详情">×</button><span class="twin-detail-room">${esc(device.roomName)}</span><h3>${esc(device.name)}</h3><span class="tag ${['alarm','fault','offline'].includes(device.state)?'amber':''}">${esc(device.stateLabel||stateName[device.state]||'状态未接入')}</span><dl><div><dt>型号 / 规格</dt><dd>${esc(device.model||'具体型号待核验')}</dd></div><div><dt>安装状态</dt><dd>按方案规划，实装未核验</dd></div><div><dt>规则出处</dt><dd>配置文档第 ${pages.join('、')} 页</dd></div></dl><button class="button" data-device-rule>查看型号与配置规则</button>`;
    this.detail.hidden=false;
    this.detail.querySelector('.close-scene-detail').onclick=()=>{this.detail.hidden=true;this.selectedId=null;this.focusMessage='';this.renderPanel();this.panel.querySelector('[data-twin-filter="'+this.deviceFilter+'"]')?.focus({preventScroll:true});};
    this.detail.querySelector('[data-device-rule]').onclick=()=>this.onCatalog?.(device);
  }
  exportData(){
    return {schemaVersion:1,property:{id:this.property.id,name:this.property.name,bedrooms:this.property.bedrooms,areaScope:this.property.areaScope||null,roomLabel:this.property.roomLabel||null,product:this.property.product,sourceUrl:this.property.sourceUrl},referenceStatus:this.referenceReady?'official_reference_approximation':this.property.publicFloorplanUrl?'official_floorplan_available':'missing_corresponding_floorplan',configuration:this.configuration,scenario:this.scenario,telemetryConnected:false,deviceStates:(this.result.devices||[]).map(({mesh,position,...device})=>device),source:CONFIG_SOURCE};
  }
}

export function configurationCatalogHtml(selectedDevice){
  const entries=selectedDevice?[itemFor(selectedDevice)]:catalogArray();
  return `<div class="configuration-catalog-intro"><span class="tag blue">心舍 3.0.1 · 文档规则</span><h3>${selectedDevice?esc(selectedDevice.name):'设备型号先确认，再匹配到房间。'}</h3><p>基础智能、Plus、其他选配分开管理。当前房源产品标签多为心舍 2.0 或其他产品，以下用于配置推演，实装需逐套核验。</p></div><div class="configuration-catalog">${entries.map(item=>{const image=item.image||item.imagePath||item.thumbnail;return `<article>${image?`<img src="${esc(image.startsWith('./')?image:'./ops/assets/'+image)}" alt="${esc(item.name||item.label)} 文档产品示意" loading="lazy">`:`<span class="catalog-icon">${icon(item.formFactor||item.id)}</span>`}<div><span>${esc(item.category||'智能设备')}</span><h4>${esc(item.name||item.label||item.id)}</h4><dl><div><dt>型号 / 规格</dt><dd>${esc(item.model||item.specification||item.spec||'未提供完整 SKU')}</dd></div><div><dt>选配关系</dt><dd>${esc(({base:'基础智能',plus:'Plus套组',upgrade:'升级选配',conditional:'按需确认',optional:'其他选配',appliance:'家电套组'})[item.defaultProfile]||'按配置规则')}</dd></div></dl><p>${esc(item.quantityRule||item.rule||(Array.isArray(item.notes)?item.notes.join('；'):item.notes)||item.description||'数量和安装位置依据方案规则及房况确认。')}</p></div></article>`;}).join('')}</div><div class="source-block"><h3>本次匹配规则</h3><ul><li>基础：智能门锁 1、Max1 网关 1、Z-touch 1S 1；卧室 24W 吸顶灯每卧室 1，客厅 45W 吸顶灯 1。</li><li>Plus：烟雾与燃气传感器各 1、每卧室增加 1 个面屏；窗帘电机每轨 1，轨道按窗长选择。</li><li>开关数量依灯路确认；玄关、过道、阳台射灯依实际空间与长度确认。</li><li>新版取消水浸标配；插座为床头选配，玄关不额外增加第二个语音面屏。</li><li>Max1 与现有报表的 MaxIII 属于不同型号，不相互套用状态；文档未给出的 SKU 保留未知。</li></ul><p>来源：用户提供的配置文档，第 4、6、7、8、9 页。文档中的产品外形用于识别，未提供精确外形尺寸。</p></div>`;
}
