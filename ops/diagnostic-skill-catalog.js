// Product-demo skills authored from the supplied household operations workflow.
// Model-specific thresholds and commands require the actual device documentation.
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const DIAGNOSTIC_SKILLS = freeze({
  connection: {
    id: 'LZ-SKILL-CONNECTION', dimension: 'connection', title: '设备连接与共同链路排查', version: '0.2-demo',
    appliesTo: '设备未回应、心跳中断，或同一网关下多台设备同时异常。',
    evidence: ['房源与设备绑定、设备型号', '最近心跳与采集时间', '同网关设备的同期状态', '现场供电与上联网络确认'],
    checks: [
      { title: '确认异常范围', detail: '比较单设备与同网关设备的时间线；缺少上报先记为未知，确认是否有共同异常。' },
      { title: '核对共同链路', detail: '依次核验供电、上联网络、网关和采集链路；共同链路证据不足时不判定单设备损坏。' },
      { title: '定位设备侧问题', detail: '共同链路正常后，再核对设备绑定、现场状态和型号文档；保留仍未确认的原因。' }
    ],
    verify: ['取得该设备新的有效心跳，并注明时间。', '同时核验受影响设备的独立回应，确认关联影响是否解除。'],
    handoff: '共同链路仍异常、现场供电无法确认或缺少设备证据时，携带时间线与影响清单转人工。'
  },
  execution: {
    id: 'LZ-SKILL-EXECUTION', dimension: 'execution', title: '指令执行与回执排查', version: '0.2-demo',
    appliesTo: '控制请求超时、状态未更新，或操作结果与回执不一致。',
    evidence: ['设备与命令对应关系', '请求 ID、发送时间与目标状态', '回执 ID、时间与结果', '设备实际状态及型号规定的等待条件'],
    checks: [
      { title: '关联请求与回执', detail: '核对同一设备、请求标识和时间范围，区分未发送、无回执、明确失败与已确认完成。' },
      { title: '检查转发链路', detail: '比对网关及同链路设备状态，确认延迟发生在发送、转发、设备回应还是状态采集环节。' },
      { title: '确认实际结果', detail: '先核验设备是否已经执行，再决定后续处理；回执超时不直接视为执行失败，不默认重复动作。' }
    ],
    verify: ['请求、完成回执与设备实际状态能相互对应。', '关联影响得到核验；未取得结果的请求继续保留为待确认。'],
    handoff: '存在重复执行风险、设备状态相互矛盾或无法取得有效回执时，保留请求记录转人工核验。'
  },
  linkage: {
    id: 'LZ-SKILL-LINKAGE', dimension: 'linkage', title: '场景联动逐步排查', version: '0.2-demo',
    appliesTo: '自动化场景未触发、部分动作遗漏，或执行顺序与配置不一致。',
    evidence: ['规则名称、版本与启用状态', '触发条件及触发记录', '动作顺序、目标设备与逐步回执', '关联设备和网关的同期状态'],
    checks: [
      { title: '核对触发条件', detail: '确认规则启用及当时条件是否满足；没有触发证据时，不把后续动作缺失归为设备故障。' },
      { title: '查找中断步骤', detail: '按动作顺序核对每一步回执，区分未执行、等待、明确失败与结果未知。' },
      { title: '复核规则与依赖', detail: '检查规则版本、目标绑定和共同链路；将单个动作问题与整条场景问题分开。' }
    ],
    verify: ['一次完整演示中，触发与各动作步骤均有可关联的结果。', '受影响设备的最终状态与规则目标一致。'],
    handoff: '规则冲突、涉及门锁等需现场确认的动作，或缺少逐步日志时，由业务负责人确认处理方案。'
  },
  security: {
    id: 'LZ-SKILL-SECURITY', dimension: 'security', title: '安防告警与设备自检核验', version: '0.2-demo',
    appliesTo: '安防告警、自检回执缺失，或相关传感器长期未回应。',
    evidence: ['告警类型、对象与发生时间', '现场情况确认', '传感器最近上报及自检回执', '关联设备的供电、通信与绑定信息'],
    checks: [
      { title: '先确认现场情况', detail: '区分现场告警、设备自检失败与数据缺失；需要现场处理的情况优先交人工，不等待自动排障。' },
      { title: '核对告警证据', detail: '比对原始告警、时间和设备身份；没有记录不代表现场安全，缺回执也不等于已经发生险情。' },
      { title: '检查设备链路', detail: '现场情况确认后，再核验供电、通信和自检；不通过清除或复位告警替代问题确认。' }
    ],
    verify: ['取得与本次问题对应的现场确认和设备回执。', '明确已处理事项及仍未知事项，不以在线状态替代现场结论。'],
    handoff: '存在现场风险、重复告警或无法确认现场情况时，优先联系现场负责人并携带告警记录转人工。'
  },
  consumables: {
    id: 'LZ-SKILL-CONSUMABLES', dimension: 'consumables', title: '电量与耗材维护核验', version: '0.2-demo',
    appliesTo: '低电量提示、耗材更换提醒，或读数长期未更新。',
    evidence: ['设备型号与耗材规格', '读数、上报时间和有效性', '该型号的维护阈值或更换依据', '现场可用性与更换记录'],
    checks: [
      { title: '确认读数有效', detail: '核对最近上报时间，区分当前低读数、历史旧读数与采样缺失。' },
      { title: '匹配维护依据', detail: '按实际设备型号核对阈值及耗材规格，不将其他型号的阈值或预计剩余天数直接套用。' },
      { title: '核对维护结果', detail: '记录现场可用性与更换情况；更换后的新读数和设备工作状态需要分别确认。' }
    ],
    verify: ['维护记录与设备、型号、耗材规格对应。', '取得新的有效读数与可用性确认，缺少任一项则继续待复验。'],
    handoff: '型号规格不明、设备已影响使用或更换后仍异常时，提交设备资料和维护记录转人工。'
  },
  usage: {
    id: 'LZ-SKILL-USAGE', dimension: 'usage', title: '功能启用与使用记录核验', version: '0.2-demo',
    appliesTo: '功能没有使用记录、使用次数异常，或用户反馈功能不会用。',
    evidence: ['功能启用范围与设备绑定', '明确的统计窗口', '去重后的操作请求与回执', '用户对实际使用问题的确认'],
    checks: [
      { title: '核对功能是否启用', detail: '先确认该户已配置并开放相关功能，未启用或未配置不作为运行故障。' },
      { title: '核对统计口径', detail: '检查时间窗、去重和采样覆盖，区分没有操作、没有记录与操作未确认。' },
      { title: '匹配服务方式', detail: '按反馈提供使用指引，或转入连接、执行、联动排查；不从操作次数推断住户在家情况。' }
    ],
    verify: ['功能启用范围与统计窗口已确认。', '使用问题得到反馈确认；涉及操作异常时，关联技术排障结果。'],
    handoff: '需要新增配置、功能培训或无法确认使用体验时，将已知问题交由对应服务人员跟进。'
  }
});

export function getDiagnosticSkill(dimensionId) {
  return Object.hasOwn(DIAGNOSTIC_SKILLS, dimensionId) ? DIAGNOSTIC_SKILLS[dimensionId] : DIAGNOSTIC_SKILLS.connection;
}
