// Authored scenario data, never telemetry from the photographed property.
// All three windows aggregate the same immutable daily archive.
export const HOUSEHOLD_SAMPLE_ID = '810151211';
export const HOUSEHOLD_FIXTURE_ID = 'HH-DEMO-20261119-v1';
export const HOUSEHOLD_PERIODS = Object.freeze({
  day: { label: '日', days: 1 }, week: { label: '周', days: 7 }, month: { label: '月', days: 30 }
});
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const list = value => Array.isArray(value) ? value : [];
const sum = values => values.reduce((total, value) => total + value, 0);
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
export const HOUSEHOLD_DIMENSIONS = freeze([
  { id: 'connection', label: '连接', subtitle: '设备有没有持续回应', deviceIds: ['gateway', 'living-light', 'bedroom-ac', 'door-lock', 'smoke-sensor', 'water-sensor', 'curtain-sensor'] },
  { id: 'execution', label: '执行', subtitle: '操作是否得到确认', deviceIds: ['living-light', 'bedroom-ac', 'door-lock', 'curtain-sensor'] },
  { id: 'linkage', label: '联动', subtitle: '场景有没有完整走完', deviceIds: ['gateway', 'living-light', 'bedroom-ac', 'door-lock', 'curtain-sensor'] },
  { id: 'security', label: '安防', subtitle: '自检与告警证据是否齐全', deviceIds: ['door-lock', 'smoke-sensor', 'water-sensor'] },
  { id: 'consumables', label: '耗材', subtitle: '电量读数与更换依据', deviceIds: ['door-lock', 'smoke-sensor', 'water-sensor'] },
  { id: 'usage', label: '使用', subtitle: '功能是否有操作记录', deviceIds: ['living-light', 'bedroom-ac', 'door-lock', 'curtain-sensor'] }
]);
export const HOUSEHOLD_DEVICES = freeze([
  { id: 'gateway', name: '演示网关', room: '餐厅 / 玄关', current: 'unknown', battery: null },
  { id: 'living-light', name: '餐厅照明（演示）', room: '餐厅 / 玄关', current: 'unknown', battery: null },
  { id: 'bedroom-ac', name: '卧室空调（演示）', room: '卧室', current: 'unknown', battery: null },
  { id: 'door-lock', name: '入户门锁（演示）', room: '餐厅 / 玄关', current: 'online', battery: 68 },
  { id: 'smoke-sensor', name: '烟感（演示）', room: '厨房', current: 'online', battery: 82 },
  { id: 'water-sensor', name: '漏水传感器（演示）', room: '北侧洗衣阳台', current: 'online', battery: null },
  { id: 'curtain-sensor', name: '窗帘驱动（演示）', room: '卧室', current: 'online', battery: null }
]);
const CONTROL_IDS = ['living-light', 'bedroom-ac', 'door-lock', 'curtain-sensor'];
const BATTERY_IDS = ['door-lock', 'smoke-sensor', 'water-sensor'];
const SECURITY_IDS = ['smoke-sensor', 'water-sensor'];
const RULES = [
  { id: 'arrival-light', name: '回家照明（演示规则）' },
  { id: 'evening-curtain', name: '晚间窗帘（演示规则）' },
  { id: 'away-ac', name: '离家空调（演示规则）' }
];

