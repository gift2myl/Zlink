const bedroomLabels = new Map([['1','1居'], ['2','2居'], ['3+','3居及以上'], ['shared','合租单间'], ['unknown','待分类']]);

function registerProperty(row, archived) {
  const p = row.property;
  const publicPhotos = row.publicPhotoUrls || [];
  const missing = [];
  if (!row.realListingId) missing.push('可核验的自如真实房源 ID 与对应详情链接');
  if (!row.floorplanCount) missing.push('与该套房唯一关联的实际户型图');
  if (!row.interiorPhotoCount) missing.push('与该套房唯一关联的室内照片');
  if (!row.referenceReady) missing.push('建模所需尺寸和空间对应关系');
  if (!row.businessVerified) missing.push('自如商圈归属');
  if (!row.deviceInstallationVerified) missing.push('该套房的设备实装清单与型号');
  if (!row.telemetryConnected) missing.push('设备最新状态与历史遥测');
  return {
    ...archived, id:row.id, recordKey:row.realListingId ? 'ziroom:'+row.realListingId : (archived?.recordKey || `record:${p.sourceBatchId || 'saved-map-list'}:${row.id}`),
    realListingId:row.realListingId || null, businessId:p.businessId || null, name:row.communityName, listingLabel:p.listingLabel || row.communityName,
    city:row.city, district:row.district || null, districtVerified:row.districtVerified,
    businessArea:row.businessVerified ? row.businessName : null, businessAreaVerified:row.businessVerified,
    businessAreaCandidate:row.businessCandidate || null, bedroomGroup:row.bedroomGroup, bedrooms:p.bedrooms ?? null,
    roomLabel:p.roomLabel || null, area:p.area ?? null, areaScope:p.areaScope || null, product:p.product || null,
    sourceUrl:p.sourceUrl || archived?.sourceUrl || null, sourceKind:p.sourceKind || archived?.sourceKind || null,
    sourcePages:Array.isArray(p.sourcePages) ? [...p.sourcePages] : [],
    firstSeen:archived?.firstSeen || p.firstSeen || row.observedAt || null,
    lastSeen:p.lastSeen || row.observedAt || archived?.lastSeen || null,
    currentAvailability:p.currentAvailabilityVerified === true && p.currentAvailabilityLabel ? p.currentAvailabilityLabel : 'unknown',
    retainedInCumulativeInventory:true, lingzhiFilterReturned:p.lingzhiFilterReturned ?? archived?.lingzhiFilterReturned ?? null,
    lingzhiLabelVisible:p.lingzhiLabelVisible ?? archived?.lingzhiLabelVisible ?? null,
    referenceStatus:row.referenceReady ? 'reference_ready' : 'needs_references',
    floorplanCount:row.floorplanCount, interiorPhotoCount:row.interiorPhotoCount, verifiedVRCount:row.vrVerified ? 1 : 0,
    publicFloorplanUrl:row.publicFloorplanUrl || null, publicPhotoUrls:publicPhotos, publicVrUrl:row.vrUrl || null,
    modelReady:row.referenceReady, geometryScope:row.referenceReady ? (archived?.geometryScope || 'reference_guided_approximation') : 'not_eligible_for_source_based_reconstruction',
    deviceInstallationVerified:row.deviceInstallationVerified, telemetryConnected:row.telemetryConnected, missing
  };
}

function groupsFor(properties, keyName, fallbackLabel, verificationField) {
  const groups = new Map();
  for (const p of properties) {
    const key = p[keyName] || '__unknown__';
    if (!groups.has(key)) groups.set(key,{key,label:p[keyName] || fallbackLabel,verified:false,count:0,propertyIds:[]});
    const group = groups.get(key);
    group.verified ||= Boolean(p[verificationField]);
    group.propertyIds.push(p.id);
    group.count++;
  }
  return [...groups.values()].sort((a,b) => Number(a.key==='__unknown__')-Number(b.key==='__unknown__') || a.label.localeCompare(b.label,'zh-CN'));
}

