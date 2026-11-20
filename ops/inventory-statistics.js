const value = field => field?.verified === true ? field.value : null;
const text = input => typeof input === 'string' ? input.trim() : '';

/** Only explicit, verified source fields enter the requested Beijing inventory. */
export function verifiedInventoryRecords(report) {
  if (report?.schemaVersion !== 1 || !Array.isArray(report.properties)) return [];
  const unique = new Map();
  for (const row of report.properties) {
    const fields = row?.fields || {};
    const id = text(row?.realListingId);
    const feature = value(fields.lingzhi);
    if (row?.status !== 'eligible' || !id || value(fields.listingId) !== id) continue;
    if (value(fields.city) !== '北京' || value(fields.rentalMode) !== '整租') continue;
    if (feature !== true && feature !== '灵之智能') continue;
    if (!unique.has(id)) unique.set(id, row);
  }
  return [...unique.values()];
}

export function bedroomGroup(input) {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 1) return 'unknown';
  return input >= 3 ? '3+' : String(input);
}

export function inventoryStatistics(report) {
  const records = verifiedInventoryRecords(report);
  const businesses = new Set(), communities = new Set(), districts = new Set();
  const bedrooms = { '1': 0, '2': 0, '3+': 0, unknown: 0 };
  let businessUnknown = 0, communityUnknown = 0, districtUnknown = 0;
  for (const row of records) {
    const fields = row.fields;
    const district = text(value(fields.district));
    const business = text(value(fields.businessArea));
    const community = text(value(fields.community));
    if (district) districts.add(district); else districtUnknown++;
    if (business && district) businesses.add(`${district}|${business}`); else businessUnknown++;
    if (community && district) communities.add(`${district}|${community}`); else communityUnknown++;
    bedrooms[bedroomGroup(value(fields.bedrooms))]++;
  }
  return { records, count: records.length, businesses: businesses.size, communities: communities.size,
    districts: districts.size, bedrooms, businessUnknown, communityUnknown, districtUnknown };
}