// Connection triples: online / confirmed-offline / unknown hourly slots.
// Command triples: confirmed / timeout / unknown. Rule triples: confirmed /
// recorded-failure / unknown. Every profile accounts for every denominator.
const PROFILES = freeze({
  steady: { connection: {}, commands: [[8, 0, 0], [2, 0, 0], [6, 0, 0], [2, 0, 0]], rules: [[3, 0, 0], [2, 0, 0], [3, 0, 0]], selfChecks: [true, true], batteries: [68, 82, 61] },
  busy: { connection: { gateway: [23, 0, 1], 'bedroom-ac': [23, 0, 1] }, commands: [[13, 1, 0], [4, 0, 1], [8, 0, 0], [5, 0, 0]], rules: [[6, 0, 0], [4, 0, 0], [3, 0, 1]], selfChecks: [true, true], batteries: [68, 82, null] },
  minor: { connection: { gateway: [23, 1, 0], 'living-light': [23, 0, 1], 'bedroom-ac': [21, 2, 1] }, commands: [[10, 0, 1], [2, 1, 0], [7, 0, 0], [3, 0, 0]], rules: [[4, 0, 0], [2, 0, 1], [3, 1, 0]], selfChecks: [true, null], batteries: [68, 82, 61] },
  gateway_gap: { connection: { gateway: [20, 1, 3], 'living-light': [21, 0, 3], 'bedroom-ac': [21, 0, 3] }, commands: [[8, 1, 1], [1, 1, 1], [7, 0, 0], [2, 0, 0]], rules: [[3, 0, 1], [2, 0, 0], [1, 1, 1]], selfChecks: [true, null], batteries: [68, 82, null] }
});
const SCHEDULE = [
  'steady', 'steady', 'busy', 'steady', 'minor', 'steady', 'busy',
  'steady', 'steady', 'minor', 'steady', 'busy', 'steady', 'steady',
  'busy', 'minor', 'steady', 'steady', 'busy', 'steady', 'minor',
  'steady', 'steady', 'busy', 'minor', 'steady', 'busy', 'steady',
  'steady', 'gateway_gap'
];
export const HOUSEHOLD_DAILY_ARCHIVE = freeze(SCHEDULE.map((profileId, index) => {
  const date = new Date(Date.UTC(2026, 9, 21 + index)).toISOString().slice(0, 10);
  const profile = PROFILES[profileId];
  return {
    id: `${HOUSEHOLD_FIXTURE_ID}/${date}`, date, profileId,
    connection: Object.fromEntries(HOUSEHOLD_DEVICES.map(device => {
      const [online, offline, unknown] = profile.connection[device.id] || [24, 0, 0];
      if (online + offline + unknown !== 24) throw new Error('Invalid household fixture hourly denominator');
      return [device.id, { online, offline, unknown, expected: 24 }];
    })),
    commands: Object.fromEntries(CONTROL_IDS.map((id, i) => {
      const [confirmed, timeout, unknown] = profile.commands[i];
      return [id, { confirmed, timeout, unknown, requested: confirmed + timeout + unknown }];
    })),
    rules: Object.fromEntries(RULES.map((rule, i) => {
      const [confirmed, failed, unknown] = profile.rules[i];
      return [rule.id, { confirmed, failed, unknown, triggered: confirmed + failed + unknown }];
    })),
    selfChecks: Object.fromEntries(SECURITY_IDS.map((id, i) => [id, profile.selfChecks[i]])),
    batteries: Object.fromEntries(BATTERY_IDS.map((id, i) => [id, profile.batteries[i]]))
  };
}));

export function formatHouseholdRate(numerator, denominator) {
  return denominator > 0 ? `${(numerator / denominator * 100).toFixed(1)}%` : '未知';
}
export function householdProperties(value) {
  const rows = Array.isArray(value) ? value : list(value?.properties);
  const unique = new Map();
  for (const row of rows) if (row && text(row.id)) unique.set(text(row.id), { ...row, id: text(row.id), name: text(row.name) || '未命名房源' });
  return [...unique.values()];
}
export function householdCanOpenModel(property) {
  return !!property && text(property.id) === HOUSEHOLD_SAMPLE_ID && property.modelReady === true && property.imported !== true;
}
export function householdEventDimensions(event) {
  const device = text(event?.device), title = text(event?.title);
  const dimensions = new Set();
  if (device === 'gateway' || /离线|未上报|上报中断|心跳|连接/.test(title)) dimensions.add('connection');
  if (device === 'gateway') { dimensions.add('execution'); dimensions.add('linkage'); }
  if (['bedroom-ac', 'living-light'].includes(device) || /回执|控制|执行/.test(title)) dimensions.add('execution');
  if (device === 'curtain-sensor' || /联动|场景/.test(title)) dimensions.add('linkage');
  if (['door-lock', 'smoke-sensor', 'water-sensor'].includes(device)) dimensions.add('security');
  if (/电量|电池|耗材/.test(title)) dimensions.add('consumables');
  return [...dimensions];
}
function propertyEvents(events, propertyId) {
  if (!propertyId) return [];
  return list(events).filter(event => event && text(event.propertyId) === propertyId && text(event.id));
}
function propertyTickets(tickets, events) {
  const ids = new Set(events.map(event => text(event.id)));
  return list(tickets).filter(ticket => ticket && ids.has(text(ticket.eventId)));
}
const aggregateFields = (rows, fields) => Object.fromEntries(fields.map(field => [field, sum(rows.map(row => row[field] || 0))]));