/** Build the original registry/export shape from the same rows used by the on-screen hierarchy. */
export function updatedRegistry(archivedRegistry, hierarchy, summary = {}, latestAttempt = null) {
  const archived = archivedRegistry || {};
  const archiveById = new Map((archived.properties || []).map(p => [p.id,p]));
  const archiveByListing = new Map((archived.properties || []).filter(p => p.realListingId).map(p => [String(p.realListingId),p]));
  const rows = hierarchy?.rows || [];
  const properties = rows.map(row => registerProperty(row,archiveById.get(row.id) || archiveByListing.get(row.realListingId)));
  const businesses = groupsFor(properties,'businessArea','商圈待核验','businessAreaVerified');
  const districts = groupsFor(properties,'district','行政区待补','districtVerified');
  const bedrooms = [...bedroomLabels].map(([key,label]) => {
    const propertyIds=properties.filter(p=>p.bedroomGroup===key).map(p=>p.id);
    return {key,label,count:propertyIds.length,propertyIds};
  });
  const observed = summary.publicationDate || hierarchy?.observedAt || null;
  const confirmedDistricts = districts.filter(group=>group.key!=='__unknown__' && group.verified).length;
  const districtCount = districts.filter(group=>group.key!=='__unknown__').length;
  const modelIds = rows.filter(row=>row.referenceReady).map(row=>row.id);
  const count = predicate => properties.filter(predicate).length;
  const hasSnapshot = Number.isInteger(summary.propertyCount) && summary.propertyCount>0;
  const verifiedIds = count(p=>Boolean(p.realListingId));
  const sourceEvidence = [...(archived.sourceEvidence || [])];
  if (hasSnapshot && !sourceEvidence.some(item=>item.file==='assets/public-inventory.json')) {
    sourceEvidence.push({file:'assets/public-inventory.json',observedAt:observed,sourceUrl:latestAttempt?.sourceUrl || null});
  }
  return {
    ...archived, schemaVersion:archived.schemaVersion || 1, builtAt:new Date().toISOString(),
    buildMode:'offline_saved_evidence', networkRequestsThisBuild:0, newNetworkAttemptPerformed:false,
    sourceScope:{...archived.sourceScope,city:'北京',cityCode:'110000',coverage:'partial_cumulative_collection',
      ...(hasSnapshot ? {listingUrl:latestAttempt?.sourceUrl || null,observedAt:observed,
        publicScope:'北京官网灵之智能筛选挂牌与本批已核实编号，按挂牌号合并。历史本地索引单独保留。'} : {})},
    countingRule:'按真实挂牌号去重，无法核对挂牌号的历史资料保留本地记录。送核编号仅在匹配官网挂牌后计入房源。',
    knownTotal:null,isFullInventory:false,
    totals:{
      collected:properties.length,currentCollected:summary.propertyCount ?? null,knownTotal:null,isFullInventory:false,
      businessAreas:businesses.filter(group=>group.verified).length,businessUnknown:properties.filter(p=>!p.businessAreaVerified).length,
      communities:hierarchy?.totals?.communities ?? new Set(rows.map(row=>row.communityKey)).size,
      districts:districtCount,confirmedDistricts,pendingDistricts:districtCount-confirmedDistricts,
      bedrooms:Object.fromEntries(bedrooms.map(group=>[group.key,group.count])),
      realListingIDs:verifiedIds,localRecordIDs:properties.length-verifiedIds,
      verifiedCurrentAvailability:count(p=>p.currentAvailability!=='unknown'),telemetryConnected:count(p=>p.telemetryConnected)
    },
    groups:{businessAreas:businesses,bedrooms,districts},propertyIDs:properties.map(p=>p.id),properties,
    referenceCoverage:{
      complete:modelIds.length,pending:properties.length-modelIds.length,referencePropertyIds:modelIds,
      floorplanFiles:rows.reduce((n,row)=>n+(row.localFloorplanCount || 0),0),
      interiorPhotoFiles:rows.reduce((n,row)=>n+(row.localInteriorPhotoCount || 0),0),
      officialFloorplanLinks:count(p=>Boolean(p.publicFloorplanUrl)),
      officialInteriorPhotoLinks:properties.reduce((n,p)=>n+p.publicPhotoUrls.length,0),
      propertiesWithFloorplan:count(p=>p.floorplanCount>0),verifiedVR:count(p=>p.verifiedVRCount>0),
      measuredLayouts:rows.filter(row=>row.property.measurementVerified===true).length,genericModelsCountAsActualLayouts:false
    },
    latestAttempt:latestAttempt || archived.latestAttempt || null, sourceEvidence,
    ...(hasSnapshot ? {publicSnapshot:{...summary},verificationNote:`送核 ${summary.checkCount} 个编号，匹配 ${summary.verifiedCount} 个，${summary.unmatchedCount} 个未返回挂牌。未匹配编号仅计入核验统计。`} : {})
  };
}
