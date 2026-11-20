// One pure state reducer for the 3D layer and the non-3D configuration view.
// These scenarios are illustrative. No configuration-derived device is telemetry.
export const TWIN_SCENARIOS = Object.freeze(['unknown','gateway-offline','local-fault','safety-alert']);
const STATE_LABELS = Object.freeze({unknown:'运行状态未接入',affected:'远程状态待核验',offline:'网关离线 · 演示',fault:'照明异常 · 演示',alarm:'安全告警 · 演示'});
const PRIORITY = {unknown:0,affected:1,offline:2,fault:2,alarm:3};

export function evaluateTwinState(input=[],options={}) {
  const scenario=TWIN_SCENARIOS.includes(options.scenario)?options.scenario:'unknown';
  const devices=input.map(d=>({...d,state:'unknown',stateLabel:STATE_LABELS.unknown,telemetryStatus:'unknown',stateSource:'not_connected'}));
  let target=null;
  if(scenario==='gateway-offline')target=devices.find(d=>d.formFactor==='gateway'||d.catalogId==='max1');
  if(scenario==='local-fault')target=devices.find(d=>d.formFactor==='ceiling-light'&&String(d.roomId).startsWith('bedroom'));
  if(scenario==='safety-alert')target=devices.find(d=>d.formFactor==='gas-sensor')||devices.find(d=>d.formFactor==='smoke-sensor');
  if(target){
    target.state=scenario==='gateway-offline'?'offline':scenario==='local-fault'?'fault':'alarm';
    target.stateSource='simulation';
    if(scenario==='gateway-offline')for(const d of devices){
      if(d!==target&&d.formFactor!=='door-lock'){d.state='affected';d.stateSource='simulation';}
    }
  }
  for(const d of devices)d.stateLabel=STATE_LABELS[d.state];
  const isDemo=scenario!=='unknown';
  const unavailable=isDemo&&!target;
  const states={
    unknown:{code:'unknown',label:'运行状态未接入',severity:'unknown',description:'按配置文档推演设备；实装数量、点位和运行状态均待现场台账或平台数据确认。'},
    'gateway-offline':{code:'gateway-offline',label:'网关离线 · 演示',severity:'critical',description:'模拟网关失联。橙色设备仅表示远程状态待核验，不代表设备本体故障或本地功能全部失效。'},
    'local-fault':{code:'local-fault',label:'局部照明异常 · 演示',severity:'warning',description:'模拟一个卧室灯具异常，仅突出该设备和对应空间；其余设备仍为未接入状态。'},
    'safety-alert':{code:'safety-alert',label:'安全告警 · 演示',severity:'critical',description:'模拟燃气或烟雾传感器告警，突出告警设备与对应房间。页面不会执行远程控制或真实派单。'}
  };
  const houseState=unavailable?{code:'scenario-unavailable',label:'当前配置不支持此演示',severity:'unknown',description:scenario==='safety-alert'?'该配置未包含燃气或烟雾传感器，请选择 Plus 配置后演示。':'当前出租空间的配置清单没有该场景所需设备。'}:states[scenario];
  const grouped=new Map();
  for(const d of devices){
    const id=d.roomId||'unassigned';
    if(!grouped.has(id))grouped.set(id,{roomId:id,roomName:d.roomName||'待确认空间',state:'unknown',label:STATE_LABELS.unknown,deviceIds:[]});
    const r=grouped.get(id);r.deviceIds.push(d.id);
    if(PRIORITY[d.state]>PRIORITY[r.state]){r.state=d.state==='offline'?'fault':d.state;r.label=d.stateLabel;}
  }
  const counts={total:devices.length,unknown:0,affected:0,fault:0,alarm:0};
  for(const d of devices){if(d.state==='offline'||d.state==='fault')counts.fault++;else counts[d.state]++;}
  return {scenario,isDemo,propertyId:options.propertyId||null,profile:options.profile||'base',houseState,counts,roomStates:[...grouped.values()],devices};
}

export function updateTwinDeviceState(summary,id,state) {
  if(!summary||!STATE_LABELS[state])return summary;
  // Explicit state updates are visual simulations too; they never populate live telemetry.
  const devices=summary.devices.map(d=>d.id===id?{...d,state,stateLabel:STATE_LABELS[state],stateSource:'simulation'}:d);
  const grouped=new Map();
  const counts={total:devices.length,unknown:0,affected:0,fault:0,alarm:0};
  for(const d of devices){
    if(d.state==='offline'||d.state==='fault')counts.fault++;else counts[d.state]++;
    if(!grouped.has(d.roomId))grouped.set(d.roomId,{roomId:d.roomId,roomName:d.roomName||'待确认空间',state:'unknown',label:STATE_LABELS.unknown,deviceIds:[]});
    const r=grouped.get(d.roomId);r.deviceIds.push(d.id);
    if(PRIORITY[d.state]>PRIORITY[r.state]){r.state=d.state==='offline'?'fault':d.state;r.label=d.stateLabel;}
  }
  const most=counts.alarm?'safety-alert':counts.fault?'local-fault':counts.affected?'gateway-offline':'unknown';
  const houseState={code:most,label:counts.alarm?'安全告警 · 演示':counts.fault?'设备异常 · 演示':counts.affected?'部分设备远程状态待核验':'运行状态未接入',severity:counts.alarm?'critical':counts.fault||counts.affected?'warning':'unknown',description:'当前色彩来自显式演示状态，真实遥测尚未接入。'};
  return {...summary,isDemo:devices.some(d=>d.state!=='unknown'),devices,counts,roomStates:[...grouped.values()],houseState};
}