export function aggregateHouseholdWindow(period = 'day') {
  const selected = HOUSEHOLD_PERIODS[period] || HOUSEHOLD_PERIODS.day;
  const days = HOUSEHOLD_DAILY_ARCHIVE.slice(-selected.days);
  const devices = HOUSEHOLD_DEVICES.map(device => {
    const connection = aggregateFields(days.map(day => day.connection[device.id]), ['online', 'offline', 'unknown', 'expected']);
    const commands = CONTROL_IDS.includes(device.id) ? aggregateFields(days.map(day => day.commands[device.id]), ['confirmed', 'timeout', 'unknown', 'requested']) : null;
    const batteryReadings = BATTERY_IDS.includes(device.id) ? days.filter(day => Number.isFinite(day.batteries[device.id])) : [];
    const lastBatteryDay = batteryReadings.at(-1);
    const checks = SECURITY_IDS.includes(device.id) ? days.map(day => day.selfChecks[device.id]) : [];
    return {
      ...device, connection, commands,
      batterySamples: BATTERY_IDS.includes(device.id) ? { expected: days.length, received: batteryReadings.length, unknown: days.length - batteryReadings.length, lastValue: lastBatteryDay?.batteries[device.id] ?? null, lastDate: lastBatteryDay?.date ?? null } : null,
      selfChecks: checks.length ? { expected: checks.length, confirmed: checks.filter(value => value === true).length, failed: checks.filter(value => value === false).length, unknown: checks.filter(value => value == null).length } : null
    };
  });
  const connection = aggregateFields(devices.map(device => device.connection), ['online', 'offline', 'unknown', 'expected']);
  connection.observed = connection.online + connection.offline;
  const commands = aggregateFields(devices.flatMap(device => device.commands ? [device.commands] : []), ['confirmed', 'timeout', 'unknown', 'requested']);
  const rules = RULES.map(rule => ({ ...rule, ...aggregateFields(days.map(day => day.rules[rule.id]), ['confirmed', 'failed', 'unknown', 'triggered']) }));
  const linkage = aggregateFields(rules, ['confirmed', 'failed', 'unknown', 'triggered']);
  const security = aggregateFields(devices.flatMap(device => device.selfChecks ? [device.selfChecks] : []), ['expected', 'confirmed', 'failed', 'unknown']);
  const consumables = aggregateFields(devices.flatMap(device => device.batterySamples ? [device.batterySamples] : []), ['expected', 'received', 'unknown']);
  return {
    period, days: days.length, start: days[0].date, end: days.at(-1).date,
    rangeLabel: `${days[0].date} 至 ${days.at(-1).date} · 北京时间`,
    fixtureId: HOUSEHOLD_FIXTURE_ID, archiveIds: days.map(day => day.id),
    devices, connection, commands, rules, linkage, security, consumables,
    usage: { requests: commands.requested, active: devices.filter(device => device.commands?.requested > 0).length, supported: CONTROL_IDS.length }
  };
}

