import {
  HOUSEHOLD_SAMPLE_ID, HOUSEHOLD_PERIODS, HOUSEHOLD_DIMENSIONS,
  householdProperties, householdEventDimensions, buildHouseholdModel, answerHouseholdQuestion
} from './household-model.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const list = value => Array.isArray(value) ? value : [];
const records = value => list(value).filter(item => item && typeof item === 'object');
const statusLabel = value => ({ new: '待核验', diagnosing: '诊断演示中', diagnosed: '建议待确认', ticketed: '已有工单草稿', resolved: '演示已复验' }[value] || '待核验');
const propertySourceLabel = property => property?.imported === true || property?.sourceKind === 'imported' ? '本地台账' : ['crawled', 'crawled-history'].includes(property?.sourceKind) ? '公开房源记录' : '历史房源';
let instanceSequence = 0;

/** Four-step household UI. All state and actions are delegated to the existing app. */
export class HouseholdWorkspace {
  constructor(container, { entryContainer = null, properties = [], events = [], tickets = [], onNavigate, onEvent, onModel, onProperty } = {}) {
    if (!container) throw new Error('HouseholdWorkspace requires a container');
    this.container = container;
    this.entryContainer = entryContainer;
    this.callbacks = { onNavigate, onEvent, onModel, onProperty };
    this.properties = householdProperties(properties);
    this.events = records(events);
    this.tickets = records(tickets);
    this.eventStatusSnapshot = new Map(this.events.map(event => [text(event.id), text(event.status)]));
    this.propertyId = this.properties.find(property => property.id === HOUSEHOLD_SAMPLE_ID)?.id || this.properties[0]?.id || '';
    this.period = 'day';
    this.dimensionId = 'connection';
    this.selectedEventId = null;
    this.visible = false;
    this.conversations = new Map();
    this.drafts = new Map();
    this.expandedEvidence = new Set();
    this.changeNotes = new Map();
    this.sequence = 0;
    this.uid = `hh-${++instanceSequence}`;
    this.renderShell();
    this.bind();
    this.render();
    this.setVisible(false);
  }

  get property() { return this.properties.find(property => property.id === this.propertyId) || null; }
  get model() { return buildHouseholdModel({ property: this.property, events: this.events, tickets: this.tickets, period: this.period }); }
  get evidenceKey() { return `${this.propertyId}|${this.dimensionId}|${this.period}`; }

  renderShell() {
    this.container.innerHTML = `<div class="hh-workspace">
      <header class="hh-toolbar">
        <div class="hh-heading"><span class="hh-eyebrow">家庭入口 / 运行看板 / 运行详情 / 问题承接</span><h2 class="hh-entry-title" data-hh-ref="title">家庭运行</h2><p class="hh-muted" data-hh-ref="subtitle"></p></div>
        <div class="hh-filters"><label class="hh-field" for="${this.uid}-property"><span>历史房源 / 演示台账</span><select id="${this.uid}-property" data-hh-ref="propertySelect" aria-label="选择历史房源或演示台账，不代表当前在租库存"></select></label><div class="hh-field"><span id="${this.uid}-period-label">统计窗口</span><div class="hh-period-switch" role="group" aria-labelledby="${this.uid}-period-label" data-hh-ref="periods"></div></div></div>
      </header>
      <div class="hh-layout">
        <div class="hh-main">
          <section class="hh-scope-note" data-hh-ref="scope" aria-label="数据范围"></section>
          <p class="hh-muted" data-hh-ref="changeNote" role="status" aria-live="polite" hidden></p>
          <section class="hh-dimensions" data-hh-ref="dimensions" aria-label="六个家庭运行维度"></section>
          <section class="hh-detail" data-hh-ref="detail" aria-labelledby="${this.uid}-detail-title"></section>
          <section class="hh-todos" data-hh-ref="todos" aria-labelledby="${this.uid}-todos-title"></section>
        </div>
        <aside class="hh-assistant" aria-labelledby="${this.uid}-assistant-title">
          <header class="hh-assistant-head"><span class="hh-eyebrow">灵之百晓生</span><h3 id="${this.uid}-assistant-title">有疑问，问管家</h3><span class="hh-badge" data-tone="neutral">演示问答 · 本地规则</span><p class="hh-muted">带着当前房源、运行维度和待办一起问。</p></header>
          <div class="hh-assistant-context" data-hh-ref="context"></div>
          <div class="hh-quick-questions" role="group" aria-label="快捷问题"><button type="button" class="hh-button" data-hh-action="quick" data-question="为什么异常？">为什么异常</button><button type="button" class="hh-button" data-hh-action="quick" data-question="怎么办？">怎么办</button><button type="button" class="hh-button" data-hh-action="quick" data-question="以前处理过吗？">以前处理过吗</button></div>
          <div class="hh-conversation" data-hh-ref="conversation" role="log" aria-label="演示问答记录" aria-live="polite" aria-relevant="additions text" tabindex="0"></div>
          <form class="hh-chat-form" data-hh-ref="chatForm"><label class="hh-sr-only" for="${this.uid}-question">输入家庭运行问题</label><textarea id="${this.uid}-question" data-hh-ref="question" rows="3" maxlength="600" placeholder="例如：网关为什么没有心跳？" aria-describedby="${this.uid}-chat-note"></textarea><button type="submit" class="hh-button hh-button-primary">问管家</button></form>
          <p class="hh-chat-note" id="${this.uid}-chat-note">未连接大模型或真实设备。回答保留提问时的上下文；当前状态以看板为准。</p><p class="hh-muted" data-hh-ref="composerStatus" role="status" aria-live="polite"></p>
        </aside>
      </div>
    </div>`;
    this.elements = Object.fromEntries([...this.container.querySelectorAll('[data-hh-ref]')].map(element => [element.dataset.hhRef, element]));
  }

