import { listingBasics, renderListingTitle, renderListingOfferAndFacts } from './listing-basics.js';
import { verifiedVrUrl } from './official-vr.js';
import { buildDeviceConfiguration, CONFIG_SOURCE, CONFIG_PROFILES } from './device-configuration.js';
import { lingzhiEvidence } from './inventory-hierarchy.js';

const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const esc = value => text(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const valueOr = (value, fallback = '待补') => text(value) || fallback;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const count = value => Number.isInteger(value) && value >= 0 ? value : 0;
let detailSequence = 0;

function sourceUrl(value, realListingId, detailOnly = false) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !/(^|\.)ziroom\.com$/.test(url.hostname)) return null;
    if (detailOnly && (!/^\d+$/.test(text(realListingId)) || url.pathname !== `/x/${text(realListingId)}.html`)) return null;
    return url.href;
  } catch { return null; }
}

function observedDate(value) {
  const raw = text(value);
  if (!raw) return '时间待补';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.replaceAll('-', '.');
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', {timeZone:'Asia/Shanghai', hour12:false}) : raw;
}

function roomLabel(property, row) {
  const shared = row.bedroomGroup === 'shared' || property.areaScope === 'listed_bedroom' || Boolean(property.roomLabel);
  const bedrooms = Number.isInteger(property.bedrooms) && property.bedrooms > 0 ? `${property.bedrooms} 居` : '居室待补';
  return shared ? `${valueOr(property.roomLabel, '出租卧室')} · 所属 ${bedrooms}` : bedrooms;
}