function sampleDimension(definition, aggregate, current) {
  const c = aggregate.connection, x = aggregate.commands, l = aggregate.linkage, s = aggregate.security, b = aggregate.consumables, u = aggregate.usage;
  const common = { ...definition, devices: aggregate.devices.filter(device => definition.deviceIds.includes(device.id)), rules: [], source: `${HOUSEHOLD_FIXTURE_ID} · 固定演示归档`, windowLabel: aggregate.rangeLabel };
  const items = {
    connection: {
      value: formatHouseholdRate(c.online, c.observed), meta: `窗口在线率 · ${c.online}/${c.observed} 有效小时样本`, tone: c.offline || c.unknown ? 'warning' : 'good',
      summary: `当前 ${current.online}/7 台有在线确认，${current.unknown} 台待核验；窗口在线率 ${formatHouseholdRate(c.online, c.observed)}。`,
      stats: [{ label: '当前在线确认', value: `${current.online}/7`, meta: current.simulatedVerification ? '含本地模拟复验；不是新的生产心跳' : `${current.unknown} 台未知，${current.offline} 台确认离线（演示）` }, { label: '窗口在线率', value: formatHouseholdRate(c.online, c.observed), meta: `${c.online} 在线 / ${c.observed} 已知状态样本` }, { label: '采样覆盖', value: formatHouseholdRate(c.observed, c.expected), meta: `${c.observed}/${c.expected}，缺失 ${c.unknown} 不计离线` }],
      formula: '窗口在线率 = 在线小时样本 /（在线 + 确认离线小时样本）；未知样本从该分母排除，并单列采样覆盖率。当前在线台数是独立快照，不是时间在线率。',
      evidenceNeeded: ['真实设备与房源绑定', '心跳时间与现场供电', '网关上联和两台关联设备的独立回执']
    },
    execution: {
      value: formatHouseholdRate(x.confirmed, x.requested), meta: `执行确认 · ${x.confirmed}/${x.requested} 次操作请求`, tone: x.timeout || x.unknown ? 'warning' : 'good',
      summary: `${x.requested} 次演示操作请求中，${x.confirmed} 次有完成确认，${x.timeout} 次超时，${x.unknown} 次未知。`,
      stats: [{ label: '完成确认', value: `${x.confirmed}/${x.requested}`, meta: '确认数 / 全部请求数' }, { label: '回执超时', value: `${x.timeout} 次`, meta: '超时不能直接认定设备执行失败' }, { label: '结果未知', value: `${x.unknown} 次`, meta: '尚无足够结果证据' }],
      formula: '执行确认率 = 有完成回执的操作请求 / 全部请求。超时与未知单列，不合并成已确认失败；仅覆盖照明、空调、门锁、窗帘四类演示设备。',
      evidenceNeeded: ['请求 ID 与回执 ID', '指令发送时间和超时阈值', '设备实际状态与重复执行风险']
    },
    linkage: {
      value: `${l.confirmed}/${l.triggered}`, meta: `场景触发已确认 · ${formatHouseholdRate(l.confirmed, l.triggered)}`, tone: l.failed || l.unknown ? 'warning' : 'good', rules: aggregate.rules,
      summary: `3 条演示规则共触发 ${l.triggered} 次，${l.confirmed} 次完成确认，${l.failed} 次记录失败，${l.unknown} 次未知。`,
      stats: [{ label: '联动确认率', value: formatHouseholdRate(l.confirmed, l.triggered), meta: `${l.confirmed}/${l.triggered} 次触发` }, { label: '记录失败', value: `${l.failed} 次`, meta: '固定演示日志中的失败分类' }, { label: '结果未知', value: `${l.unknown} 次`, meta: '不按成功或失败推断' }],
      formula: '联动确认率 = 全步骤有完成证据的触发次数 / 规则触发次数。操作请求与场景触发不是同一统计单位，不能相加。',
      evidenceNeeded: ['规则版本与触发条件', '每个动作步骤的回执', '网关和关联设备是否同一时段异常']
    },
    security: {
      value: `${s.confirmed}/${s.expected}`, meta: '传感器自检回执 · 环境安全仍待核验', tone: s.unknown || s.failed ? 'warning' : 'neutral',
      summary: `烟感与漏水传感器预期 ${s.expected} 次演示自检，${s.confirmed} 次收到通过回执，${s.unknown} 次未知。未接入真实告警流。`,
      stats: [{ label: '自检通过回执', value: `${s.confirmed}/${s.expected}`, meta: '只覆盖烟感、漏水两种传感器' }, { label: '自检未知', value: `${s.unknown} 次`, meta: '缺回执不等于发生火情或漏水' }, { label: '真实告警状态', value: '未知', meta: '没有连接真实告警系统' }],
      formula: '自检回执覆盖仅统计两种传感器每日计划。门锁列作安防关联设备，但没有纳入此自检分母。自检通过不能证明现场绝对安全。',
      evidenceNeeded: ['真实告警记录与采集时间', '传感器自检原始回执', '现场情况；有现场险情时转人工处理']
    },
    consumables: {
      value: `${b.received}/${b.expected}`, meta: `电量样本覆盖 · 缺失 ${b.unknown} 条`, tone: b.unknown ? 'warning' : 'neutral',
      summary: `3 个电池设备预期 ${b.expected} 条电量样本，收到 ${b.received} 条；当前快照仅门锁 68%、烟感 82%，漏水传感器当前读数未知。`,
      stats: [{ label: '电量采样覆盖', value: formatHouseholdRate(b.received, b.expected), meta: `${b.received}/${b.expected} 条预期读数` }, { label: '当前可读设备', value: '2/3', meta: '门锁 68% · 烟感 82%（演示）' }, { label: '当前缺失读数', value: '1 台', meta: '漏水传感器；不推断电量低或离线' }],
      formula: '电量采样覆盖 = 实际读数条数 / 三个电池设备每天各一次的预期读数。窗口最后读数与当前快照分开，过期读数不能当作当前电量。',
      evidenceNeeded: ['电池设备真实台账', '电量上报时间与型号阈值', '耗材规格、现场可用性与更换确认']
    },
    usage: {
      value: `${u.requests} 次`, meta: `${u.active}/${u.supported} 种操作设备有请求记录`, tone: 'neutral',
      summary: `所选窗口记录 ${u.requests} 次演示操作请求，覆盖 ${u.active}/${u.supported} 类可操作设备，不用于推断住户在家或实际使用习惯。`,
      stats: [{ label: '操作请求', value: `${u.requests} 次`, meta: '包含有回执、超时和未知的请求' }, { label: '有请求的设备', value: `${u.active}/${u.supported}`, meta: '仅照明、空调、门锁、窗帘' }, { label: '使用效果', value: '待核验', meta: '请求次数不等于成功执行或住户满意度' }],
      formula: '使用次数采用四种可操作设备的演示请求计数，与执行维度的请求总数相等。未统计住户身份、入住情况或设备实际能耗。',
      evidenceNeeded: ['操作日志与去重规则', '功能启用范围', '真实使用效果的业务确认']
    }
  };
  return { ...common, ...items[definition.id] };
}

