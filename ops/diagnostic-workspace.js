import { getDiagnosticSkill } from './diagnostic-skill-catalog.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const now = () => new Date().toISOString();
const option = (value, label) => ({value, label});
const unknown = option('unknown', '尚未核验');
const field = (key, label, options, hint) => ({key, label, options:[unknown, ...options], hint});
const common = [
  field('binding', '房源与设备绑定', [option('confirmed','绑定一致（演示）'),option('mismatch','绑定信息不一致（演示）')], '先确认正在排查的房源和设备，避免处理错对象。'),
  field('freshness', '上报时间与采样窗口', [option('fresh','当前演示窗口有效'),option('stale','仅有过期记录')], '过期读数不能用于判断设备此刻的状态。')
];
const scopeField = field('scope','异常影响范围',[option('shared','同网关多设备同时异常'),option('single','仅当前设备异常')],'同户对照用于区分共同链路和单设备问题。');
const powerField = field('power','供电核对',[option('normal','已确认供电正常'),option('abnormal','已发现供电异常')],'模拟现场反馈；没有反馈时保留未知。');
const networkField = field('network','网关上联网络',[option('normal','上联检查正常'),option('abnormal','上联检查异常')],'上联正常仍不能证明设备回执链路正常。');

export function eventSkillDimension(event) {
  if (/电量|电池/.test(event?.title || '')) return 'consumables';
  if (['smoke-sensor','water-sensor','gas-sensor'].includes(event?.device)) return 'security';
  if (/回执|控制|执行/.test(event?.title || '')) return 'execution';
  if (/联动|场景/.test(event?.title || '')) return 'linkage';
  return 'connection';
}

export function diagnosticFields(event) {
  const dimension = eventSkillDimension(event);
  if (dimension === 'consumables') return [...common,
    field('battery','连续电量读数',[option('low','连续读数低于该型号阈值'),option('normal','读数在该型号正常范围')],'阈值需由真实型号规范配置，截图未提供可核验阈值。'),
    field('usability','现场使用情况',[option('usable','现场反馈可正常使用'),option('unavailable','现场反馈使用受影响')],'不以电量读数直接判断锁具是否可用。'),
    field('specification','耗材规格',[option('confirmed','型号与耗材规格已确认')],'确认型号与适配耗材后再安排更换。')];
  if (dimension === 'security') return [...common, scopeField,
    field('alarm','现场告警信息',[option('none_reported','本次未取得现场险情报告'),option('reported','收到现场险情报告')],'未上报不等同发生烟雾、漏水或燃气事件。'),
    field('battery','供电或电量',[option('normal','现场确认供电 / 电量正常'),option('low','现场确认供电 / 电量异常')],'记录现场确认，不从离线状态反推电量。'),
    field('selftest','设备自检回执',[option('passed','已取得自检通过回执'),option('failed','已取得自检失败回执')],'采用对应型号支持的自检方式；当前不发送设备指令。')];
  if (dimension === 'execution') return [...common, scopeField, networkField,
    field('receipt','原指令回执',[option('timeout','回执超时'),option('success','有完成回执'),option('failed','有失败回执')],'按原请求 ID 对应回执，避免把重复请求合并。'),
    field('actual','设备实际状态',[option('changed','现场确认状态已改变'),option('unchanged','现场确认状态未改变')],'超时可能只是回执丢失，先核对状态再决定是否重试。')];
  return [...common, scopeField, powerField, networkField,
    field('heartbeat','设备新心跳',[option('missing','未取得新心跳'),option('recovered','已取得新心跳')],'新心跳只确认连接恢复，仍需检查关联设备和原场景。')];
}