  bind() {
    this.container.addEventListener('click', event => {
      const button = event.target.closest?.('[data-hh-action]');
      if (!button || !this.container.contains(button) || button.disabled) return;
      const action = button.dataset.hhAction;
      if (action === 'period' && HOUSEHOLD_PERIODS[button.dataset.period]) {
        this.period = button.dataset.period;
        this.render();
      } else if (action === 'dimension') {
        this.selectDimension(button.dataset.dimension);
      } else if (action === 'event') {
        if (this.model.allEvents.some(item => text(item.id) === button.dataset.eventId)) this.callbacks.onEvent?.(button.dataset.eventId);
      } else if (action === 'ask-event') {
        this.askAboutEvent(button.dataset.eventId);
      } else if (action === 'model') {
        const model = this.model;
        const deviceId = button.dataset.deviceId || undefined;
        if (model.canModel && (!deviceId || model.currentDevices.some(device => device.id === deviceId))) this.callbacks.onModel?.(model.propertyId, deviceId);
      } else if (action === 'property') {
        if (this.property) this.callbacks.onProperty?.(this.propertyId);
      } else if (action === 'quick') {
        this.ask(button.dataset.question || '', { clearInput: false });
      }
    });
    this.elements.propertySelect.addEventListener('change', event => this.selectProperty(event.target.value));
    this.elements.question.addEventListener('input', () => this.drafts.set(this.propertyId, this.elements.question.value));
    this.elements.chatForm.addEventListener('submit', event => {
      event.preventDefault();
      this.ask(this.elements.question.value, { clearInput: true });
    });
    this.container.addEventListener('toggle', event => {
      if (!event.target.matches?.('[data-hh-evidence]')) return;
      const key = event.target.dataset.hhEvidence;
      if (event.target.open) this.expandedEvidence.add(key); else this.expandedEvidence.delete(key);
    }, true);
    this.entryContainer?.addEventListener('click', event => {
      const button = event.target.closest?.('[data-hh-entry-action]');
      if (!button || !this.entryContainer.contains(button)) return;
      const id = button.dataset.propertyId;
      if (!this.properties.some(property => property.id === id)) return;
      const options = { ask: button.dataset.hhEntryAction === 'ask' };
      if (this.callbacks.onNavigate) this.callbacks.onNavigate(id, options);
      else this.open(id, options);
    });
  }