export function buildHouseholdModel({ property, events = [], tickets = [], period = 'day' } = {}) {
  const propertyId = text(property?.id);
  const allEvents = propertyEvents(events, propertyId);
  const pending = allEvents.filter(event => event.status !== 'resolved');
  const relatedTickets = propertyTickets(tickets, allEvents);
  const hasSample = propertyId === HOUSEHOLD_SAMPLE_ID && property?.imported !== true;
  const selectedPeriod = HOUSEHOLD_PERIODS[period] ? period : 'day';
  const gatewayEvent = allEvents.find(event => event.id === 'EVT-DEMO-001' && event.device === 'gateway');
  const simulatedVerification = hasSample && gatewayEvent?.status === 'resolved';
  const aggregate = hasSample ? aggregateHouseholdWindow(selectedPeriod) : null;
  const currentDevices = hasSample ? HOUSEHOLD_DEVICES.map(device => ({
    ...device,
    status: simulatedVerification && ['gateway', 'living-light', 'bedroom-ac'].includes(device.id) ? 'online' : device.current,
    isSimulatedVerification: simulatedVerification && ['gateway', 'living-light', 'bedroom-ac'].includes(device.id)
  })) : [];
  const current = hasSample ? {
    total: currentDevices.length, online: currentDevices.filter(device => device.status === 'online').length,
    offline: currentDevices.filter(device => device.status === 'offline').length,
    unknown: currentDevices.filter(device => device.status === 'unknown').length,
    simulatedVerification, snapshotAt: '2026-11-19 23:59（固定演示快照）'
  } : null;
  const dimensions = HOUSEHOLD_DIMENSIONS.map(definition => {
    const relatedEvents = allEvents.filter(event => householdEventDimensions(event).includes(definition.id));
    const relatedPending = relatedEvents.filter(event => event.status !== 'resolved');
    const item = hasSample ? sampleDimension(definition, aggregate, current) : {
      ...definition, value: '未接入', meta: relatedPending.length ? `${relatedPending.length} 条演示待办可核验` : '全户设备与窗口指标未知', tone: relatedPending.length ? 'warning' : 'neutral',
      summary: '此房源没有接入完整设备台账与遥测；不能根据一条演示待办推断整户运行状态。',
      stats: [{ label: '全户设备数量', value: '未知', meta: '不复制样板房的 7 台设备' }, { label: '所选窗口指标', value: '未接入', meta: `没有可聚合的${HOUSEHOLD_PERIODS[selectedPeriod].label}窗口数据` }, { label: '关联演示待办', value: `${relatedPending.length} 条`, meta: '仅来自现有事件列表' }],
      formula: '没有该房源的真实设备总数、时间窗与原始样本，因此没有可计算的全户分子、分母或健康率。',
      devices: [], rules: [], source: '当前 Demo 事件 / 工单；未接入该户遥测', windowLabel: `所选：${HOUSEHOLD_PERIODS[selectedPeriod].label} · 没有对应遥测窗口`,
      evidenceNeeded: ['该房源真实设备绑定与在管范围', '带时间戳的遥测和采样频率', '事件对应设备、现场情况与复验依据']
    };
    item.relatedEvents = relatedEvents;
    item.pendingEvents = relatedPending;
    item.devices = item.devices.map(device => ({ ...device, current: currentDevices.find(currentDevice => currentDevice.id === device.id) }));
    return item;
  });
  return { property, propertyId, hasSample, canModel: householdCanOpenModel(property), period: selectedPeriod, aggregate, current, currentDevices, dimensions, allEvents, pendingEvents: pending, tickets: relatedTickets };
}

