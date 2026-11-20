const rows = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.trim() : '';
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
const field = value => ({ value: value ?? null, verified: value !== undefined && value !== null && value !== '' });

function officialUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
        (url.hostname === 'ziroom.com' || url.hostname.endsWith('.ziroom.com'))) return url;
  } catch {}
  return null;
}

function identity(row) {
  const id = text(row?.id);
  const url = officialUrl(row?.detailUrl);
  return /^\d+$/.test(id) && url?.pathname === `/x/${id}.html` ? id : null;
}

function checkedVr(check, id) {
  const url = officialUrl(check?.vrUrl);
  const ids = url?.searchParams.getAll('inv_no') || [];
  return url?.hostname === 'metaverse.ziroom.com' && ids.length && ids.every(value => value === id) ? url.href : null;
}

function checkedPhotos(check) {
  const urls = new Set();
  for (const photo of rows(check?.photos)) {
    const url = officialUrl(photo);
    if (url?.hostname === 'imgpro.ziroom.com' && url.href !== check.planUrl) urls.add(url.href);
  }
  return [...urls];
}

function listingProperty(id, listing, check, date) {
  const name = text(check?.community) || text(listing?.community);
  const layout = text(check?.layout);
  const bedrooms = positive(listing?.bedrooms) || positive(Number(layout.match(/^(\d+)室/)?.[1]));
  const roomLabel = text(listing?.roomLabel) || null;
  const areaText = text(listing?.area);
  const cardArea = Number(areaText.match(/^约?([\d.]+)\s*㎡$/)?.[1]);
  const floors = (text(check?.floor) || text(listing?.floor)).match(/^(-?\d+)\s*\/\s*(\d+)层?$/);
  const transit = text(listing?.transit);
  const station = transit.match(/^距.+?线(?:[（(][^)）]*[)）])?(.+?)站步行约(\d+)米$/);
  const tags = rows(listing?.tags);
  const product = tags.find(tag => /心舍|灵之智能|曼舍|友家|理想家/.test(tag));
  const explicit = listing?.explicit === true || check?.explicit === true;
  const district = text(check?.district).replace(/区$/, '');
  const sourceUrl = check?.detailUrl || listing.detailUrl;
  return {
    id, realListingId: id, idType: 'ziroom_property_id', businessId: text(check?.code) || null,
    name, listingLabel: text(listing?.title) || [name, layout].filter(Boolean).join(' · '),
    city: '北京', district: district || null, districtConfidence: district ? 'confirmed' : null,
    businessArea: text(check?.business) || null, layout: layout || null, bedrooms, roomLabel,
    area: positive(check?.area) || positive(cardArea), areaDisplay: areaText || null,
    areaScope: roomLabel ? 'listed_bedroom' : 'listed_property', bedroomsScope: 'entire_property',
    floor: floors ? Number(floors[1]) : null, totalFloors: floors ? Number(floors[2]) : null,
    orientation: (text(check?.orientation) || text(listing?.orientation)).replace(/^朝/, '') || null,
    station: station?.[1] || null, distance: station ? Number(station[2]) : null, transit: transit || null,
    product: product || null, tags: [...tags], availability: [...rows(listing?.availability)],
    sourcePages: [...rows(listing?.sourcePages)], sourceKind: listing ? 'public_filtered_listing' : 'verified_public_detail',
    sourceUrl, sourceUrlType: 'official_detail', observedAt: date, sourceObservedAt: date,
    lingzhiFilterReturned: Boolean(listing), lingzhiLabelVisible: explicit,
    labelNote: explicit ? '官网房源卡片明示灵之智能' : listing ? '北京灵之智能筛选列表收录，卡片未明示标签' : '编号与官网详情已核实，未见灵之智能标签',
    publicFloorplanUrl: officialUrl(check?.planUrl)?.href || null, publicVrUrl: checkedVr(check, id),
    publicPhotoUrls: checkedPhotos(check),
    modelReady: false, deviceInstallationVerified: false, telemetryConnected: false, coordinate: null
  };
}

function auditRow(p) {
  return {
    id: p.id, realListingId: p.id, name: p.name, sourceUrl: p.sourceUrl, sourceObservedAt: p.observedAt,
    currentAvailabilityVerified: false,
    fields: {
      city: field(p.city), listingId: field(p.id), community: field(p.name), district: field(p.district),
      businessArea: field(p.businessArea), bedrooms: field(p.bedrooms), lingzhi: field(p.lingzhiLabelVisible ? true : null)
    }
  };
}

function referenceRow(p) {
  return {
    id: p.id, realListingId: p.id, name: p.name, idType: p.idType, sourceUrl: p.sourceUrl,
    confirmedDetailUrl: p.sourceUrl, sourceObservedAt: p.observedAt,
    publicFloorplanUrl: p.publicFloorplanUrl, publicVrUrl: p.publicVrUrl, publicPhotoUrls: [...p.publicPhotoUrls],
    vr: p.publicVrUrl ? { realListingId: p.id, verified: true, url: p.publicVrUrl } : null,
    status: 'needs_references', modelReady: false, measurementVerified: false,
    floorplanCount: Number(Boolean(p.publicFloorplanUrl)), interiorPhotoCount: 0, assets: [],
    missing: [p.publicFloorplanUrl ? '本地建模素材与尺寸核验' : '本套房源的原始户型图、照片及尺寸核验', '本套设备的实装位置与型号']
  };
}

