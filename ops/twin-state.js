// One pure state reducer for the 3D layer and the non-3D configuration view.
// These scenarios are illustrative. No configuration-derived device is telemetry.
const STATE_LABELS = Object.freeze({unknown:'运行状态未接入',affected:'远程状态待核验',offline:'离线点位示意',fault:'异常点位示意',alarm:'告警点位示意'});
const PRIORITY = {unknown:0,affected:1,offline:2,fault:2,alarm:3};

export function evaluateTwinState(input=[],options={}) {
  const event=options.event;
  const scenario=event?.key || 'unknown';
  const devices=input.map(d=>({...d,state:'unknown',stateLabel:STATE_LABELS.unknown,telemetryStatus:'unknown',stateSource:'not_connected'}));
  const candidates=event?.formFactor ? devices.filter(d=>d.formFactor===event.formFactor) : [];
  const target=candidates.length===1 ? candidates[0] : null;
  if(target){
    target.state=event.category==='安全事件'?'alarm':'offline';
    target.stateLabel=STATE_LABELS[target.state];
    target.stateSource='simulation';
  }
  const isDemo=Boolean(event);
  const houseState=event ? {
    code:scenario,label:event.name,severity:event.category==='安全事件'?'critical':'warning',
    description:[event.category,event.measure,target?'高亮同类型规划点位，具体发生位置待核验。':'本期记录未能唯一关联配置点位，按房源展示。'].filter(Boolean).join(' · ')
  } : {code:'unknown',label:'配置状态',severity:'unknown',description:'展示本套规划配置，设备实时状态待接入。'};
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