  update({ properties, events, tickets } = {}) {
    const previousEvents = this.eventStatusSnapshot;
    if (properties !== undefined) this.properties = householdProperties(properties);
    if (events !== undefined) this.events = records(events);
    if (tickets !== undefined) this.tickets = records(tickets);
    for (const event of this.events) {
      const oldStatus = previousEvents.get(text(event.id));
      if (oldStatus && oldStatus !== event.status) {
        if (event.status === 'resolved') this.changeNotes.set(text(event.propertyId), `「${text(event.title)}」已完成本地模拟复验，待办已移除。历史演示窗口保持原值；真实设备状态未变。`);
        else if (oldStatus === 'resolved') this.changeNotes.set(text(event.propertyId), '该房源演示事件已重置或更新，当前待办重新计算；历史演示窗口与既有问答没有被改写。');
      }
    }
    this.eventStatusSnapshot = new Map(this.events.map(event => [text(event.id), text(event.status)]));
    if (!this.properties.some(property => property.id === this.propertyId)) {
      this.storeDraft();
      this.propertyId = this.properties.find(property => property.id === HOUSEHOLD_SAMPLE_ID)?.id || this.properties[0]?.id || '';
      this.selectedEventId = null;
      this.elements.question.value = this.drafts.get(this.propertyId) || '';
    }
    if (this.selectedEventId && !this.model.allEvents.some(event => text(event.id) === this.selectedEventId)) this.selectedEventId = null;
    this.render();
  }

  open(propertyId = HOUSEHOLD_SAMPLE_ID, { ask = false } = {}) {
    const id = text(propertyId);
    if (!this.properties.some(property => property.id === id)) return false;
    this.setVisible(true);
    this.selectProperty(id);
    if (ask) this.focusQuestion();
    return true;
  }

  setVisible(visible) {
    this.visible = !!visible;
    this.container.hidden = !this.visible;
  }

  storeDraft() { this.drafts.set(this.propertyId, this.elements.question.value); }

  selectProperty(id) {
    if (!this.properties.some(property => property.id === id)) return;
    if (id !== this.propertyId) {
      this.storeDraft();
      this.propertyId = id;
      this.selectedEventId = null;
      this.elements.question.value = this.drafts.get(id) || '';
      this.elements.composerStatus.textContent = '';
    }
    this.render();
  }

  selectDimension(id) {
    if (!HOUSEHOLD_DIMENSIONS.some(dimension => dimension.id === id)) return;
    this.dimensionId = id;
    const selected = this.model.allEvents.find(event => text(event.id) === this.selectedEventId);
    if (selected && !householdEventDimensions(selected).includes(id)) this.selectedEventId = null;
    this.render();
  }

  preserveFocus(operation) {
    const active = document.activeElement;
    const key = this.container.contains(active) ? active?.dataset?.hhFocus : null;
    operation();
    if (key && !active.isConnected) [...this.container.querySelectorAll('[data-hh-focus]')].find(element => element.dataset.hhFocus === key)?.focus({ preventScroll: true });
  }

  render() {
    const model = this.model;
    const dimension = model.dimensions.find(item => item.id === this.dimensionId) || model.dimensions[0];
    this.preserveFocus(() => {
      this.renderToolbar(model);
      this.renderScope(model);
      this.renderDimensions(model);
      this.renderDetail(model, dimension);
      this.renderTodos(model);
      this.renderContext(model, dimension);
    });
    this.renderEntry();
    this.renderConversation();
    this.refreshConversationActions();
  }

  renderToolbar(model) {
    this.elements.title.textContent = this.property ? `${this.property.name} · 家庭运行` : '家庭运行';
    this.elements.subtitle.textContent = this.property ? `${propertySourceLabel(this.property)} · 演示运行数据 · ${text(this.property.district) || '区域待核验'} · ${model.hasSample ? '7 台设备演示样板' : '完整遥测未接入'} · ${model.pendingEvents.length} 条演示待办` : '当前没有可选择的房源。';
    const signature = JSON.stringify(this.properties.map(property => [property.id, property.name, property.district, propertySourceLabel(property)]));
    if (signature !== this.propertyOptionsSignature) {
      this.elements.propertySelect.innerHTML = this.properties.length ? this.properties.map(property => `<option value="${esc(property.id)}">${esc(property.name)} · ${esc(propertySourceLabel(property))}${property.district ? ` / ${esc(property.district)}` : ''}</option>`).join('') : '<option value="">暂无房源</option>';
      this.propertyOptionsSignature = signature;
    }
    this.elements.propertySelect.value = this.propertyId;
    this.elements.propertySelect.disabled = !this.properties.length;
    this.elements.periods.innerHTML = Object.entries(HOUSEHOLD_PERIODS).map(([id, period]) => `<button type="button" data-hh-action="period" data-period="${id}" data-hh-focus="period-${id}" aria-pressed="${this.period === id}"${!this.property ? ' disabled' : ''}>${period.label}</button>`).join('');
    this.elements.question.disabled = !this.property;
    this.elements.chatForm.querySelector('button').disabled = !this.property;
  }