const QUESTION_DIMENSIONS = [
  [/电量|电池|耗材|更换/, 'consumables'], [/漏水|水浸|烟感|火情|安防|报警/, 'security'],
  [/断网|离线|连接|网关|心跳|在线率/, 'connection'], [/联动|场景|窗帘/, 'linkage'],
  [/回执|执行|空调|照明|开门|关灯/, 'execution'], [/用了几次|使用|频率|请求次数/, 'usage']
];
const CANDIDATES = {
  connection: '候选包括共同供电、上联网络或心跳采集链路异常；缺上报也可能来自采样缺失。当前证据不能直接判定设备损坏。',
  execution: '候选包括网络延迟、网关转发、设备应答或回执关联缺失。超时不能单独证明指令未执行，先避免重复动作。',
  linkage: '候选包括触发条件、规则版本、某一步回执或关联设备链路。需逐步核验，不能只凭最终结果定位故障。',
  security: '候选包括传感器供电、通信或自检采集缺失。没有告警记录不能证明现场安全，缺回执也不能推断发生火情或漏水。',
  consumables: '候选包括读数过期、电池消耗或上报异常；阈值需按设备型号确认。样本缺失本身不等于低电量。',
  usage: '请求数量会受统计窗口与启用功能影响。当前没有住户行为或实际体验数据，不能据此判断家庭活跃度或满意度。'
};