/** Join the official filtered list and the supplied identifier checks on the public detail-page identity. */
export function projectPublicInventory(snapshot, communityMap = {}, availability = {}, listingFacts = {}) {
  const publicationDate = text(snapshot?.date) || null;
  const listings = new Map();
  for (const row of rows(snapshot?.listings)) {
    const id = identity(row);
    if (id && text(row.community)) listings.set(id, row);
  }

  const checks = new Map();
  for (const row of rows(snapshot?.checks)) {
    const code = text(row?.code);
    if (!code) continue;
    if (row.status === 'verified' && identity(row) && text(row.community)) checks.set(code, row);
    else if (row.status === 'unmatched' && !checks.has(code)) checks.set(code, row);
  }
  const verified = [...checks.values()].filter(row => row.status === 'verified');
  const byId = new Map(verified.map(row => [row.id, row]));
  const allIds = new Set([...listings.keys(), ...byId.keys()]);
  const unavailable = new Map(rows(availability?.unavailable).map(row => [String(row.id),row.url]));
  const factsById = new Map(rows(listingFacts?.properties).map(row => [String(row.id),row]));
  const mapped = new Map(rows(communityMap.properties).map(row => [String(row.id), row]));
  const properties = [...allIds].map(id => {
    const p = listingProperty(id, listings.get(id), byId.get(id), publicationDate);
    const geo = mapped.get(id);
    if (!geo) {
      if (unavailable.get(id) === p.publicFloorplanUrl) p.publicFloorplanUrl = null;
      return p;
    }
    const bound = geo.publicDetailVerified === true && identity({id,detailUrl:geo.sourceUrl}) === id;
    if (bound) {
      p.publicDetailVerified = true;
      const facts = factsById.get(id);
      if (facts && facts.sourceUrl === geo.sourceUrl) {
        p.officialHouseCode = text(facts.houseCode) || null;
        p.layout ||= text(facts.layout) || null;
        p.orientation ||= text(facts.orientation).replace(/^朝/, '') || null;
        if (p.floor == null && Number.isInteger(facts.floor) && positive(facts.totalFloors)) {
          p.floor = facts.floor;
          p.totalFloors = facts.totalFloors;
        }
      }
      p.name = text(geo.name) || p.name;
      p.publicFloorplanUrl = officialUrl(geo.publicFloorplanUrl)?.href || p.publicFloorplanUrl;
      p.publicVrUrl ||= checkedVr({vrUrl:geo.publicVrUrl}, id);
    }
    if (unavailable.get(id) === p.publicFloorplanUrl) p.publicFloorplanUrl = null;
    p.communityId = text(geo.communityId);
    if (text(geo.district)) {
      p.district = text(geo.district).replace(/区$/, '');
      p.districtConfidence = 'confirmed';
    }
    if (geo.businessDistrict?.status === 'confirmed') p.businessArea = text(geo.businessDistrict.name) || p.businessArea;
    return p;
  });
  const locations = properties.flatMap(p => {
    const geo = mapped.get(p.id);
    if (geo) return [{...geo, id:p.id, realListingId:p.id}];
    return p.businessArea ? [{id:p.id,realListingId:p.id,name:p.name,district:p.district,coordinate:null,
      matchType:'unmatched',isExactPropertyLocation:false,reviewedAt:publicationDate,
      businessDistrict:{status:'confirmed',name:p.businessArea,sourceUrl:p.sourceUrl}}] : [];
  });
  return {
    properties, audits: properties.map(auditRow), references: properties.map(referenceRow), locations,
    source: {
      url: 'https://www.ziroom.com/z/z0-q1308471230679097345-a1308470925672038401/?p=x63', city: '北京', cityCode: '110000',
      filter: '北京 · 租住方式不限 · 灵之智能', observedAt: publicationDate,
      isFullInventory: false, isDemoGeneratedData: false
    },
    summary: {
      publicationDate, listingCount: listings.size, explicitListingCount: [...listings.values()].filter(row => row.explicit === true).length,
      checkCount: checks.size, verifiedCount: verified.length, unmatchedCount: checks.size - verified.length,
      overlapCount: [...byId.keys()].filter(id => listings.has(id)).length, propertyCount: properties.length,
      floorplanCount: properties.filter(p => p.publicFloorplanUrl).length, vrCount: properties.filter(p => p.publicVrUrl).length,
      publicPhotoCount: properties.reduce((sum, p) => sum + p.publicPhotoUrls.length, 0),
      photoPropertyCount: properties.filter(p => p.publicPhotoUrls.length > 0).length,
      pages: Number.isInteger(snapshot?.pages) ? snapshot.pages : 0
    }
  };
}