  renderScope(model) {
    const note = model.hasSample
      ? `<strong>${esc(propertySourceLabel(this.property))} · 固定演示运行数据</strong><p>${esc(model.aggregate.rangeLabel)} · 固定演示窗口。当前快照：${model.current.online}/7 台有在线确认、${model.current.unknown} 台待核验；未知不按离线统计。不是实际房源遥测或当前在租核验。</p><p class="hh-muted">${model.current.simulatedVerification ? '网关与两台关联设备叠加了本地模拟复验结果；历史率不变。' : `${esc(model.current.snapshotAt)}；没有生产心跳接入。`}</p>`
      : `<strong>${esc(propertySourceLabel(this.property))} · 完整遥测未接入</strong><p>仅承接当前事件列表中的 ${model.pendingEvents.length} 条演示待办。设备总数、六维指标与${HOUSEHOLD_PERIODS[this.period].label}窗口数据均未知，不复制样板房设备或推算健康率；不代表当前在租库存。</p>`;
    this.elements.scope.innerHTML = `${note}<div class="hh-entry-actions">${this.property ? '<button type="button" class="hh-button" data-hh-action="property" data-hh-focus="property-info">查看房源资料</button>' : ''}${model.canModel ? '<button type="button" class="hh-button" data-hh-action="model" data-hh-focus="property-model">查看三维样板</button>' : '<span class="hh-muted">三维参考未提供</span>'}</div>`;
    const change = this.changeNotes.get(this.propertyId) || '';
    this.elements.changeNote.textContent = change;
    this.elements.changeNote.hidden = !change;
  }

  renderDimensions(model) {
    this.elements.dimensions.innerHTML = model.dimensions.map(dimension => `<button type="button" class="hh-dimension-card" data-hh-action="dimension" data-dimension="${dimension.id}" data-hh-focus="dimension-${dimension.id}" data-tone="${dimension.tone}" aria-pressed="${this.dimensionId === dimension.id}" aria-controls="${this.uid}-detail-title"><span class="hh-dimension-label">${esc(dimension.label)}<small>${esc(dimension.subtitle)}</small></span><strong class="hh-dimension-value">${esc(dimension.value)}</strong><span class="hh-dimension-meta">${esc(dimension.meta)}</span></button>`).join('');
  }

  deviceMetrics(device, dimensionId) {
    if (dimensionId === 'connection') {
      const c = device.connection;
      return `窗口 ${c.online}/${c.online + c.offline} 在线/有效小时 · 确认离线 ${c.offline} · 缺失 ${c.unknown}`;
    }
    if (dimensionId === 'execution' || dimensionId === 'usage') {
      const c = device.commands;
      return c ? `窗口 ${c.requested} 次请求 · ${c.confirmed} 次确认 · ${c.timeout} 次超时 · ${c.unknown} 次未知` : '未纳入操作请求统计';
    }
    if (dimensionId === 'security') {
      const s = device.selfChecks;
      return s ? `窗口自检 ${s.confirmed}/${s.expected} 次通过回执 · ${s.unknown} 次未知` : '关联安防设备；未纳入两传感器自检分母';
    }
    if (dimensionId === 'consumables') {
      const b = device.batterySamples;
      const current = Number.isFinite(device.current?.battery) ? `${device.current.battery}%（快照）` : '未知';
      return b ? `当前电量 ${current} · 窗口 ${b.received}/${b.expected} 条读数${b.lastDate ? ` · 最近归档 ${b.lastValue}% / ${b.lastDate}` : ''}` : '没有电池采样口径';
    }
    return '演示联动参与设备 · 每一步结果须单独核验';
  }