export function answerHouseholdQuestion({ model, dimensionId = 'connection', eventId = null, question = '' }) {
  const input = text(question).trim();
  const inferred = QUESTION_DIMENSIONS.find(([pattern]) => pattern.test(input))?.[1];
  const selectedId = inferred || dimensionId;
  const dimension = model.dimensions.find(item => item.id === selectedId) || model.dimensions[0];
  const selectedEvent = model.allEvents.find(event => text(event.id) === text(eventId) && (!inferred || householdEventDimensions(event).includes(inferred)));
  const event = selectedEvent || dimension.pendingEvents[0] || dimension.relatedEvents[0] || null;
  const context = { propertyId: model.propertyId, propertyName: model.property?.name || '未选择房源', dimensionId: dimension.id, dimensionLabel: dimension.label, period: model.period, periodLabel: HOUSEHOLD_PERIODS[model.period].label, windowLabel: dimension.windowLabel, eventId: event?.id || null, eventStatus: event?.status || null };
  const historyIntent = /以前|历史|处理过|维修记录|工单记录|上次/.test(input);
  const actionIntent = /(?:帮我|立即|现在|请|直接).*(?:开门|关门|开灯|关灯|开空调|关空调|重启|重置|下发|维修|派单)|下发指令|自动修复|^(?:开门|关门|开灯|关灯|开空调|关空调|重启|重置)/.test(input);
  const supported = historyIntent || actionIntent || /为什么|异常|原因|怎么办|处理|核验|复验|状态|设备|连接|在线|离线|网关|心跳|回执|执行|联动|场景|安防|烟感|漏水|水浸|报警|电量|电池|耗材|使用|请求|统计|样本|采样|覆盖|缺失|维修|工单/.test(input);
  const actions = event ? [{ type: 'event', id: text(event.id), label: event.status === 'resolved' ? '查看演示复验记录' : '打开关联待办' }] : [];
  const sourceNote = '演示问答 · 本地规则匹配，未连接大模型。依据提问时的房源、维度、现有事件和当前浏览器工单；不执行设备控制或自动派单。';
  if (!supported) return {
    context, sourceNote, sections: [
      { title: '观察到什么', text: `已选择${context.propertyName}的「${dimension.label}」，但这条问题不在当前演示规则覆盖范围内。` },
      { title: '原因候选', text: '此处没有开放域推理、联网搜索或额外住户资料，无法补充未提供的事实。' },
      { title: '建议核验', text: '可以选择六个运行维度，或围绕当前待办询问原因、处理步骤和已有工单。' },
      { title: '下一步与复验', text: '试试“为什么异常”“怎么办”或“以前处理过吗”。没有对应数据时会保留未知。' }
    ], actions: [...actions, { type: 'dimension', id: 'connection', label: '查看连接维度' }, { type: 'dimension', id: 'consumables', label: '查看耗材维度' }]
  };
  if (historyIntent) {
    const eventIds = new Set(event ? [text(event.id)] : dimension.relatedEvents.map(item => text(item.id)));
    const records = model.tickets.filter(ticket => eventIds.has(text(ticket.eventId)));
    const closed = records.filter(ticket => ticket.status === 'closed');
    const recordText = records.length ? records.map(ticket => `${text(ticket.id) || '未编号'}：${ticket.status === 'closed' ? '演示已复验' : '工单草稿'}；生成 ${text(ticket.createdAt) || '时间未提供'}${ticket.verifiedAt ? `；复验 ${text(ticket.verifiedAt)}` : ''}`).join('。') : '当前浏览器没有这项问题的关联工单记录。';
    return { context, sourceNote, sections: [
      { title: '观察到什么', text: recordText },
      { title: '原因候选', text: closed.length ? `已有 ${closed.length} 条演示复验记录，可作为本次核验的参考；不能证明真实设备已维修，也不能据此认定同一根因。` : '缺少已复验记录，无法判断以前是否在真实业务中处理过；未接入外部维修系统。' },
      { title: '建议核验', text: '核对现有工单的设备、证据、处理建议与复验字段，必要时由业务负责人补充真实历史。' },
      { title: '下一步与复验', text: event ? '可打开关联待办查看当前演示流程；已有记录不会被改写为新的维修经历。' : '先选择当前房源的一条待办；没有待办时不虚构工单或维修记录。' }
    ], actions };
  }
  const evidence = event ? list(event.evidence).filter(pair => Array.isArray(pair)).slice(0, 4).map(([key, value]) => `${text(key)}：${text(value)}`).join('；') : '';
  const observed = actionIntent
    ? '这是设备操作或派单请求。本 Demo 没有连接生产设备或真实工单系统，本次没有下发指令、执行修复或实际派单。'
    : event
      ? `${event.status === 'resolved' ? '该事件已在当前浏览器完成模拟复验。以下是事件初始记录，不是新的设备回执：' : '当前有一条关联演示待办。'}${text(event.title)}。${text(event.summary)}${evidence ? ` 事件初始证据：${evidence}。` : ''}`
      : model.hasSample ? dimension.summary : `本房源「${dimension.label}」的全户遥测未接入；没有该维度的关联演示待办，运行状态仍未知。`;
  return { context, sourceNote, sections: [
    { title: '观察到什么', text: observed },
    { title: '原因候选', text: CANDIDATES[dimension.id] },
    { title: '建议核验', text: `${dimension.evidenceNeeded.join('；')}。${model.hasSample ? ` 窗口口径：${dimension.formula}` : ' 缺少这些资料时不计算整户指标。'}` },
    { title: '下一步与复验', text: event ? event.status === 'resolved' ? '打开现有记录核对模拟复验结果；固定演示窗口的历史统计保持原值，不会因此变成 100%。' : '打开关联待办，沿用现有诊断、工单草稿与模拟复验流程。现场证据不足时交由业务负责人确认，建议不是执行回执。' : '可继续查看当前维度或其他待办；没有匹配事件时不自动创建工单。接入真实数据后再核验运行结果。' }
  ], actions };
}