export function cleanSkillRun(event) {
  const source = event?.skillRun && typeof event.skillRun === 'object' ? event.skillRun : {};
  const fields = diagnosticFields(event), evidence = {};
  for (const f of fields) evidence[f.key] = f.options.some(o => o.value === source.evidence?.[f.key]) ? source.evidence[f.key] : 'unknown';
  const skill = getDiagnosticSkill(eventSkillDimension(event));
  const existed=Object.keys(source).length>0;
  const stale=existed && (source.skillId!==skill.id || source.skillVersion!==skill.version || fields.some(f=>source.evidence?.[f.key]!==evidence[f.key]));
  const assessmentValid=!source.assessment || (typeof source.assessment.title==='string' && Array.isArray(source.assessment.missing));
  const invalidate=stale || !assessmentValid;
  const verification = invalidate?{status:'pending',checks:{}}:{status:'pending',checks:{},...(source.verification || {})};
  if (!['passed','failed','pending','unknown'].includes(verification.status)) verification.status='unknown';
  if(verification.status==='passed' && verificationResult(event,verification.checks)!=='passed')verification.status='pending';
  let history=Array.isArray(source.history)?source.history.filter(item=>item && typeof item.action==='string').slice(-29):[];
  if(invalidate)history=[...history,{at:now(),action:'旧结论转为历史参考',detail:'技能版本或证据选项发生变化，当前结论与复验已重置。原结论：'+(typeof source.summary==='string'?source.summary:'未保存'),mode:'simulation'}];
  return {
    schemaVersion:1, skillId:skill.id, skillVersion:skill.version, mode:'simulation',
    evidence, assessment:invalidate?null:source.assessment || null,
    summary:!invalidate && typeof source.summary === 'string' ? source.summary : '',
    note:typeof source.note === 'string' ? source.note.slice(0,600) : '',
    verification, history,
    updatedAt:source.updatedAt || null
  };
}

export function evaluateDiagnostic(event, evidence) {
  const dimension=eventSkillDimension(event), fields=diagnosticFields(event);
  evidence=Object.fromEntries(fields.map(f=>[f.key,f.options.some(o=>o.value===evidence?.[f.key])?evidence[f.key]:'unknown']));
  const missing=fields.filter(f=>!evidence[f.key] || evidence[f.key]==='unknown').map(f=>f.label);
  let title='证据不足，先补齐核验', reason='当前记录尚不能确定具体原因。', action='依次补充上报时间、影响范围和现场反馈。', handoff=false;
  if(dimension==='security' && evidence.alarm==='reported'){
    title='现场险情优先，转人工处置'; reason='已有现场险情报告，不能用远程自检结果替代现场判断。';
    action='按现场应急流程联系物业或专业人员，保留告警与处理记录。'; handoff=true;
  }else if(evidence.binding==='mismatch'){
    title='先纠正房源与设备绑定'; reason='排障对象不一致，后续日志可能属于其他设备。';
    action='交由资产或实施人员核对设备编号、型号与房源绑定，再重新诊断。'; handoff=true;
  }else if(evidence.freshness==='stale'){
    title='先取得当前窗口的有效证据'; reason='目前依赖过期上报，无法判断当前状态。';
    action='核对采集时间和设备绑定，补充当前回执或现场反馈。';
  }else if(dimension==='consumables'){
    if(evidence.usability==='unavailable'){
      title='现场使用受影响，优先人工跟进'; reason='已录入使用受影响的模拟反馈，不能只凭电量安排普通巡检。';
      action='确认现场需求和可用进入方式，联系负责人；不自动开锁。'; handoff=true;
    }else if(evidence.battery==='low'){
      title='低电量处理候选'; reason='连续读数已标记低于该型号阈值，仍需确认采样时效和规格。';
      action=evidence.specification==='confirmed'?'与现场约定更换耗材，更换后核对新电量和实际使用。':'先确认设备型号与耗材规格，再安排更换。';
    }else if(evidence.battery==='normal'){
      title='当前读数未支持低电量原因'; reason='录入的电量正常，原告警可能需要核对时间窗口。';
      action='比较原告警与最新读数，保留原因未确认状态。';
    }
  }else if(dimension==='security'){
    if(evidence.selftest==='failed'){
      title='设备自检未通过，交专业人员复核'; reason='已有自检失败回执，但具体故障部件尚未确认。';
      action='保存回执、型号与现场情况，按型号指引人工排查。'; handoff=true;
    }else if(evidence.battery==='low'){
      title='供电或电量异常可能影响上报'; reason='现场供电 / 电量被标记异常。';
      action='先按型号规范处理供电，再复核心跳、自检和测试事件。';
    }else if(evidence.scope==='shared'){
      title='优先核对共同网关与上报链路'; reason='同网关多个设备同时异常，单设备损坏尚无证据。';
      action='核对网关上联、供电与各设备独立回执。';
    }else if(evidence.selftest==='passed'){
      title='自检通过，继续确认上报恢复'; reason='自检通过仅确认该次测试，不等于持续在线或现场绝对安全。';
      action='核对新心跳与上报时间，必要时按型号规范验证测试事件。';
    }
  }else if(dimension==='execution'){
    if(evidence.receipt==='timeout' && evidence.actual==='changed'){
      title='设备已动作，重点核查回执链路'; reason='实际状态已变化，但原请求回执超时。';
      action='用原请求 ID 核查回执路径，避免重复执行同一动作。';
    }else if(evidence.receipt==='success' && evidence.actual==='changed'){
      title='完成回执与状态一致，进入复验'; reason='本次模拟核验已具备动作与回执两类完成证据。';
      action='保留对应请求与回执，按原使用场景复测后再关闭工单。';
    }else if(evidence.receipt==='failed'){
      title='已取得失败回执，具体原因待定位'; reason='失败回执支持本次执行未完成，但没有提供具体根因。';
      action='核查返回码、设备状态、协议和参数，必要时交技术人员。';
    }else if(evidence.network==='abnormal'){
      title='上联网络异常可能影响指令回执'; reason='上联检查已标记异常，动作是否执行仍需单独确认。';
      action='先恢复上联并核对实际状态，不盲目重发原指令。';
    }
  }else{
    if(evidence.power==='abnormal'){
      title='优先处理已观察到的供电异常'; reason='供电核对结果异常，仍不能据此认定网关硬件损坏。';
      action='由现场人员核对供电，恢复后检查网关及关联设备回执。';
    }else if(evidence.network==='abnormal'){
      title='优先排查网关上联网络'; reason='已录入上联异常证据，共同链路是当前排查方向。';
      action='核对网络接入和连接状态，恢复后验证关联设备。';
    }else if(evidence.heartbeat==='recovered'){
      title='已取得新心跳，等待整链路复验'; reason='新心跳支持连接恢复，尚不能证明全部业务恢复。';
      action='检查关联设备独立回执，并复测原异常场景。';
    }else if(evidence.scope==='shared'){
      title='共同链路异常优先，根因待确认'; reason='同网关多个设备同时未回应，共同依赖应先于单设备排查。';
      action='继续核对供电、上联和平台上报；不默认重置网关。';
    }else if(evidence.scope==='single'){
      title='单设备链路待核验'; reason='其他设备未见同类影响，但单台硬件损坏仍未得到确认。';
      action='核对该设备供电、最近心跳及它与网关的通信记录。';
    }
  }
  if(evidence.binding==='unknown' && title!=='现场险情优先，转人工处置'){
    title='先确认房源与设备绑定';
    reason='尚未确认排障对象，以下技术检查需绑定一致后继续。';
    action='补齐房源、设备编号与型号对应关系。';
  }
  return {title,reason,action,handoff,missing,known:fields.length-missing.length,total:fields.length,generatedAt:now(),mode:'simulation'};
}