  renderDetail(model, dimension) {
    const devices = dimension.devices.length ? `<div class="hh-device-list" role="list">${dimension.devices.map(device => {
      const current = device.current;
      const label = current?.isSimulatedVerification ? '模拟复验：在线' : current?.status === 'online' ? '快照：在线' : '未上报 · 待核验';
      return `<article class="hh-device-row" role="listitem"><div class="hh-device-main"><strong>${esc(device.name)}</strong><span class="hh-muted">${esc(device.room)} · ${esc(device.id)}</span><p class="hh-device-metrics">${esc(this.deviceMetrics(device, dimension.id))}</p></div><div class="hh-device-status"><span class="hh-badge" data-tone="${current?.status === 'online' ? 'good' : 'warning'}">${label}</span></div>${model.canModel ? `<div class="hh-device-actions"><button type="button" class="hh-button" data-hh-action="model" data-device-id="${esc(device.id)}" data-hh-focus="model-${esc(device.id)}" aria-label="在三维样板中定位${esc(device.name)}">定位设备</button></div>` : ''}</article>`;
    }).join('')}</div>` : '<div class="hh-empty"><strong>设备台账尚未接入</strong><p>单条演示待办中的设备名不是该房源的完整设备列表。</p></div>';
    const rules = dimension.rules.length ? `<div class="hh-device-list" aria-label="演示规则结果">${dimension.rules.map(rule => `<div class="hh-device-row"><div class="hh-device-main"><strong>${esc(rule.name)}</strong><span class="hh-muted">${rule.triggered} 次触发 · ${rule.confirmed} 次确认 · ${rule.failed} 次记录失败 · ${rule.unknown} 次未知</span></div></div>`).join('')}</div>` : '';
    this.elements.detail.innerHTML = `<header class="hh-section-head"><div><span class="hh-eyebrow">运行详情</span><h3 id="${this.uid}-detail-title">${esc(dimension.label)} · ${esc(dimension.subtitle)}</h3></div><span class="hh-badge" data-tone="${dimension.tone}">${model.hasSample ? '固定演示数据' : '数据待接入'}</span></header><p class="hh-muted">${esc(dimension.summary)}</p><div class="hh-stat-grid">${dimension.stats.map(stat => `<div class="hh-stat"><span>${esc(stat.label)}</span><strong>${esc(stat.value)}</strong><small>${esc(stat.meta)}</small></div>`).join('')}</div>${rules}${devices}<details class="hh-evidence" data-hh-evidence="${esc(this.evidenceKey)}"${this.expandedEvidence.has(this.evidenceKey) ? ' open' : ''}><summary data-hh-focus="evidence-toggle">口径、采样来源与待核验证据</summary><p><strong>指标口径：</strong>${esc(dimension.formula)}</p><p><strong>采样来源：</strong>${esc(dimension.source)}</p><p><strong>统计窗口：</strong>${esc(dimension.windowLabel)}</p>${model.hasSample ? `<p>本窗口包含 ${model.aggregate.days} 个逐日演示归档；每个设备每天预期 24 个小时状态位置。归档 ID：${esc(model.aggregate.archiveIds[0])}${model.aggregate.days > 1 ? ` 至 ${esc(model.aggregate.archiveIds.at(-1))}` : ''}。这些是人工编写的固定场景，不是后台真实采集。</p>` : ''}<strong>仍需核验</strong><ul>${dimension.evidenceNeeded.map(item => `<li>${esc(item)}</li>`).join('')}</ul></details>`;
  }

