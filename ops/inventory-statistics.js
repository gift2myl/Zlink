const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const verifiedValue = field => field?.verified === true ? field.value : null;

export function listingIdentity(property) {
  if (text(property?.realListingId)) return text(property.realListingId);
  if (property?.idType === 'ziroom_property_id' && /^\d+$/.test(text(property.id))) return text(property.id);
  try {
    const url = new URL(property?.sourceUrl);
    if (/(^|\.)ziroom\.com$/.test(url.hostname)) return url.pathname.match(/^\/x\/(\d+)\.html$/)?.[1] || null;
  } catch {}
  return null;
}

/** Accumulate successful listing records. Missing qualification fields do not remove a record. */
export function mergeCollectedProperties(...batches) {
  const rows = new Map();
  for (const batch of batches) for (const property of Array.isArray(batch) ? batch : []) {
    if (!property || property.imported || property.sourceKind === 'imported' || !text(property.id) || !text(property.name)) continue;
    const realId = listingIdentity(property);
    const key = realId ? `ziroom:${realId}` : `record:${text(property.sourceBatchId || 'saved-map-list')}:${text(property.id)}`;
    rows.set(key, property);
  }
  return [...rows.values()];
}

export function bedroomGroup(input) {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 1) return 'unknown';
  return input >= 3 ? '3+' : String(input);
}

export function housingGroup(property) {
  if (property?.areaScope === 'listed_bedroom' || text(property?.roomLabel) || /合租/.test(text(property?.product))) return 'shared';
  return bedroomGroup(property?.bedrooms);
}

export function inventoryStatistics(properties, report = {}, geography = {}) {
  const records = mergeCollectedProperties(properties);
  const audit = new Map((report?.properties || []).map(row => [text(row.id), row]));
  const locations = new Map((geography?.properties || []).map(row => [text(row.id), row]));
  const businesses = new Set(), communities = new Set(), districts = new Set(), confirmedDistricts = new Set();
  const bedrooms = { '1': 0, '2': 0, '3+': 0, shared: 0, unknown: 0 };
  let businessUnknown = 0, communityUnknown = 0, districtUnknown = 0, districtPendingRecords = 0;
  for (const row of records) {
    const fields = audit.get(text(row.id))?.fields || {};
    const district = text(row.district || verifiedValue(fields.district));
    const geoBusiness = locations.get(text(row.id))?.businessDistrict;
    const business = text(verifiedValue(fields.businessArea) || (['confirmed', 'confirmed_existing_detail_read'].includes(geoBusiness?.status) ? geoBusiness.name : ''));
    const community = text(row.name || verifiedValue(fields.community));
    if (district) {
      districts.add(district);
      if (fields.district?.verified === true || row.districtConfidence === 'confirmed') confirmedDistricts.add(district);
      else districtPendingRecords++;
    } else districtUnknown++;
    if (business) businesses.add(business); else businessUnknown++;
    if (community) communities.add(`${district}|${community}`); else communityUnknown++;
    bedrooms[housingGroup(row)]++;
  }
  return { records, count: records.length, businesses: businesses.size, communities: communities.size,
    districts: districts.size, confirmedDistricts: confirmedDistricts.size,
    pendingDistricts: [...districts].filter(name => !confirmedDistricts.has(name)).length,
    bedrooms, businessUnknown, communityUnknown, districtUnknown, districtPendingRecords };
}