function fact(label, value) { return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`; }

/** A per-record view. No fetch, device command, inferred installed inventory or fallback floorplan. */
export function mountPropertyDetail(container, {row, coverageRecord, onTwin, onHousehold, onReferences, onMap, onPlan} = {}) {
  if (!container || !row?.property) return {destroy() {}};
  const property = row.property, id = text(row.id || property.id), uid = `pd-${++detailSequence}`;
  const source = sourceUrl(property.sourceUrl);
  const officialDetail = sourceUrl(property.sourceUrl, row.realListingId, true) || sourceUrl(coverageRecord?.confirmedDetailUrl, row.realListingId, true);
  const publicPlan = officialDetail ? sourceUrl(row.publicFloorplanUrl) : null;
  const publicPhotos = officialDetail && Array.isArray(row.publicPhotoUrls) ? row.publicPhotoUrls.map(url=>sourceUrl(url)).filter(Boolean) : [];
  const vrUrl = verifiedVrUrl(property);
  const vrEntry = vrUrl ? `<a class="pd-button pd-button-primary" href="#vr-${esc(id)}" data-official-vr="${esc(id)}">看官网 VR</a>` : '';
  const matchesCoverage = coverageRecord && text(coverageRecord.id) === id && (!coverageRecord.realListingId || text(coverageRecord.realListingId) === text(row.realListingId));
  const references = matchesCoverage ? coverageRecord : null;
  const floorplans = Math.max(count(references?.floorplanCount), count(row.floorplanCount), publicPlan ? 1 : 0);
  const photos = Math.max(count(references?.interiorPhotoCount), count(row.interiorPhotoCount), publicPhotos.length);
  const canViewReferences = Boolean(references && Array.isArray(references.assets) && references.assets.length && (floorplans || photos));
  const referenceReady = row.referenceReady === true && Boolean(references?.modelReady || references?.status === 'reference_ready');
  const mediaStatus = referenceReady ? '有对应三维参考' : publicPlan ? '有本套官网户型图' : '户型资料待补';
  const missingMaterials = publicPlan
    ? [publicPhotos.length ? '建模所需的实测尺寸与照片对照核验' : '建模所需的对照照片与实测尺寸','该套房的设备实装清单与型号']
    : references?.missing?.length ? references.missing : [
      ...(!officialDetail ? ['与本条房源唯一关联的房源详情'] : []),
      '对应户型图、主要房间照片及必要尺寸','该套房的设备实装清单与型号'
    ];
  const shared = row.bedroomGroup === 'shared' || property.areaScope === 'listed_bedroom' || Boolean(property.roomLabel);
  const observed = observedDate(row.observedAt || property.observedAt || references?.sourceObservedAt);
  const basics = listingBasics(property);
  const captureScope = property.currentFilteredListing === true ? '本次北京官网筛选命中'+(property.listObservedAt ? ' · '+observedDate(property.listObservedAt) : '') : property.currentFilteredListing === false ? '本次筛选未列出 · 已收录记录' : '已收录记录';
  const cardAvailability = property.currentFilteredListing && Array.isArray(property.availability) ? property.availability.filter(Boolean).join('、') : '';
  const availability = property.currentAvailabilityVerified === true && text(property.currentAvailabilityLabel) ? property.currentAvailabilityLabel
    : cardAvailability ? '采集时官网标注'+cardAvailability : '当前在租状态待核验';
  let selectedTab = 'overview', selectedProfile = 'base', destroyed = false;

  container.innerHTML = `<div class="pd" data-property-id="${esc(id)}">
    <header class="pd-header"><div><h3 class="pd-title">${renderListingTitle(basics)}</h3><p class="pd-subtitle">北京 · ${esc(valueOr(row.district, '行政区待核验'))} · ${esc(valueOr(row.businessName, '商圈待核验'))}</p></div><span class="pd-badge${referenceReady ? ' pd-badge-blue' : ''}">${esc(mediaStatus)}</span></header>
    <div class="pd-listing-basics listing-basics-light">${renderListingOfferAndFacts(basics)}</div>
    <div class="pd-actions">${vrEntry}<button type="button" class="pd-button${vrUrl?'':' pd-button-primary'}" data-pd-action="twin" ${typeof onTwin !== 'function' ? 'disabled' : ''}>三维设备运维</button><button type="button" class="pd-button" data-pd-action="household" ${typeof onHousehold !== 'function' ? 'disabled' : ''}>家庭运行</button>${typeof onMap === 'function' ? '<button type="button" class="pd-button" data-pd-action="map">地图定位</button>' : ''}${officialDetail ? `<a class="pd-button" href="${esc(officialDetail)}" target="_blank" rel="noopener noreferrer">自如房源原页</a>` : ''}</div>
    <p class="pd-scope">资料观察：${esc(observed)} · ${esc(availability)}${property.imported ? ' · 本地导入记录' : ' · '+esc(captureScope)}</p>
    <div class="pd-tabs" role="tablist" aria-label="房源详情维度">${[['overview','房源信息'],['references','3D 与 VR'],['devices','设备配置']].map(([key,label]) => `<button type="button" role="tab" id="${uid}-tab-${key}" aria-controls="${uid}-panel-${key}" aria-selected="${key === selectedTab}" tabindex="${key === selectedTab ? '0' : '-1'}" data-pd-tab="${key}">${label}</button>`).join('')}</div>
    <section class="pd-panel" id="${uid}-panel-overview" role="tabpanel" aria-labelledby="${uid}-tab-overview" data-pd-panel="overview">
      <dl class="pd-facts">${[
        ['小区', valueOr(row.communityName || property.name)],
        ['商圈', row.businessVerified ? valueOr(row.businessName) + ' · 已确认' : '待核验'],
        ['行政区', valueOr(row.district) + (row.districtVerified === false ? ' · 归属待核验' : '')],
        ...(property.officialMoveInEvidence ? [['官网可入住日期', text(property.officialMoveInLabel) || '官网未标注']] : []),
        ...[['电梯','elevator'],['建成年代','built'],['供暖','heating'],['绿化率','greenery']].flatMap(([label,key])=>text(property.detailFields?.[key]) ? [[label,text(property.detailFields[key])]] : []),
        ['居室分类', roomLabel(property, row)],
        ['产品标签', valueOr(property.product)],
        ['附近地铁', text(property.detailFields?.transit) || (property.station ? property.station + '站' + (finite(property.distance) ? ` · 原页约 ${property.distance} m` : '') : '待补')],
        ...(lingzhiEvidence(property) ? [['灵之标签证据', lingzhiEvidence(property)]] : [])
      ].map(([label,value]) => fact(label,value)).join('')}</dl>
      ${!row.businessVerified && row.businessCandidate ? `<div class="pd-note"><strong>商圈归属待核验</strong><p>现有位置线索：${esc(row.businessCandidate)}。该线索不计入已确认商圈数量。</p></div>` : ''}
      ${!row.realListingId ? '<p class="pd-muted">本条保留原采集资料，官网详情链接待核验。</p>' : ''}
      ${property.labelNote ? `<p class="pd-muted">${esc(property.labelNote)}</p>` : ''}
      ${shared ? '<p class="pd-muted">面积对应出租卧室，居室数描述所属整套房屋；设备规划仅计该卧室范围。</p>' : ''}
      <div class="pd-foot-links">${!officialDetail && source ? `<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">查看原采集来源</a>` : ''}<span>真实设备状态：${row.telemetryConnected === true ? '请进入家庭运行核对' : '未接入'}</span></div>
    </section>
    <section class="pd-panel" id="${uid}-panel-references" role="tabpanel" aria-labelledby="${uid}-tab-references" data-pd-panel="references" hidden>
      <div class="pd-reference-grid"><article class="pd-reference-card"><span class="pd-eyebrow">3D FLOORPLAN</span><h4>${referenceReady ? '本套户型参考已具备' : publicPlan ? '本套官网户型图' : '本套三维资料待补'}</h4><p>${referenceReady ? '使用该房源的官方户型图与室内照片近似重建，可进入三维查看设备配置点位。' : publicPlan ? '可对照本套原图查看户型与方案配置，实测尺寸和安装位置待核验。' : '设备配置可以查看；对应户型图、室内照片与必要尺寸补齐后，再建立这套房的三维空间。'}</p><div class="pd-reference-counts"><span><strong>${floorplans}</strong> 张户型图</span><span><strong>${photos}</strong> 张实景照片</span></div>${publicPlan && (typeof onPlan === 'function' || typeof onTwin === 'function') ? '<button type="button" class="pd-button pd-button-primary" data-pd-action="plan">查看本套户型与方案点位</button>' : ''}${publicPlan ? `<a class="pd-button" href="${esc(publicPlan)}" target="_blank" rel="noopener noreferrer">查看官网户型图</a>` : ''}${canViewReferences ? '<button type="button" class="pd-button" data-pd-action="references">查看原始户型与照片</button>' : publicPlan ? '' : '<span class="pd-muted">尚无本套可查看的原始图片</span>'}</article><article class="pd-reference-card"><span class="pd-eyebrow">OFFICIAL VR</span><h4>${vrUrl ? '已核验原始 VR' : '原始 VR 待补'}</h4><p>${vrUrl ? '在此查看自如提供的本套房源全景。' : '本套暂未取得已核验的官网全景。'}</p>${vrUrl ? vrEntry : '<span class="pd-badge">尚未取得</span>'}</article></div>
      ${publicPhotos.length ? `<details class="pd-missing"><summary>官网室内照片 · ${publicPhotos.length} 张</summary><div class="pd-foot-links">${publicPhotos.map((url,index) => `<a class="pd-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">照片 ${index+1}</a>`).join('')}</div></details>` : ''}
      ${referenceReady ? '<p class="pd-muted">参考重建用于空间与设备展示；实测尺寸、安装位置和真实设备状态仍需现场资料确认。</p>' : `<details class="pd-missing"><summary>本套尺寸与实装核验资料</summary><ul>${missingMaterials.map(item => `<li>${esc(item)}</li>`).join('')}</ul></details>`}
    </section>
    <section class="pd-panel" id="${uid}-panel-devices" role="tabpanel" aria-labelledby="${uid}-tab-devices" data-pd-panel="devices" hidden><div class="pd-device-toolbar"><div><h4>按房源居室匹配设备方案</h4><p class="pd-muted">配置来源：${esc(CONFIG_SOURCE.title)} · ${esc(CONFIG_SOURCE.version)}</p></div><label class="pd-profile-label" for="${uid}-profile"><span>配置方案</span><select id="${uid}-profile" data-pd-profile aria-label="房源详情设备配置方案">${CONFIG_PROFILES.filter(item => ['base','plus','upgrade'].includes(item.id)).map(item => `<option value="${esc(item.id)}">${esc(item.label)}</option>`).join('')}</select></label></div><div data-pd-config></div></section>
  </div>`;

  const configContainer = container.querySelector('[data-pd-config]');
  function renderConfiguration() {
    const config = buildDeviceConfiguration(property, {profile:selectedProfile});
    configContainer.innerHTML = `<div class="pd-device-metrics"><div><span>规划设备点位</span><strong>${count(config.summary.plannedDeviceCount)}</strong></div><div><span>已核验实装</span><strong>${row.deviceInstallationVerified === true ? '见台账' : '待核验'}</strong></div><div><span>真实运行状态</span><strong>${row.telemetryConnected === true ? '见家庭运行' : '未接入'}</strong></div></div><p class="pd-plan-note">${esc(config.applicability.reason)}</p><div class="pd-device-list" role="list" aria-label="本套配置规划设备">${config.devices.length ? config.devices.map(device => `<article class="pd-device" role="listitem"><div><h5>${esc(device.name)}</h5><p>${esc(device.model)} · ${esc(device.specification)}</p><span class="pd-device-source">配置文档第 ${esc((device.configurationSource.pages || []).join('、'))} 页</span></div><div class="pd-device-room"><strong>${esc(device.roomName)}</strong><span>规划 ${count(device.quantity)} 项</span><span>状态未接入</span></div></article>`).join('') : '<p class="pd-muted">居室与适用条件尚不完整，当前无法展开确定数量的设备点位。</p>'}</div><details class="pd-missing"><summary>按需配置与待确认项 · ${config.conditionalRules.length} 项</summary><ul>${config.conditionalRules.map(rule => `<li><strong>${esc(rule.label)}</strong><span>${esc(rule.reason)}</span></li>`).join('')}</ul></details><p class="pd-muted">以上为方案规划，设备型号、安装数量与点位以本套实装台账为准。</p>`;
  }

  function selectTab(tab, focus = false) {
    if (!['overview','references','devices'].includes(tab) || destroyed) return;
    selectedTab = tab;
    container.querySelectorAll('[data-pd-tab]').forEach(button => {
      const selected = button.dataset.pdTab === tab;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    });
    container.querySelectorAll('[data-pd-panel]').forEach(panel => {panel.hidden = panel.dataset.pdPanel !== tab;});
  }
  function click(event) {
    const button = event.target.closest?.('[data-pd-tab],[data-pd-action]');
    if (!button || !container.contains(button) || button.disabled || destroyed) return;
    if (button.dataset.pdTab) {selectTab(button.dataset.pdTab);return;}
    const action = button.dataset.pdAction;
    if (action === 'plan') (onPlan || onTwin)?.(id, selectedProfile);
    else if (action === 'twin') onTwin?.(id);
    else if (action === 'household') onHousehold?.(id);
    else if (action === 'references' && canViewReferences) onReferences?.(id);
    else if (action === 'map') onMap?.(id);
  }
  function change(event) {
    if (!event.target.matches?.('[data-pd-profile]') || destroyed) return;
    if (['base','plus','upgrade'].includes(event.target.value)) {selectedProfile = event.target.value;renderConfiguration();}
  }
  function keydown(event) {
    const button = event.target.closest?.('[data-pd-tab]');
    if (!button || !container.contains(button) || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    const tabs = ['overview','references','devices'], index = tabs.indexOf(button.dataset.pdTab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();selectTab(tabs[next], true);
  }
  renderConfiguration();
  container.addEventListener('click', click);
  container.addEventListener('change', change);
  container.addEventListener('keydown', keydown);
  return {selectTab, destroy() {destroyed = true;container.removeEventListener('click', click);container.removeEventListener('change', change);container.removeEventListener('keydown', keydown);}};
}