  renderTodos(model) {
    this.elements.todos.innerHTML = `<header class="hh-section-head"><div><span class="hh-eyebrow">问题承接</span><h3 id="${this.uid}-todos-title">当前家庭待办 <span class="hh-badge" data-tone="${model.pendingEvents.length ? 'warning' : 'neutral'}">${model.pendingEvents.length} 条</span></h3></div><span class="hh-muted">来自现有演示事件</span></header>${model.pendingEvents.length ? `<div class="hh-todo-list">${model.pendingEvents.map(event => {
      const dimensions = householdEventDimensions(event).map(id => HOUSEHOLD_DIMENSIONS.find(dimension => dimension.id === id)?.label).filter(Boolean);
      return `<article class="hh-todo"><div class="hh-todo-main"><div><span class="hh-badge" data-tone="warning">${esc(event.priority || '待核验')}</span><strong>${esc(event.title)}</strong></div><p>${esc(event.summary)}</p><span class="hh-muted">${esc(dimensions.join(' / ') || '维度待核验')} · ${esc(statusLabel(event.status))} · ${esc(event.id)}</span></div><div class="hh-todo-actions"><button type="button" class="hh-button hh-button-primary" data-hh-action="event" data-event-id="${esc(event.id)}" data-hh-focus="event-${esc(event.id)}">打开待办</button><button type="button" class="hh-button" data-hh-action="ask-event" data-event-id="${esc(event.id)}" data-hh-focus="ask-${esc(event.id)}">问管家</button></div></article>`;
    }).join('')}</div>` : `<div class="hh-empty"><strong>当前没有未解决的演示待办</strong><p>${model.allEvents.some(event => event.status === 'resolved') ? '已复验事项移出待办；可在管家中询问已有演示记录。' : '这只表示现有事件列表为空，不代表全户运行正常。'}</p></div>`}<p class="hh-muted">不新建实际工单；打开待办后沿用现有诊断、草稿和模拟复验流程。</p>`;
  }

  renderContext(model, dimension) {
    const selected = model.allEvents.find(event => text(event.id) === this.selectedEventId);
    const activeEvent = selected || dimension.pendingEvents[0] || dimension.relatedEvents[0] || null;
    this.elements.context.innerHTML = `<strong>${esc(this.property?.name || '未选择房源')}</strong><span>${esc(dimension.label)} · ${HOUSEHOLD_PERIODS[this.period].label}窗口${model.hasSample ? '（演示归档）' : '（未接入）'}</span><p>${activeEvent ? `${esc(activeEvent.title)} · ${esc(statusLabel(activeEvent.status))}` : '没有该维度的关联待办，保留未知事实。'}</p>`;
  }

  renderEntry() {
    if (!this.entryContainer) return;
    const property = this.properties.find(item => item.id === HOUSEHOLD_SAMPLE_ID) || this.properties[0];
    if (!property) {
      this.entryContainer.innerHTML = '<div class="hh-entry hh-empty"><h3>家庭运行</h3><p>加载已知房源后，可进入运行看板与演示管家。</p></div>';
      return;
    }
    const model = buildHouseholdModel({ property, events: this.events, tickets: this.tickets, period: 'day' });
    this.entryContainer.innerHTML = `<article class="hh-entry"><div class="hh-entry-heading"><div><span class="hh-eyebrow">一个家庭入口 · 看运行，也问办法</span><h3 class="hh-entry-title">${esc(property.name)}</h3><p class="hh-entry-summary">${esc(propertySourceLabel(property))} · 演示运行数据<br>${model.hasSample ? `7 台设备演示样板 · 当前 ${model.current.online} 台有在线确认，${model.current.unknown} 台待核验${model.current.simulatedVerification ? '（含模拟复验）' : ''}` : '全户遥测未接入 · 仅承接已有演示待办'}</p></div><div class="hh-entry-count"><strong>${model.pendingEvents.length}</strong><span>条演示待办</span></div></div><div class="hh-entry-dimensions" aria-label="六维运行摘要">${model.dimensions.map(dimension => `<div class="hh-entry-dimension" data-tone="${dimension.tone}"><span>${esc(dimension.label)}</span><strong>${esc(dimension.value)}</strong></div>`).join('')}</div><p class="hh-muted">${model.hasSample ? '六维摘要来自固定日窗口；不是实时健康评分或当前在租库存。先看状态，再核验证据。' : '没有记录的维度保持未知，不推算整户状态。'}</p><div class="hh-entry-actions"><button type="button" class="hh-button hh-button-primary" data-hh-entry-action="open" data-property-id="${esc(property.id)}">查看家庭运行</button><button type="button" class="hh-button" data-hh-entry-action="ask" data-property-id="${esc(property.id)}">问管家</button></div></article>`;
  }

  conversation() {
    if (!this.conversations.has(this.propertyId)) this.conversations.set(this.propertyId, [{
      id: `welcome-${this.propertyId}`, role: 'assistant', welcome: true,
      text: '我是灵之百晓生的演示管家。可以结合当前房源、运行维度与已有待办说明原因候选、核验步骤和处理记录。没有证据的地方会保留未知；不会执行设备操作。'
    }]);
    return this.conversations.get(this.propertyId);
  }

