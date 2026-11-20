import { GeographicMap } from './geo-map-viewer.js';
import { mapGroupKeys, mapGroups, combineMapPoints } from './map-hierarchy.js';
import { buildDeviceConfiguration, CONFIG_PROFILES } from './device-configuration.js';

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
  return { key: 'unverified', label: '商圈待核验', confirmed: false };
}

function positionLabel(entry) {
  if (entry.matchType === 'station_proxy') return '地铁参考';
  if (entry.matchType !== 'community') return '待定位';
  return entry.geography?.precision === 'city_registered_community_estimate' ? '官网小区 · 市域配准估算'
    : entry.geography?.precision === 'registered_community_estimate' ? '官网小区 · 邻域配准估算'
    : entry.geography?.precision === 'osm_residential_reference' ? 'OSM 住宅参考点' : '小区参考';
}

function propertyFacts(property) {
  const area = finite(property.area) && property.area > 0 ? `${property.area}㎡${property.areaScope === 'listed_bedroom' ? '（该卧室）' : ''}` : '面积待核验';
  const layout = string(property.layout) || (finite(property.bedrooms) && property.bedrooms > 0 ? `${property.bedrooms}居` : '');
  const room = string(property.roomLabel);
  const floor = finite(property.floor) ? (finite(property.totalFloors) ? `${property.floor}/${property.totalFloors}层` : `${property.floor}层`) : '';
  return [area,layout || (room?'':'户型待核验'),room!==layout?room:'',floor].filter(Boolean).join(' · ');
}

function devicePlan(property, profile) {
  const config = buildDeviceConfiguration(property, {profile});
  const rows = new Map();
  for (const device of config.devices) {
    const row = rows.get(device.catalogId) || {name:device.name, rooms:new Set(), quantity:0};
    row.rooms.add(device.roomName);
    row.quantity += device.quantity;
    rows.set(device.catalogId, row);
  }
  const label = CONFIG_PROFILES.find(option => option.id === profile)?.label || '基础智能';
  const items = [...rows.values()].map(row => `<tr><th scope="row">${esc(row.name)}</th><td>${esc([...row.rooms].join('、'))}</td><td>${row.quantity}</td></tr>`).join('');
  return `<h4>设备配置</h4><p>${esc(label)} · 规划 ${config.summary.plannedDeviceCount} 件 · 实装待核验</p>${items
    ? `<table><thead><tr><th scope="col">设备</th><th scope="col">规划房间</th><th scope="col">数量</th></tr></thead><tbody>${items}</tbody></table>`
    : '<p>设备数量待补充本套房源资料后核定。</p>'}`;
}

