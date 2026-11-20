import { mergeCollectedProperties, housingGroup, listingIdentity } from './inventory-statistics.js';

const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const list = value => Array.isArray(value) ? value : [];
const verifiedValue = value => value?.verified === true ? text(value.value) : '';
const entityKey = (...parts) => parts.map(part => encodeURIComponent(text(part))).join('|');
const compare = (left, right) => text(left).localeCompare(text(right), 'zh-CN');
const normalizeCity = value => text(value).replace(/市$/, '') || '北京';
const normalizeDistrict = value => text(value).replace(/^北京市/, '').replace(/[区县]$/, '');

function indexedRows(document) {
  const byId = new Map(), byRealId = new Map();
  for (const row of list(document?.properties)) {
    if (text(row?.id)) byId.set(text(row.id), row);
    const realId = listingIdentity(row);
    if (realId) byRealId.set(realId, row);
  }
  return (property, realId) => byId.get(text(property.id)) || (realId ? byRealId.get(realId) : null) || null;
}

function officialUrl(value) {
  try {
    const url = new URL(text(value));
    if (url.protocol !== 'https:' || url.username || url.password || !/(^|\.)ziroom\.com$/.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

function detailIdentity(value) {
  const url = officialUrl(value);
  return url ? new URL(url).pathname.match(/^\/x\/(\d+)\.html$/)?.[1] || null : null;
}

/** References stay bound to their own confirmed listing; no generic model fallback. */
function referenceEvidence(property, reference, realId) {
  const identityMatches = Boolean(realId && reference && listingIdentity(reference) === realId &&
    detailIdentity(reference.confirmedDetailUrl || reference.sourceUrl) === realId);
  const assets = identityMatches ? list(reference.assets).filter(asset =>
    asset && detailIdentity(asset.sourceUrl) === realId && text(asset.file)) : [];
  const floorplanCount = new Set(assets.filter(asset => asset.kind === 'floorplan').map(asset => text(asset.file))).size;
  const interiorPhotoCount = new Set(assets.filter(asset => asset.kind === 'interior_photo').map(asset => text(asset.file))).size;
  const referenceReady = Boolean(identityMatches && reference.status === 'reference_ready' && reference.modelReady === true &&
    floorplanCount > 0 && interiorPhotoCount > 0 && property.modelReady !== false);

  // A VR link needs an explicit verification flag and a matching listing identity.
  // A photo, floorplan or Three.js reconstruction never implicitly supplies a VR link.
  const vr = reference?.vr;
  const vrIdentity = text(vr?.realListingId || vr?.listingId || reference?.realListingId);
  const vrCandidate = vr?.verified === true ? vr.url : reference?.vrVerified === true ? reference.vrUrl : null;
  const vrUrl = identityMatches && vrIdentity === realId ? officialUrl(vrCandidate) : null;
  return { referenceReady, floorplanCount, interiorPhotoCount, vrUrl, vrVerified: Boolean(vrUrl) };
}

function communityGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.communityKey)) groups.set(row.communityKey, {
      key: row.communityKey, label: row.communityName, city: row.city, district: row.district, rows: []
    });
    groups.get(row.communityKey).rows.push(row);
  }
  return [...groups.values()].map(group => ({
    ...group, propertyCount: group.rows.length,
    businessKeys: [...new Set(group.rows.map(row => row.businessKey))]
  })).sort((a, b) => compare(a.district, b.district) || compare(a.label, b.label));
}

function businessGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.businessKey)) groups.set(row.businessKey, {
      key: row.businessKey, label: row.businessName, verified: row.businessVerified, rows: []
    });
    groups.get(row.businessKey).rows.push(row);
  }
  return [...groups.values()].map(group => {
    const communities = communityGroups(group.rows);
    return { ...group, propertyCount: group.rows.length, communityCount: communities.length,
      districts: [...new Set(group.rows.map(row => row.district).filter(Boolean))].sort(compare), communities };
  }).sort((a, b) => Number(b.verified) - Number(a.verified) || compare(a.label, b.label));
}

function latestObservedAt(values) {
  return values.map(text).filter(value => Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
}

/** Derive all overview dimensions from the same retained collection records. */
export function buildInventoryHierarchy({ properties = [], report = {}, geography = {}, coverage = {}, source = {}, events = [] } = {}) {
  const records = mergeCollectedProperties(properties);
  const auditFor = indexedRows(report), locationFor = indexedRows(geography), referenceFor = indexedRows(coverage);
  const aliases = new Map();
  for (const property of list(properties)) {
    const realId = listingIdentity(property);
    if (!realId) continue;
    if (!aliases.has(realId)) aliases.set(realId, new Set());
    aliases.get(realId).add(text(property.id));
  }

  const rows = records.map(property => {
    const id = text(property.id), realListingId = listingIdentity(property);
    const audit = auditFor(property, realListingId), location = locationFor(property, realListingId), reference = referenceFor(property, realListingId);
    const fields = audit?.fields || {};
    const city = normalizeCity(verifiedValue(fields.city) || property.city || source.city);
    const district = normalizeDistrict(verifiedValue(fields.district) || property.district);
    const districtVerified = Boolean(district && (fields.district?.verified === true || property.districtConfidence === 'confirmed'));
    const geoBusiness = location?.businessDistrict;
    const business = verifiedValue(fields.businessArea) ||
      (['confirmed', 'confirmed_existing_detail_read'].includes(geoBusiness?.status) ? text(geoBusiness.name) : '');
    const businessVerified = Boolean(business);
    const businessKey = businessVerified ? entityKey(city, district, business) : '__unknown__';
    const communityName = verifiedValue(fields.community) || text(property.name);
    const communityKey = entityKey(city, district, communityName);
    const propertyAliases = new Set([id, ...(realListingId ? [realListingId, ...aliases.get(realListingId) || []] : [])]);
    const pendingEvents = list(events).filter(event => event && propertyAliases.has(text(event.propertyId)) &&
      !['resolved', 'closed'].includes(event.status));
    return {
      id, property, city, district, districtVerified,
      businessKey, businessName: business || '商圈待核验', businessVerified,
      businessCandidate: businessVerified ? null : text(fields.businessArea?.candidate || geoBusiness?.candidate) || null,
      communityKey, communityName, bedroomGroup: housingGroup(property), realListingId,
      ...referenceEvidence(property, reference, realListingId),
      deviceInstallationVerified: property.deviceInstallationVerified === true || reference?.deviceInstallationVerified === true,
      telemetryConnected: property.telemetryConnected === true || reference?.telemetryConnected === true,
      pendingEvents,
      observedAt: text(property.observedAt || property.lastSeen || property.sourceObservedAt || reference?.sourceObservedAt || audit?.sourceObservedAt || source.observedAt) || null
    };
  });
  const businesses = businessGroups(rows), communities = communityGroups(rows);
  const totals = {
    properties: rows.length,
    businesses: businesses.filter(group => group.verified).length,
    pendingBusinessRecords: rows.filter(row => !row.businessVerified).length,
    communities: communities.length,
    districts: new Set(rows.map(row => row.district).filter(Boolean)).size,
    modelReady: rows.filter(row => row.referenceReady).length,
    vrReady: rows.filter(row => row.vrVerified).length
  };
  return { rows, businesses, communities, totals, observedAt: latestObservedAt(rows.map(row => row.observedAt)) };
}