  messageHtml(message) {
    if (message.role === 'user') return `<article class="hh-message" data-role="user"><span class="hh-message-context">你 · ${esc(message.context.propertyName)} · ${esc(message.context.dimensionLabel)} / ${esc(message.context.periodLabel)}窗口</span><p>${esc(message.text)}</p></article>`;
    if (message.welcome) return `<article class="hh-message" data-role="assistant"><span class="hh-message-context">灵之百晓生 · 演示问答</span><p>${esc(message.text)}</p></article>`;
    const answer = message.answer;
    return `<article class="hh-message" data-role="assistant"><span class="hh-message-context">提问时上下文：${esc(answer.context.propertyName)} · ${esc(answer.context.dimensionLabel)} / ${esc(answer.context.periodLabel)}窗口${answer.context.eventId ? ` · ${esc(answer.context.eventId)}` : ''}</span>${answer.sections.map(section => `<section class="hh-answer-block"><h4>${esc(section.title)}</h4><p>${esc(section.text)}</p></section>`).join('')}<div class="hh-entry-actions">${answer.actions.map(action => action.type === 'event' ? `<button type="button" class="hh-button" data-hh-action="event" data-event-id="${esc(action.id)}">${esc(action.label)}</button>` : `<button type="button" class="hh-button" data-hh-action="dimension" data-dimension="${esc(action.id)}">${esc(action.label)}</button>`).join('')}</div><p class="hh-chat-note">${esc(answer.sourceNote)}</p></article>`;
  }

  renderConversation() {
    const messages = this.conversation();
    if (this.renderedConversationId !== this.propertyId) {
      this.elements.conversation.innerHTML = '';
      this.renderedConversationId = this.propertyId;
      this.renderedMessageCount = 0;
    }
    const newMessages = messages.slice(this.renderedMessageCount || 0);
    if (newMessages.length) this.elements.conversation.insertAdjacentHTML('beforeend', newMessages.map(message => this.messageHtml(message)).join(''));
    this.renderedMessageCount = messages.length;
  }

  refreshConversationActions() {
    for (const button of this.elements.conversation.querySelectorAll('[data-event-id]')) {
      const event = this.model.allEvents.find(item => text(item.id) === button.dataset.eventId);
      button.disabled = !event;
      button.textContent = !event ? '该事件已不在当前列表' : event.status === 'resolved' ? '查看演示复验记录' : '打开关联待办';
    }
  }

  askAboutEvent(id) {
    const event = this.model.allEvents.find(item => text(item.id) === id);
    if (!event) return;
    this.selectedEventId = id;
    const dimensions = householdEventDimensions(event);
    if (!dimensions.includes(this.dimensionId) && dimensions[0]) this.dimensionId = dimensions[0];
    this.render();
    if (!this.elements.question.value.trim()) {
      this.elements.question.value = `这项「${text(event.title)}」为什么异常？`;
      this.storeDraft();
    }
    this.focusQuestion();
  }

  ask(question, { clearInput = true } = {}) {
    const input = text(question).trim().slice(0, 600);
    if (!this.property || !input) {
      this.elements.composerStatus.textContent = this.property ? '请输入一个运行问题，或选择快捷问题。' : '请先选择已知房源。';
      return false;
    }
    const model = this.model;
    const answer = answerHouseholdQuestion({ model, dimensionId: this.dimensionId, eventId: this.selectedEventId, question: input });
    const messages = this.conversation();
    messages.push({ id: `question-${++this.sequence}`, role: 'user', text: input, context: answer.context });
    messages.push({ id: `answer-${++this.sequence}`, role: 'assistant', answer });
    if (clearInput) {
      this.elements.question.value = '';
      this.drafts.set(this.propertyId, '');
    } else this.storeDraft();
    this.renderConversation();
    this.refreshConversationActions();
    this.elements.composerStatus.textContent = '演示回答已生成，没有执行设备操作或创建实际工单。';
    requestAnimationFrame(() => { this.elements.conversation.scrollTop = this.elements.conversation.scrollHeight; });
    return true;
  }

  focusQuestion() {
    requestAnimationFrame(() => {
      if (!this.visible) return;
      this.elements.question.focus({ preventScroll: true });
      this.elements.question.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    });
  }
}
