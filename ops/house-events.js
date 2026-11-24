export const occupancyLabels = {rental:'可立即入住（待租中）',occupied:'已入住'};

// Summaries are already scoped to one source row. Preserve each source quantity and unit.
const formFactors = new Map([
  ['网关离线','gateway'], ['网关离线超4h','gateway'], ['面屏离线','control-panel'],
  ['燃气泄漏报警','gas-sensor'], ['烟雾报警','smoke-sensor'], ['漏水报警','water-sensor'],
  ['智能锁撬锁预警','door-lock']
]);

export function houseEvents(record) {
  if(!record)return [];
  const result=[];
  for(const [field,category] of [['safety','安全事件'],['anomalies','设备异常']]){
    for(const part of (record[field] || '').split(/[；;]/)){
      const raw=part.trim();
      if(!raw)continue;
      const split=raw.indexOf('×');
      const name=split<0 ? raw : raw.slice(0,split).trim();
      result.push({key:field+'-'+result.length, category, name, measure:split<0?'':raw.slice(split+1).trim(), formFactor:formFactors.get(name)||null});
    }
  }
  return result;
}

export function homeDisplayName(row) {
  const location = [row.building, Number.isInteger(row.floor) ? row.floor+'层' : ''].filter(Boolean).join(' ');
  return [row.areaLabel || row.name, location].filter(Boolean).join(' · ');
}
