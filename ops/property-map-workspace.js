import { GeographicMap } from './geo-map-viewer.js';

const MODEL_PROPERTY_ID = '810151211';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const string = value => value == null ? '' : String(value).trim();
const districtName = value => string(value).replace(/^北京市/, '').replace(/^(朝阳|海淀|丰台|西城|东城|石景山|昌平|通州|大兴|顺义|房山|门头沟|怀柔|平谷|密云|延庆)区$/, '$1');
const list = value => Array.isArray(value) ? value : Array.isArray(value?.properties) ? value.properties : [];
const finite = value => typeof value === 'number' && Number.isFinite(value);

function safeUrl(value) {
  try {
    const url = new URL(string(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function verifiedPosition(record) {
  const point = record?.coordinate;
  if (record?.coordinateSystem !== 'WGS84' || !['community', 'station_proxy'].includes(record.matchType)) return null;
  if (!Array.isArray(point) || point.length !== 2 || !point.every(finite)) return null;
  if (point[0] < 115 || point[0] > 118 || point[1] < 39 || point[1] > 42) return null;
  return [...point];
}

function businessInfo(record) {
  const business = record?.businessDistrict || {};
  const confirmed = ['confirmed', 'confirmed_existing_detail_read'].includes(business.status) && string(business.name);
  if (confirmed) return { key: `confirmed:${string(business.name)}`, label: `${string(business.name)}（已确认）`, confirmed: true };
  if (string(business.candidate)) return { key: `candidate:${string(business.candidate)}`, label: `${string(business.candidate)}（候选）`, confirmed: false };
  return { key: 'unverified', label: '商圈待核验', confirmed: false };
}

function propertyFacts(property) {
  const area = finite(property.area) && property.area > 0 ? `${property.area}㎡${property.areaScope === 'listed_bedroom' ? '（该卧室）' : ''}` : '面积待核验';
  const layout = string(property.roomLabel) || string(property.layout) || (finite(property.bedrooms) && property.bedrooms > 0 ? `${property.bedrooms}居` : '户型待核验');
  const floor = finite(property.floor) && finite(property.totalFloors) ? `${property.floor}/${property.totalFloors}层` : '';
  return [area, layout, floor].filter(Boolean).join(' · ');
}

/** UI adapter for known listing records, separately verified geography and demo events. */
export class PropertyMapWorkspace {
  constructor(container, {
    properties = [], events = [], geography = {}, sources = {},
    onOpenProperty, onOpenModel, onOpenOperations, onEvent, onViewInventory, onStatus, onActivateMap
  } = {}) {
    this.container = container;
    this.geography = geography || {};
    this.sources = sources || {};
    this.callbacks = { onOpenProperty, onOpenModel, onOpenOperations, onEvent, onViewInventory, onStatus, onActivateMap };
    this.active = true;
    this.selectedId = null;
    this.indices = new Map();
    this.nextIndex = 1;
    this.filters = { district: '', business: '', status: 'all' };
    this.elements = Object.fromEntries([
      'geo-filters', 'geo-district-filter', 'geo-business-filter', 'geo-status-filter', 'geo-property-list',
      'geo-coverage-summary', 'geo-map-status', 'scene-detail', 'scene-breadcrumb',
      'geo-terrain-btn', 'top-view-btn', 'rotate-btn'
    ].map(id => [id, document.getElementById(id)]));
    this.originalTitles = new Map(['geo-terrain-btn', 'top-view-btn', 'rotate-btn'].map(id => [id, this.elements[id]?.title || '']));
    this.listeners = [];
    this.updateData(properties, events);
    this.viewer = new GeographicMap(container, {
      entries: this.entries, sources: this.sources,
      onProperty: id => this.focusProperty(id),
      onStatus: status => this.receiveStatus(status)
    });
    this.visibilityObserver = new IntersectionObserver(records => {
      this.inViewport = records.some(record => record.isIntersecting);
      if (this.inViewport && this.active && this.deferredFocusId) this.applyDeferredFocus();
    });
    this.visibilityObserver.observe(container);
    this.bindControls();
    this.renderFilters();
    this.applyFilters(false);
    this.receiveStatus({ mode: 'pending', text: '正在加载北京公共地图 · 已知房源非全量', terrainEnabled: false, terrainState: 'waiting' });
  }

  updateData(properties, events) {
    this.properties = list(properties);
    this.events = Array.isArray(events) ? events : [];
    const geographyById = new Map(list(this.geography).filter(record => record && typeof record === 'object').map(record => [string(record.id), record]));
    const seen = new Set();
    this.entries = this.properties.flatMap(property => {
      if (!property || typeof property !== 'object') return [];
      const id = string(property.id);
      if (!id || seen.has(id)) return [];
      seen.add(id);
      if (!this.indices.has(id)) this.indices.set(id, this.nextIndex++);
      const geographicRecord = geographyById.get(id) || null;
      const position = verifiedPosition(geographicRecord);
      const business = businessInfo(geographicRecord);
      return [{
        id, name: string(property.name) || '未命名房源',
        district: districtName(property.district) || districtName(geographicRecord?.district) || '区域待核验',
        mapIndex: this.indices.get(id), position,
        matchType: position ? geographicRecord.matchType : 'unmatched',
        hasPending: this.pendingEvents(id).length > 0,
        property, geography: geographicRecord, businessLabel: business.label,
        businessKey: business.key, businessConfirmed: business.confirmed
      }];
    });
  }

  pendingEvents(id) {
    return this.events.filter(event => event && string(event.propertyId) === id && event.status !== 'resolved');
  }

  listen(element, type, handler) {
    if (!element) return;
    element.addEventListener(type, handler);
    this.listeners.push(() => element.removeEventListener(type, handler));
  }

  bindControls() {
    for (const [key, id] of [['district', 'geo-district-filter'], ['business', 'geo-business-filter'], ['status', 'geo-status-filter']]) {
      this.listen(this.elements[id], 'change', event => {
        this.filters[key] = event.target.value;
        if (key === 'district') { this.filters.business = ''; this.renderBusinessFilter(); }
        this.applyFilters(true);
      });
    }
    this.listen(this.elements['geo-property-list'], 'click', event => {
      const button = event.target.closest?.('[data-geo-property-id]');
      if (button && this.elements['geo-property-list'].contains(button)) this.focusProperty(button.dataset.geoPropertyId);
    });
    this.listen(this.elements['scene-detail'], 'click', event => {
      const button = event.target.closest?.('[data-geo-action]');
      if (!button || !this.active) return;
      const entry = this.entries.find(item => item.id === this.selectedId);
      if (button.dataset.geoAction === 'close') { this.closeDetail(); return; }
      if (!entry) return;
      if (button.dataset.geoAction === 'property') this.callbacks.onOpenProperty?.(entry.id);
      if (button.dataset.geoAction === 'operations') this.callbacks.onOpenOperations?.(entry.id);
      if (button.dataset.geoAction === 'model' && this.canOpenModel(entry)) this.callbacks.onOpenModel?.(entry.id);
      if (button.dataset.geoAction === 'inventory') this.callbacks.onViewInventory?.(entry.district);
      if (button.dataset.geoAction === 'event') {
        const item = this.pendingEvents(entry.id).find(item => string(item.id) === button.dataset.geoEventId);
        if (item) this.callbacks.onEvent?.(string(item.id));
      }
    });
    this.listen(this.elements['scene-breadcrumb'], 'click', event => {
      if (this.active && event.target.closest?.('[data-geo-reset]')) this.reset();
    });
  }

  renderFilters() {
    const district = this.elements['geo-district-filter'];
    const names = [...new Set(this.entries.map(entry => entry.district))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    if (!names.includes(this.filters.district)) this.filters.district = '';
    if (district) {
      district.innerHTML = '<option value="">全部区域</option>' + names.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
      district.value = this.filters.district;
    }
    this.renderBusinessFilter();
    if (this.elements['geo-status-filter']) this.elements['geo-status-filter'].value = this.filters.status;
  }

  renderBusinessFilter() {
    const select = this.elements['geo-business-filter'];
    const candidates = this.entries.filter(entry => !this.filters.district || entry.district === this.filters.district);
    const choices = [...new Map(candidates.map(entry => [entry.businessKey, entry])).values()];
    if (!choices.some(entry => entry.businessKey === this.filters.business)) this.filters.business = '';
    if (!select) return;
    const options = confirmed => choices.filter(entry => entry.businessConfirmed === confirmed)
      .sort((a, b) => a.businessLabel.localeCompare(b.businessLabel, 'zh-CN'))
      .map(entry => `<option value="${esc(entry.businessKey)}">${esc(entry.businessLabel)}</option>`).join('');
    const confirmed = options(true), candidatesHtml = options(false);
    select.innerHTML = '<option value="">全部商圈</option>' + (confirmed ? `<optgroup label="已确认商圈">${confirmed}</optgroup>` : '') + (candidatesHtml ? `<optgroup label="候选 / 待核验">${candidatesHtml}</optgroup>` : '');
    select.value = this.filters.business;
  }

  applyFilters(fit = true) {
    this.filteredEntries = this.entries.filter(entry =>
      (!this.filters.district || entry.district === this.filters.district) &&
      (!this.filters.business || entry.businessKey === this.filters.business) &&
      (this.filters.status !== 'pending' || entry.hasPending) &&
      (this.filters.status !== 'unconnected' || !entry.hasPending)
    );
    if (this.selectedId && !this.filteredEntries.some(entry => entry.id === this.selectedId)) this.closeDetail();
    this.viewer?.setEntries(this.filteredEntries);
    this.renderList();
    this.renderCoverage();
    this.renderBreadcrumb();
    if (fit) { this.viewer?.setRotate(false); this.viewer?.fitAll(); this.syncControls(); }
  }

  renderList() {
    const element = this.elements['geo-property-list'];
    if (!element) return;
    element.innerHTML = this.filteredEntries.length ? this.filteredEntries.map(entry => {
      const precision = entry.matchType === 'community' ? '小区参考' : entry.matchType === 'station_proxy' ? '地铁参考 · 非房屋' : '待定位';
      return `<button type="button" class="geo-property-item${entry.id === this.selectedId ? ' is-selected' : ''}" data-geo-property-id="${esc(entry.id)}" aria-pressed="${entry.id === this.selectedId}">
        <span class="geo-property-index">${entry.mapIndex}</span><span class="geo-property-main"><strong>${esc(entry.name)}</strong>
        <span class="geo-property-region" style="display:block">${esc(entry.district)} · ${esc(entry.businessLabel)}</span>
        <span class="geo-property-region" style="display:block">${esc(propertyFacts(entry.property))}</span>
        <span class="geo-property-status"><span class="tag neutral">${precision}</span><span class="tag ${entry.hasPending ? 'amber' : 'neutral'}">${entry.hasPending ? '演示有待办' : '状态未接入'}</span></span>
        </span></button>`;
    }).join('') : `<p class="geo-list-empty">${this.entries.length ? '当前筛选没有房源记录，请调整区域、商圈或状态。' : '当前范围暂无可统计房源。可查看采集状态，或切换历史参考样本查看已有资料。'}</p>`;
  }

  renderCoverage() {
    const element = this.elements['geo-coverage-summary'];
    if (!element) return;
    const community = this.entries.filter(entry => entry.matchType === 'community').length;
    const proxy = this.entries.filter(entry => entry.matchType === 'station_proxy').length;
    const unmatched = this.entries.length - community - proxy;
    element.innerHTML = `已知 ${this.entries.length} 条 · 小区参考 ${community} · 地铁参考 ${proxy} · 待定位 ${unmatched}<br>当前筛选 ${this.filteredEntries.length} 条 · 非北京全量 · 真实设备状态未接入`;
  }

  renderBreadcrumb() {
    if (!this.active || !this.elements['scene-breadcrumb']) return;
    this.elements['scene-breadcrumb'].innerHTML = `<button type="button" class="text-btn" data-geo-reset>北京</button><span class="crumb-divider">/</span><strong>${esc(this.filters.district || '全部区域')}</strong>`;
  }

  canOpenModel(entry) {
    return entry.id === MODEL_PROPERTY_ID && entry.property.imported !== true && entry.property.modelReady === true;
  }

  async focusProperty(value) {
    const id = string(value);
    const entry = this.entries.find(item => item.id === id);
    if (!entry) return false;
    if (!this.active && this.callbacks.onActivateMap) await this.callbacks.onActivateMap();
    if (!this.filteredEntries.some(item => item.id === id)) {
      this.filters = { district: '', business: '', status: 'all' };
      this.renderFilters(); this.applyFilters(false);
    }
    this.selectedId = id;
    this.deferredFocusId = null;
    this.viewer.select(id);
    this.renderList();
    this.renderDetail(entry);
    this.viewer.setRotate(false);
    this.syncControls();
    if (!entry.position) return false;
    this.deferredFocusId = id;
    // Selecting a row outside the map viewport updates the UI without fetching tiles.
    if (this.active && (this.inViewport || this.viewer.inViewport)) return this.applyDeferredFocus();
    return true;
  }

  async applyDeferredFocus() {
    const id = this.deferredFocusId;
    if (!id || !this.active || !(this.inViewport || this.viewer.inViewport)) return false;
    this.deferredFocusId = null;
    try { return await this.viewer.focusProperty(id); }
    catch { return false; }
  }

  renderDetail(entry) {
    const element = this.elements['scene-detail'];
    if (!element || !this.active) return;
    const geographicRecord = entry.geography;
    const osmUrl = safeUrl(geographicRecord?.osm?.objectUrl);
    const businessUrl = safeUrl(geographicRecord?.businessDistrict?.sourceUrl);
    const sourceUrl = safeUrl(entry.property.sourceUrl);
    const pending = this.pendingEvents(entry.id);
    const precision = entry.matchType === 'community' ? '小区参考位置；未定位楼栋、房间或设备。'
      : entry.matchType === 'station_proxy' ? '地铁站代理参考位置；房屋和小区尚未定位。'
      : '尚无经核验的 WGS84 定位；地图不放置推测点。';
    const links = [osmUrl && `<a href="${esc(osmUrl)}" target="_blank" rel="noopener noreferrer">OSM 对象</a>`,
      businessUrl && `<a href="${esc(businessUrl)}" target="_blank" rel="noopener noreferrer">商圈依据</a>`,
      sourceUrl && `<a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">房源来源</a>`].filter(Boolean);
    element.hidden = false;
    element.style.maxHeight = 'calc(100% - 80px)';
    element.style.overflowY = 'auto';
    element.innerHTML = `<button type="button" class="icon-btn close-scene-detail" data-geo-action="close" aria-label="关闭房源地图详情">×</button>
      <h3>${esc(entry.name)}</h3><p>${esc(entry.district)} · ${esc(propertyFacts(entry.property))}</p>
      <p><strong>定位</strong> · ${esc(precision)}<br><strong>商圈</strong> · ${esc(entry.businessLabel)}</p>
      <details><summary style="font-size:13px;cursor:pointer">地址与匹配来源</summary>
        <p>OSM 地址：${esc(geographicRecord?.osm?.displayName || '尚无匹配地址')}<br>${esc(geographicRecord?.matchBasis || '仅有房源列表信息，等待地址核验。')}</p>
        ${geographicRecord?.businessDistrict?.basis ? `<p>${esc(geographicRecord.businessDistrict.basis)}</p>` : ''}
        ${links.length ? `<p style="display:flex;flex-wrap:wrap;gap:10px;color:#fff">${links.join('')}</p>` : ''}
        ${geographicRecord?.reviewedAt ? `<p>定位核验记录：${esc(string(geographicRecord.reviewedAt).slice(0, 10))}</p>` : ''}
      </details>
      <p>${pending.length ? `演示待办 ${pending.length} 条；` : '无未闭环演示待办；'}真实设备状态未接入。</p>
      <div style="display:grid;gap:8px">
        <button type="button" class="button" data-geo-action="operations">查看家庭运行</button>
        <button type="button" class="button" data-geo-action="property">查看房源详情</button>
        ${this.canOpenModel(entry) ? '<button type="button" class="button" data-geo-action="model">进入三维样板</button>' : ''}
        ${pending.map(event => `<button type="button" class="button" data-geo-action="event" data-geo-event-id="${esc(event.id)}">演示事件 · ${esc(event.title || '查看待办')}</button>`).join('')}
        ${this.callbacks.onViewInventory ? '<button type="button" class="button" data-geo-action="inventory">查看该区台账</button>' : ''}
      </div>`;
  }

  closeDetail() {
    this.selectedId = null;
    this.deferredFocusId = null;
    this.viewer?.select(null);
    if (this.active && this.elements['scene-detail']) this.elements['scene-detail'].hidden = true;
    this.renderList();
  }

  receiveStatus(status) {
    this.lastStatus = status;
    const element = this.elements['geo-map-status'];
    if (element) element.textContent = string(status.text) || '公共地图状态待确认';
    this.syncControls();
    this.callbacks.onStatus?.(status);
  }

  syncControls() {
    if (!this.active || this.elements['geo-filters']?.hidden) return;
    const ready3d = this.mode === 'webgl';
    for (const id of ['geo-terrain-btn', 'top-view-btn', 'rotate-btn']) {
      const button = this.elements[id];
      if (!button) continue;
      button.disabled = !ready3d;
      button.title = ready3d ? this.originalTitles.get(id) : this.mode === 'pending' ? '地图加载中' : '当前地图模式不支持三维地形、俯视与旋转';
      const pressed = ready3d && (id === 'geo-terrain-btn' ? this.viewer?.terrainEnabled : id === 'top-view-btn' ? this.topView : this.viewer?.rotating);
      button.setAttribute('aria-pressed', String(Boolean(pressed)));
      button.classList.toggle('active', Boolean(pressed));
    }
  }

  update(properties = this.properties, events = this.events) {
    this.updateData(properties, events);
    this.renderFilters();
    this.applyFilters(false);
    const selected = this.entries.find(entry => entry.id === this.selectedId);
    if (selected) this.renderDetail(selected);
  }

  resize() { this.viewer.resize(); }

  setVisible(visible) {
    this.active = Boolean(visible);
    this.viewer.setVisible(this.active);
    if (this.elements['geo-map-status']) this.elements['geo-map-status'].hidden = !this.active;
    if (this.active) {
      this.renderBreadcrumb(); this.syncControls();
      const selected = this.entries.find(entry => entry.id === this.selectedId);
      if (selected) this.renderDetail(selected);
      if (this.deferredFocusId) this.applyDeferredFocus();
    } else {
      for (const id of ['geo-terrain-btn', 'top-view-btn', 'rotate-btn']) {
        const button = this.elements[id];
        if (button) { button.disabled = false; button.title = this.originalTitles.get(id); }
      }
      const detail = this.elements['scene-detail'];
      if (detail) { detail.hidden = true; detail.style.maxHeight = ''; detail.style.overflowY = ''; }
    }
  }

  reset() {
    this.filters = { district: '', business: '', status: 'all' };
    this.closeDetail(); this.renderFilters(); this.applyFilters(false);
    this.viewer.setRotate(false); this.viewer.reset(); this.syncControls();
  }

  focusDistrict(id) {
    const district = districtName(id);
    this.filters = { district, business: '', status: 'all' };
    const select = this.elements['geo-district-filter'];
    if (select) {
      if (district && !this.entries.some(entry => entry.district === district)) {
        const option = document.createElement('option'); option.value = district; option.textContent = district; select.append(option);
      }
      select.value = district;
    }
    if (this.elements['geo-status-filter']) this.elements['geo-status-filter'].value = 'all';
    this.renderBusinessFilter(); this.closeDetail(); this.applyFilters(true);
  }

  toggleTop() { const result = this.viewer.toggleTop(); this.syncControls(); return result; }
  toggleTerrain() { const result = this.viewer.toggleTerrain(); this.syncControls(); return result; }
  setRotate(active) { const result = this.viewer.setRotate(active); this.syncControls(); return result; }
  get mode() { return this.viewer?.mode || this.lastStatus?.mode || 'pending'; }
  get topView() { return this.viewer?.topView || false; }

  dispose() {
    this.listeners.forEach(remove => remove());
    this.listeners = [];
    this.visibilityObserver.disconnect();
    this.viewer.dispose();
  }
}