export function verificationCriteria(event) {
  switch(eventSkillDimension(event)){
    case 'consumables': return ['已取得更换后的有效电量读数','现场使用反馈已确认','型号、耗材与更换记录已核对'];
    case 'execution': return ['新请求与回执可以一一对应','回执与设备实际状态一致','原使用场景复测已通过'];
    case 'security': return ['新心跳及采样时间已核对','按对应型号完成自检并取得回执','现场反馈与必要测试事件已核对'];
    default:return ['网关 / 设备新心跳已恢复','关联设备的独立回执已核对','原异常场景复测已通过'];
  }
}

export function verificationResult(event, checks) {
  const values=verificationCriteria(event).map((_,i)=>checks?.['check'+i] || 'unknown');
  if(values.includes('failed'))return 'failed';
  return values.every(value=>value==='passed')?'passed':'pending';
}

function appendHistory(run, action, detail) {
  return {...run, updatedAt:now(), history:[...run.history,{at:now(),action,detail,mode:'simulation'}].slice(-30)};
}

export function mountDiagnosticWorkspace(container, {event,ticket,onUpdate,onTicket,onVerify,onLocate,onRunning,onExport}={}) {
  if(!container || !event)return;
  const skill=getDiagnosticSkill(eventSkillDimension(event)), fields=diagnosticFields(event), run=cleanSkillRun(event);
  const resolved=event.status==='resolved', locked=resolved || !!ticket;
  const validAssessment=!!run.assessment && !!run.summary;
  const evidenceHtml=fields.map(f=>'<label class="diagw-field"><span>'+esc(f.label)+'</span><select data-diagw-evidence="'+f.key+'" aria-label="'+esc(f.label)+'" '+(locked?'disabled':'')+'>'+f.options.map(o=>'<option value="'+o.value+'" '+(run.evidence[f.key]===o.value?'selected':'')+'>'+esc(o.label)+'</option>').join('')+'</select><small>'+esc(f.hint)+'</small></label>').join('');
  const assessment=run.assessment;
  const resultHtml=validAssessment?'<div class="diagw-result" data-tone="'+(assessment.handoff?'alert':'review')+'"><div class="diagw-result-heading"><strong>'+esc(assessment.title)+'</strong><span>'+esc(assessment.known)+' / '+esc(assessment.total)+' 项已核验</span></div><p>'+esc(assessment.reason)+'</p><h4>下一步处理</h4><p>'+esc(assessment.action)+'</p><p class="diagw-missing">'+(assessment.missing.length?'待补证据：'+esc(assessment.missing.join('、')):'本轮检查项已录入；仍需独立复验。')+'</p></div>':'<p class="diagw-empty">录入核验结果后生成原因候选。缺失证据会保留为未知。</p>';
  const vLabels={passed:'本轮模拟复验通过',failed:'复验未通过，保持工单待处理',pending:'复验条件尚未完成',unknown:'复验状态待确认'};
  const legacyResolved=resolved && !event.skillRun?.verification;
  const verifyHtml=legacyResolved?'<section class="diagw-section"><h3>旧版演示记录</h3><p class="diagw-muted">该事件由旧版模拟流程关闭，未保存本轮逐项复验证据。新排障流程将分别记录每一项复验结果。</p></section>':ticket?'<section class="diagw-section"><div class="diagw-section-heading"><span>04</span><h3>处理后复验</h3></div><p class="diagw-muted">逐项录入本次模拟复验结果，全部通过后才关闭演示工单。</p><div class="diagw-verification">'+verificationCriteria(event).map((label,i)=>'<label><span>'+esc(label)+'</span><select data-diagw-check="check'+i+'" aria-label="'+esc(label)+'" '+(resolved?'disabled':'')+'>'+[unknown,option('passed','已通过（模拟）'),option('failed','未通过（模拟）')].map(o=>'<option value="'+o.value+'" '+((run.verification.checks?.['check'+i]||'unknown')===o.value?'selected':'')+'>'+esc(o.label)+'</option>').join('')+'</select></label>').join('')+'</div><p class="diagw-verification-status" data-status="'+esc(run.verification.status)+'" role="status">'+esc(vLabels[run.verification.status] || vLabels.unknown)+'</p>'+(!resolved?'<button type="button" class="button primary" data-diagw-action="verify">记录模拟复验</button>':'')+'</section>':'';
  container.innerHTML='<section class="diagw-skill"><div><span class="diagw-eyebrow">技术技能 · '+esc(skill.id)+'</span><h3>'+esc(skill.title)+'</h3><p>'+esc(skill.appliesTo)+'</p></div><span class="tag blue">本地规则演练</span></section>'+
    '<section class="diagw-section"><div class="diagw-section-heading"><span>01</span><h3>核对证据</h3></div><div class="diagw-source-note">选择项均为人工录入的演示证据；未读取或控制真实设备。</div>'+(!locked?'<button type="button" class="button" data-diagw-action="sample">载入已有演示证据</button>':'')+'<div class="diagw-fields">'+evidenceHtml+'</div><label class="diagw-note">补充记录<textarea data-diagw-note maxlength="600" rows="2" placeholder="补充本次模拟核验情况" '+(locked?'disabled':'')+'>'+esc(run.note)+'</textarea></label></section>'+
    '<section class="diagw-section"><div class="diagw-section-heading"><span>02</span><h3>判断原因与下一步</h3></div>'+resultHtml+(!locked?'<button type="button" class="button primary" data-diagw-action="analyze">'+(validAssessment?'重新生成排障结论':'生成排障结论')+'</button>':'')+'</section>'+
    '<section class="diagw-section"><div class="diagw-section-heading"><span>03</span><h3>处理记录与工单</h3></div><p class="diagw-muted">'+(ticket?'工单 '+esc(ticket.id)+' 已关联本轮技能、证据和原因候选。':'诊断记录随工单保存；现场处理与耗材更换由实际负责人确认。')+'</p><div class="diagw-actions">'+(!ticket?'<button type="button" class="button" data-diagw-action="ticket" '+(!validAssessment?'disabled':'')+'>生成工单草稿</button>':'')+(onLocate?'<button type="button" class="button" data-diagw-action="locate">定位三维设备</button>':'')+'<button type="button" class="button" data-diagw-action="running">查看家庭运行</button><button type="button" class="button" data-diagw-action="export">下载排障记录</button></div></section>'+verifyHtml+
    '<details class="diagw-history"><summary>异常与处理记录 · '+run.history.length+' 条</summary>'+(run.history.length?'<ol>'+run.history.slice().reverse().map(h=>'<li><time>'+esc(new Date(h.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}))+'</time><strong>'+esc(h.action)+'</strong><p>'+esc(h.detail)+'</p></li>').join('')+'</ol>':'<p class="diagw-muted">本次尚未记录排障操作。</p>')+'</details>';
  const submit=(next,action,detail)=>onUpdate?.(appendHistory(next,action,detail),action);
  const invalidate=next=>({...next,assessment:null,summary:'',verification:{status:'pending',checks:{}}});
  container.querySelectorAll('[data-diagw-evidence]').forEach(select=>select.onchange=()=>{
    const key=select.dataset.diagwEvidence,f=fields.find(f=>f.key===key),choice=f?.options.find(o=>o.value===select.value);
    if(locked || !choice)return;
    const next=invalidate({...run,evidence:{...run.evidence,[key]:choice.value}});
    submit(next,'核验证据更新',f.label+'：'+choice.label);
  });
  const note=container.querySelector('[data-diagw-note]');
  note.onchange=()=>{if(!locked)submit(invalidate({...run,note:note.value.slice(0,600)}),'补充记录','已更新本次演示核验备注。');};
  container.querySelectorAll('[data-diagw-check]').forEach(select=>select.onchange=()=>{
    if(resolved || !['unknown','passed','failed'].includes(select.value))return;
    const checks={...run.verification.checks,[select.dataset.diagwCheck]:select.value};
    submit({...run,verification:{...run.verification,checks,status:'pending'}},'复验项更新','已录入模拟复验结果，等待提交复验。');
  });
  container.querySelectorAll('[data-diagw-action]').forEach(button=>button.onclick=()=>{
    switch(button.dataset.diagwAction){
      case 'sample':{
        if(locked)return;
        const dimension=eventSkillDimension(event), evidence={...run.evidence,binding:'confirmed',freshness:'fresh'};
        if(event.device==='gateway')Object.assign(evidence,{scope:'shared',heartbeat:'missing'});
        else if(dimension==='consumables')evidence.battery='low';
        else if(dimension==='execution')evidence.receipt='timeout';
        else if(dimension==='security')evidence.alarm='none_reported';
        submit(invalidate({...run,evidence}),'载入演示证据','仅载入该演示事件已提供的信息；现场供电、网络与自检仍待核验。');
        break;
      }
      case 'analyze':{
        if(locked)return;
        const assessment=evaluateDiagnostic(event,run.evidence);
        submit({...run,assessment,summary:assessment.title+'；'+assessment.action},'生成排障结论',assessment.title);
        break;
      }
      case 'ticket':if(validAssessment)onTicket?.();break;
      case 'verify':{
        if(!ticket || resolved)return;
        const status=verificationResult(event,run.verification.checks);
        const next=appendHistory({...run,verification:{...run.verification,status,checkedAt:now()}},'提交模拟复验',vLabels[status]);
        onUpdate?.(next,'提交模拟复验');
        if(status==='passed')onVerify?.();
        break;
      }
      case 'locate':onLocate?.();break;
      case 'running':onRunning?.();break;
      case 'export':onExport?.({schemaVersion:1,exportedAt:now(),mode:'simulation',eventId:event.id,propertyId:event.propertyId,device:event.device,skillRun:run,ticketId:ticket?.id || null});break;
    }
  });
}