/** UI adapter for known listing records, separately verified geography and demo events. */
export class PropertyMapWorkspace {
  constructor(container, {
    properties = [], events = [], geography = {}, sources = {},
    onOpenProperty, onOpenModel, onOpenPlan, onClosePlan, onOpenOperations, onEvent, onViewInventory, onStatus, onActivateMap
  } = {}) {
    this.container = container;
    this.geography = geography || {};
    this.sources = sources || {};
    this.callbacks = { onOpenProperty, onOpenModel, onOpenPlan, onClosePlan, onOpenOperations, onEvent, onViewInventory, onStatus, onActivateMap };
    this.active = true;
    this.communityKey = '';
    this.selectedId = null;
    this.planProfile = 'base';
    this.indices = new Map();
    this.nextIndex = 1;
    this.filters = { district: '', business: '', status: 'all' };
    this.elements = Object.fromEntries([
      'geo-filters', 'geo-district-filter', 'geo-business-filter', 'geo-status-filter', 'geo-property-list',
      'geo-coverage-summary', 'geo-panel-title', 'geo-monitor-summary', 'geo-map-status', 'scene-detail', 'scene-breadcrumb',
      'geo-terrain-btn', 'top-view-btn', 'rotate-btn'
    ].map(id => [id, document.getElementById(id)]));
    this.originalTitles = new Map(['geo-terrain-btn', 'top-view-btn', 'rotate-btn'].map(id => [id, this.elements[id]?.title || '']));
    this.listeners = [];
    this.mapCard=document.createElement('section');
    this.mapCard.id='geo-listing-card';
    this.mapCard.className='geo-listing-card';
    this.mapCard.hidden=true;
    this.mapCard.setAttribute('aria-label','地图房源');
    this.container.append(this.mapCard);
    this.updateData(properties, events);
    this.viewer = new GeographicMap(container, {
      entries: [], sources: this.sources,
      onProperty: pin => this.openMarker(pin),
      onNearby: pins => this.chooseListings(pins.flatMap(pin => pin.members || [pin])),
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
    const knownCommunities = new Map();
    for (const property of this.properties) {
      if (!property) continue;
      const geographic = geographyById.get(string(property.id));
      const code = string(geographic?.communityId || property.communityId);
      if (!code) continue;
      const district = districtName(property.district) || districtName(geographic?.district) || '区域待核验';
      const key = JSON.stringify([district, string(property.name)]);
      if (!knownCommunities.has(key)) knownCommunities.set(key, new Set());
      knownCommunities.get(key).add(code);
    }
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
      const district = districtName(property.district) || districtName(geographicRecord?.district) || '区域待核验';
      const name = string(property.name) || '小区待核验';
      const possible = knownCommunities.get(JSON.stringify([district, name]));
      const code = string(geographicRecord?.communityId || property.communityId) || (possible?.size === 1 ? [...possible][0] : '');
      const keys = mapGroupKeys(district, business.key, code || name);
      const seenEvents = new Set();
      const pending = this.pendingEvents(id).filter(event => {
        const eventId = string(event.id);
        if (!eventId) return true;
        if (seenEvents.has(eventId)) return false;
        seenEvents.add(eventId);
        return true;
      });
      const pendingP1Count = pending.filter(event => event.priority === 'P1').length;
      const pendingP2Count = pending.filter(event => event.priority === 'P2').length;
      return [{
        id, name, district, ...keys,
        mapIndex: this.indices.get(id), position,
        matchType: position ? geographicRecord.matchType : 'unmatched',
        hasPending: pending.length > 0,
        pendingCount: pending.length, pendingP1Count, pendingP2Count,
        priority: pendingP1Count > 0 ? 'P1' : pendingP2Count > 0 ? 'P2' : null,
        property, geography: geographicRecord, businessLabel: business.label,
        businessConfirmed: business.confirmed
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
        if (key !== 'status') this.communityKey = '';
        this.closeDetail();
        if (key === 'district') { this.filters.business = ''; this.renderBusinessFilter(); }
        this.applyFilters(true);
      });
    }
    this.listen(this.elements['geo-property-list'], 'click', event => {
      const group = event.target.closest?.('[data-geo-group]');
      if (group) { this.openGroup(group.dataset.geoGroup); return; }
      const button = event.target.closest?.('[data-geo-property-id]');
      if (button && this.elements['geo-property-list'].contains(button)) this.focusProperty(button.dataset.geoPropertyId);
    });
    const list = this.elements['geo-property-list'];
    const highlight = event => {
      const control = event.target.closest?.('[data-geo-group],[data-geo-property-id]');
      if (control) this.viewer.select(this.selectedPin(control.dataset.geoGroup || control.dataset.geoPropertyId)?.id || null);
    };
    for (const event of ['pointerover','focusin']) this.listen(list, event, highlight);
    const restore = () => this.viewer.select(this.selectedPin(this.selectedId)?.id || null,this.selectedId);
    this.listen(list, 'pointerleave', restore);
    this.listen(list, 'focusout', event => { if (!list.contains(event.relatedTarget)) restore(); });
    this.listen(this.mapCard,'click',event=>{
      const button=event.target.closest('button');
      if(!button || !this.active)return;
      if(button.dataset.geoPick) {
        this.focusProperty(button.dataset.geoPick,{reveal:false});
      } else if(button.dataset.geoMapGroup) {
        this.openMarker(this.groups.find(group=>group.id===button.dataset.geoMapGroup));
      } else if(button.hasAttribute('data-geo-card-close')) {
        this.dismissCard();
      } else if(button.hasAttribute('data-geo-card-detail')) {
        this.revealDetail();
      } else if(button.hasAttribute('data-geo-card-siblings')) {
        this.chooseListings(this.filteredEntries);
      } else if(button.hasAttribute('data-geo-card-city')) {
        this.reset();
        this.elements['scene-breadcrumb']?.querySelector('[data-geo-crumb=city]')?.focus({preventScroll:true});
      }
    });
    this.listen(this.mapCard,'keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();this.dismissCard();}
    });
    this.listen(this.elements['scene-detail'], 'click', event => {
      const button = event.target.closest?.('[data-geo-action]');
      if (!button || !this.active) return;
      const entry = this.entries.find(item => item.id === this.selectedId);
      if (button.dataset.geoAction === 'close') { this.closeDetail(); return; }
      if (!entry) return;
      if (button.dataset.geoAction === 'property') this.callbacks.onOpenProperty?.(entry.id);
      if (button.dataset.geoAction === 'operations') this.callbacks.onOpenOperations?.(entry.id);
      if (button.dataset.geoAction === 'plan') this.callbacks.onOpenPlan?.(entry.id, this.planProfile);
      if (button.dataset.geoAction === 'model') this.callbacks.onOpenModel?.(entry.id,this.planProfile);
      if (button.dataset.geoAction === 'inventory') this.callbacks.onViewInventory?.(entry.district);
      if (button.dataset.geoAction === 'event') {
        const item = this.pendingEvents(entry.id).find(item => string(item.id) === button.dataset.geoEventId);
        if (item) this.callbacks.onEvent?.(string(item.id));
      }
    });
    this.listen(this.elements['scene-breadcrumb'], 'click', event => {
      const crumb = event.target.closest?.('[data-geo-crumb]');
      if (!this.active || !crumb) return;
      this.closeDetail();
      if (crumb.dataset.geoCrumb !== 'community') this.communityKey = '';
      if (crumb.dataset.geoCrumb === 'city') this.filters.business = '';
      this.renderBusinessFilter(); this.applyFilters(true);
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
      .map(entry => `<option value="${esc(entry.businessKey)}">${esc(entry.district)} · ${esc(entry.businessLabel)}</option>`).join('');
    const confirmed = options(true), candidatesHtml = options(false);
    select.innerHTML = '<option value="">全部商圈</option>' + (confirmed ? `<optgroup label="已确认商圈">${confirmed}</optgroup>` : '') + (candidatesHtml ? `<optgroup label="待核验">${candidatesHtml}</optgroup>` : '');
    select.value = this.filters.business;
  }

  matchesStatus(entry) {
    return ({pending: entry.hasPending, p1: entry.pendingP1Count > 0,
      p2: entry.pendingP2Count > 0, unconnected: !entry.hasPending})[this.filters.status] ?? true;
  }

  applyFilters(fit = true) {
    const scoped = this.entries.filter(entry =>
      (!this.filters.district || entry.district === this.filters.district) &&
      (!this.filters.business || entry.businessKey === this.filters.business) &&
      this.matchesStatus(entry)
    );
    if (this.communityKey && !this.entries.some(e => e.businessKey === this.filters.business && e.communityKey === this.communityKey)) this.communityKey = '';
    this.filteredEntries = this.communityKey ? scoped.filter(e => e.communityKey === this.communityKey) : scoped;
    this.level = this.communityKey ? 'property' : this.filters.business ? 'community' : 'business';
    this.groups = this.level === 'property' ? [] : mapGroups(this.filteredEntries, this.level);
    const listingPins = combineMapPoints(this.filteredEntries);
    this.pins = this.level === 'property' ? listingPins : combineMapPoints(this.groups);
    if (this.selectedId && !this.filteredEntries.some(entry => entry.id === this.selectedId)) this.closeDetail();
    this.viewer?.setEntries(this.pins, listingPins);
    this.viewer?.select(this.selectedPin(this.selectedId)?.id || null,this.selectedId);
    this.renderList();
    this.renderCoverage();
    this.renderMonitorSummary();
    this.renderBreadcrumb();
    if (fit) { this.viewer?.setRotate(false); this.viewer?.fitAll(true, this.level === 'business' ? 12 : 15); this.syncControls(); }
  }

  renderList() {
    const element = this.elements['geo-property-list'];
    if (!element) return;
    const title = this.elements['geo-panel-title'];
    if (title) title.textContent = {business:'按商圈查看房源',community:'楼盘 / 小区',property:'小区内房源'}[this.level] || '房源监控清单';
    if (this.groups?.length) {
      element.innerHTML = this.groups.map(group => {
        const placed = group.members.filter(e => e.matchType === 'community').length;
        return `<button type="button" class="geo-property-item geo-group-item" data-geo-group="${esc(group.id)}"><span class="geo-property-index">${group.members.length}</span><span class="geo-property-main"><strong>${esc(group.name)}</strong><span class="geo-property-region">${esc(group.district)} · ${group.members.length} 条房源 · ${placed ? placed + ' 条有小区位置' : '小区位置待核验'}</span></span><span aria-hidden="true">›</span></button>`;
      }).join('');
      return;
    }
    element.innerHTML = this.filteredEntries?.length ? this.filteredEntries.map(entry => {
      const precision = positionLabel(entry);
      const priorityClass = entry.priority === 'P1' ? ' is-p1' : entry.priority === 'P2' ? ' is-p2' : '';
      const pendingLabel = entry.hasPending ? `${entry.priority ? entry.priority + ' ' : ''}演示待办 · ${entry.pendingCount}条` : '暂无演示待办';
      const pendingTag = entry.priority === 'P1' ? 'red' : entry.hasPending ? 'amber' : 'neutral';
      return `<button type="button" class="geo-property-item${priorityClass}${entry.id === this.selectedId ? ' is-selected' : ''}" data-geo-property-id="${esc(entry.id)}" aria-pressed="${entry.id === this.selectedId}">
        <span class="geo-property-index">${entry.mapIndex}</span><span class="geo-property-main"><strong>${esc(entry.property.realListingId || entry.id)}</strong><span class="geo-property-region">${esc(entry.name)}${(entry.property.officialHouseCode || entry.property.businessId) ? ' · '+esc(entry.property.officialHouseCode || entry.property.businessId) : ''}</span>
        <span class="geo-property-region" style="display:block">${esc(entry.district)} · ${esc(entry.businessLabel)}</span>
        <span class="geo-property-region" style="display:block">${esc(propertyFacts(entry.property))}</span>
        <span class="geo-property-status"><span class="tag neutral">${precision}</span><span class="tag ${pendingTag}">${pendingLabel}</span></span>
        </span></button>`;
    }).join('') : `<p class="geo-list-empty">${this.entries.length ? '当前筛选没有房源记录，请调整区域、商圈或状态。' : '当前范围暂无已收录房源。可查看采集状态，或切换为全部采集房源。'}</p>`;
  }

  renderCoverage() {
    const element = this.elements['geo-coverage-summary'];
    if (!element) return;
    const community = this.entries.filter(entry => entry.matchType === 'community').length;
    const proxy = this.entries.filter(entry => entry.matchType === 'station_proxy').length;
    const unmatched = this.entries.length - community - proxy;
    const kinds = [
      ['osm_residential_reference','OSM 住宅范围参考点'],
      ['registered_community_estimate','官网小区 · 邻域配准估算'],
      ['city_registered_community_estimate','官网小区 · 市域配准估算'],
    ];
    const legendOpen = element.querySelector('details')?.open || false;
    const legend = kinds.map(([kind, label]) => {
      const members = this.entries.filter(e => e.position && e.geography?.precision === kind);
      const stat = members[0]?.geography;
      const test = stat?.validationP90Metres != null ? `；交叉验证 ${stat.holdoutCount} 个小区，中位 ${stat.validationMedianMetres} 米，P90 ${stat.validationP90Metres} 米` : '';
      return members.length ? `<div><i class="geo-precision-symbol" data-position-kind="${kind}" aria-hidden="true"></i><span>${label} · ${members.length} 条${test}</span></div>` : '';
    }).join('');
    element.innerHTML = `已采集 ${this.entries.length} 条 · 小区参考 ${community} · 地铁参考 ${proxy} · 待定位 ${unmatched}<br>当前范围 ${this.filteredEntries.length} 条 · 非北京全量 · 真实设备状态未接入` +
      (legend ? `<details class="geo-precision-legend" ${legendOpen ? 'open' : ''}><summary>定位图例与误差</summary>${legend}</details>` : '');
  }

  renderMonitorSummary() {
    const element = this.elements['geo-monitor-summary'];
    if (!element) return;
    const entries = this.filteredEntries;
    const p1 = entries.reduce((sum, entry) => sum + entry.pendingP1Count, 0);
    const p2 = entries.reduce((sum, entry) => sum + entry.pendingP2Count, 0);
    const pendingHomes = entries.filter(entry => entry.hasPending).length;
    element.innerHTML = [
      ['当前筛选房源', entries.length, '条', ''],
      ['P1 演示待办', p1, '条', 'is-p1'],
      ['P2 演示待办', p2, '条', 'is-p2'],
      ['有待办房源', pendingHomes, '条', '']
    ].map(([label, count, unit, className]) => `<div class="geo-monitor-metric${className ? ' ' + className : ''}"><span>${label}</span><strong>${count}<small>${unit}</small></strong></div>`).join('')
      + '<p class="geo-monitor-caption">随当前筛选统计 · 待办为演示事件，真实设备状态未接入</p>';
  }

  renderBreadcrumb() {
    if (!this.active || !this.elements['scene-breadcrumb']) return;
    const current = this.communityKey && this.entries.find(e => e.businessKey === this.filters.business && e.communityKey === this.communityKey);
    const parts = ['<button type="button" class="text-btn" data-geo-crumb="city">北京</button>'];
    if (this.filters.district) parts.push(esc(this.filters.district));
    if (this.filters.business) {
      const business = this.entries.find(e => e.businessKey === this.filters.business);
      if (business) parts.push(`<button type="button" class="text-btn" data-geo-crumb="business">${esc(business.businessLabel)}</button>`);
    }
    if (this.communityKey && current) parts.push(`<button type="button" class="text-btn" data-geo-crumb="community">${esc(current.name)}</button>`);
    if (this.selectedId) parts.push(esc(this.selectedId));
    this.elements['scene-breadcrumb'].innerHTML = parts.join('<span class="crumb-divider">/</span>');
  }

  openGroup(id) {
    const group = this.groups.find(item => item.id === id);
    if (!group) return;
    this.closeDetail();
    if (group.type === 'business') this.filters.business = id;
    else this.communityKey = id;
    this.renderBusinessFilter(); this.applyFilters(true);
  }

  openMarker(pin) {
    if (!pin) return;
    if (pin.type === 'business') { this.openGroup(pin.id); return; }
    if (pin.type === 'community' && pin.members.length > 1) {
      this.openGroup(pin.id);
      this.chooseListings(pin.members);
      return;
    }
    if(pin.options?.some(option=>option.type)) {
      const options=pin.options.map(option=>`<button type="button" class="geo-listing-choice" data-geo-map-group="${esc(option.id)}">
        <strong>${esc(option.name)}</strong><span>${esc(option.district)} · ${option.members.length} 套</span></button>`).join('');
      const label=pin.options[0].type==='business'?'选择商圈':'选择小区';
      this.setMapCard(label,`<div class="geo-listing-choices">${options}</div>`,true);
      return;
    }
    this.chooseListings(pin.members || [pin]);
  }

  chooseListings(entries) {
    const listings=[...new Map(entries.map(entry=>[entry.id,entry])).values()];
    if(!listings.length)return;
    if(listings.length===1){ this.focusProperty(listings[0].id,{reveal:false}); return; }
    const names = new Set(listings.map(entry=>entry.name));
    const heading = names.size===1 ? listings[0].name : '附近房源';
    const choices = listings.map(entry=>{
      const id=entry.property.realListingId || entry.id;
      return `<button type="button" class="geo-listing-choice" data-geo-pick="${esc(entry.id)}" aria-pressed="${entry.id===this.selectedId}">
        <strong>${names.size===1?'':esc(entry.name)+' · '}${entry.property.realListingId?'挂牌':'记录'} ${esc(id)}</strong>
        <span>${esc(propertyFacts(entry.property))}</span></button>`;
    }).join('');
    this.setMapCard(heading+' · '+listings.length+' 套',`<div class="geo-listing-choices">${choices}</div>`,true);
  }

  setMapCard(title,html,focus=false) {
    this.mapCard.hidden=false;
    this.mapCard.innerHTML=`<div class="geo-listing-card-head"><h3 tabindex="-1">${esc(title)}</h3>
      <button type="button" data-geo-card-close aria-label="收起地图房源信息">×</button></div>${html}`;
    if(focus)this.mapCard.querySelector('h3').focus({preventScroll:true});
  }

  showSelectedListing(entry,focus=false) {
    const id=entry.property.realListingId || entry.id;
    this.setMapCard(entry.name,`<p><strong>${entry.property.realListingId?'挂牌号':'记录号'} ${esc(id)}</strong> · ${esc(positionLabel(entry))}</p>
      <p>${esc(propertyFacts(entry.property))}</p><div class="geo-listing-actions">
      <button type="button" data-geo-card-detail>设备详情</button>
      ${this.filteredEntries.length>1?`<button type="button" data-geo-card-siblings>本小区 ${this.filteredEntries.length} 套</button>`:''}
      <button type="button" data-geo-card-city>返回北京地图</button></div>`,focus);
  }

  dismissCard() {
    this.mapCard.hidden=true;
    const marker=this.viewer.markerRecords.find(record=>record.element.classList.contains('is-selected')) ||
      this.viewer.markerRecords[0];
    if(marker)marker.element.focus({preventScroll:true});
    else {this.container.tabIndex=-1;this.container.focus({preventScroll:true});}
  }

  revealDetail() {
    const box = this.elements['scene-detail'];
    if (!this.active || !box || box.hidden) return;
    box.tabIndex = -1;
    box.focus({preventScroll:true});
    const top = box.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight - 140) {
      box.scrollIntoView({block:'start', behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
    }
  }

  selectedPin(id) {
    return this.pins.find(pin => pin.id === id || pin.options?.some(item => item.id === id));
  }

  canOpenModel(entry) {
    return entry.id === MODEL_PROPERTY_ID && entry.property.imported !== true && entry.property.modelReady === true;
  }

  async focusProperty(value, {reveal=true}={}) {
    const id = string(value);
    const entry = this.entries.find(item => item.id === id);
    if (!entry) return false;
    if (!this.active && this.callbacks.onActivateMap) await this.callbacks.onActivateMap();
    if (this.filters.district && this.filters.district !== entry.district) this.filters.district = '';
    if (!this.matchesStatus(entry)) this.filters.status = 'all';
    this.filters.business = entry.businessKey; this.communityKey = entry.communityKey;
    if (this.selectedId !== id) {
      this.callbacks.onClosePlan?.();
      this.planProfile = 'base';
    }
    this.selectedId = id; this.deferredFocusId = null;
    this.renderFilters(); this.applyFilters(false);
    this.viewer.select(this.selectedPin(id)?.id || null,id);
    this.renderDetail(entry);
    this.showSelectedListing(entry,!reveal);
    if (reveal) this.revealDetail();
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
    try { return await this.viewer.focusProperty(this.selectedPin(id)?.id); }
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
    const precision = entry.matchType === 'community' ? positionLabel(entry) + '，仅供小区级定位。'
      : entry.matchType === 'station_proxy' ? '地铁站代理参考位置；房屋和小区尚未定位。'
      : '尚无经核验的 WGS84 定位；地图不放置推测点。';
    const links = [osmUrl && `<a href="${esc(osmUrl)}" target="_blank" rel="noopener noreferrer">OSM 对象</a>`,
      businessUrl && `<a href="${esc(businessUrl)}" target="_blank" rel="noopener noreferrer">商圈依据</a>`,
      sourceUrl && `<a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">房源来源</a>`].filter(Boolean);
    element.hidden = false;
    element.innerHTML = `<button type="button" class="icon-btn close-scene-detail" data-geo-action="close" aria-label="关闭房源地图详情">×</button>
      <div class="geo-detail-heading"><h3>${esc(entry.name)}</h3><p>${entry.property.realListingId ? '挂牌号' : '记录号'} ${esc(entry.id)}${(entry.property.officialHouseCode || entry.property.businessId) ? ' · ' + esc(entry.property.officialHouseCode || entry.property.businessId) : ''}</p><p>${esc(entry.district)} · ${esc(entry.businessLabel)} · ${esc(propertyFacts(entry.property))}</p></div>
      <div class="geo-detail-actions">
        ${this.callbacks.onOpenPlan ? `<button type="button" class="button primary" data-geo-action="plan" aria-controls="overview-plan-pane" aria-expanded="${document.getElementById('overview-plan-pane')?.hidden === false}">${entry.property.publicFloorplanUrl ? '查看户型与设备点位' : '查看本套配置方案'}</button>` : ''}
        <button type="button" class="button" data-geo-action="operations">查看家庭运行</button>
        <button type="button" class="button" data-geo-action="property">查看房源详情</button>
        <button type="button" class="button" data-geo-action="model">${this.canOpenModel(entry) ? '进入三维运维' : '设备配置推演'}</button>
        ${pending.map(event => `<button type="button" class="button" data-geo-action="event" data-geo-event-id="${esc(event.id)}">演示事件 · ${esc(event.title || '查看待办')}</button>`).join('')}
        ${this.callbacks.onViewInventory ? '<button type="button" class="button" data-geo-action="inventory">查看该区台账</button>' : ''}
      </div>
      <div class="geo-device-plan">${devicePlan(entry.property, this.planProfile)}</div>
      <p>${pending.length ? `演示待办 ${pending.length} 条` : '无未闭环演示待办'} · 真实设备状态未接入</p>
      <details class="geo-detail-evidence"><summary>地址与匹配来源</summary>
        <p>${esc(precision)}</p>
        <p>${geographicRecord?.osm?.displayName ? 'OSM 地址：' + esc(geographicRecord.osm.displayName) + '<br>' : ''}${esc(geographicRecord?.positionBasis || geographicRecord?.matchBasis || '仅有房源列表信息，等待地址核验。')}</p>
        ${geographicRecord?.businessDistrict?.basis ? `<p>${esc(geographicRecord.businessDistrict.basis)}</p>` : ''}
        ${links.length ? `<p class="geo-detail-links">${links.join('')}</p>` : ''}
        ${geographicRecord?.reviewedAt ? `<p>定位核验记录：${esc(string(geographicRecord.reviewedAt).slice(0, 10))}</p>` : ''}
      </details>`;
  }

  setPlanProfile(id, profile) {
    const entry = this.entries.find(row => row.id === id);
    if (!this.active || !entry || id !== this.selectedId || !CONFIG_PROFILES.some(option => option.id === profile)) return;
    this.planProfile = profile;
    const summary = this.elements['scene-detail']?.querySelector('.geo-device-plan');
    if (summary) summary.innerHTML = devicePlan(entry.property, profile);
  }

  closeDetail() {
    this.mapCard.hidden=true;
    this.callbacks.onClosePlan?.();
    this.planProfile = 'base';
    this.selectedId = null;
    this.deferredFocusId = null;
    this.viewer?.select(null);
    if (this.active && this.elements['scene-detail']) this.elements['scene-detail'].hidden = true;
    this.renderList(); this.renderBreadcrumb();
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

  resize() { if (this.active) this.renderBreadcrumb(); this.viewer.resize(); }

  setVisible(visible) {
    this.active = Boolean(visible);
    this.viewer.setVisible(this.active);
    if (!this.active) this.mapCard.hidden=true;
    if (this.elements['geo-map-status']) this.elements['geo-map-status'].hidden = !this.active;
    if (this.active) {
      this.renderBreadcrumb(); this.syncControls();
      const selected = this.entries.find(entry => entry.id === this.selectedId);
      if (selected) {this.renderDetail(selected);this.showSelectedListing(selected);}
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
    this.communityKey = '';
    this.filters = { district: '', business: '', status: 'all' };
    this.closeDetail(); this.renderFilters(); this.applyFilters(false);
    this.viewer.setRotate(false); this.viewer.reset(); this.syncControls();
  }

  focusDistrict(id) {
    const district = districtName(id);
    this.filters = { district, business: '', status: 'all' }; this.communityKey = '';
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
    this.mapCard.remove();
    this.viewer.dispose();
  }
}
