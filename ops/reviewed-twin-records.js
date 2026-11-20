// Bind each interactive apartment to the official listing, source raster, and reviewed room geometry.
export function attachReviewedTwins(properties, references, plans, evidence) {
  const audits=new Map((evidence?.properties || []).map(row=>[String(row.id),row]));
  const coverage=new Map(references.map(row=>[row.id,row]));
  for(const property of properties) {
    const {id}=property, plan=plans.get(id), audit=audits.get(id), record=coverage.get(id);
    if(!plan || !audit || !record || property.imported || !property.publicDetailVerified ||
       id!==property.realListingId || plan.id!==id || plan.name!==property.name || audit.name!==plan.name ||
       plan.sourceUrl!==property.sourceUrl || audit.sourceUrl!==plan.sourceUrl || audit.houseCode!==property.officialHouseCode ||
       plan.originalUrl!==property.publicFloorplanUrl || audit.planUrl!==plan.originalUrl ||
       audit.planSha256!==plan.imageSha256 || !/^[a-f0-9]{64}$/.test(plan.imageSha256) ||
       plan.layout!==audit.layout || property.layout!==audit.layout || Number(plan.area)!==audit.area ||
       property.area!==audit.area || plan.image!=='images/'+id+'.jpg' || !plan.segments?.length ||
       plan.width!==audit.sourceWidth || plan.height!==audit.sourceHeight || !plan.anchors?.length ||
       audit.roomCount!==plan.anchors.length || audit.rooms?.length!==audit.roomCount ||
       !plan.anchors.every((anchor,i)=>anchor.room===audit.rooms[i] && anchor.entry?.length===2) ||
       audit.vr?.listingId!==id || audit.vr.url!==property.publicVrUrl ||
       audit.vr.responseStatus!==200 || audit.vr.panoramaViewpointsPresent!==true)continue;
    const photos=audit.photos || [];
    const photoPath=new RegExp('^photos/'+id+'-[0-9]+\\.jpg$');
    const originals=new Set(audit.publicPhotoUrls);
    if(!photos.length || !photos.every(photo=>photoPath.test(photo.thumbnail) && originals.has(photo.url) &&
       /^[a-f0-9]{64}$/.test(photo.thumbnailSha256) && /^[a-f0-9]{64}$/.test(photo.sourceSha256)))continue;
    const sourceUrl=plan.sourceUrl;
    const assets=[{kind:'floorplan',content:'户型图',sourceUrl,originalUrl:plan.originalUrl,file:'assets/plan-references/'+plan.image},
      ...photos.map(photo=>({kind:'interior_photo',content:photo.room||photo.label||'室内实景',sourceUrl,originalUrl:photo.url,file:'assets/plan-references/'+photo.thumbnail}))];
    property.reviewedRoomDemo=true;
    property.modelReady=true;
    Object.assign(record,{status:'reference_ready',modelReady:true,assets,floorplanCount:1,interiorPhotoCount:photos.length,
      sourceObservedAt:evidence.verifiedOn,confirmedDetailUrl:sourceUrl,missing:['现场实测尺寸','设备实装清单与实时遥测'],
      roomEvidence:{verifiedOn:evidence.verifiedOn,houseCode:audit.houseCode,planSha256:audit.planSha256,
        layout:audit.layout,area:audit.area,areaLabel:audit.areaLabel,sourceUrl,originalFloorplan:plan.originalUrl,
        sourceImagePixels:[plan.width,plan.height],rooms:[...audit.rooms],
        roomEntries:plan.anchors.map(({room,entry})=>({room,imagePixels:[...entry]})),
        referenceFixtures:(plan.fixtures || []).map(({kind,room,bounds})=>({kind,room,imagePixelBounds:bounds})),
        interiorPhotos:photos.map(({room,area,url,sourceSha256})=>({room,area,url,sourceSha256})),
        vrUrl:audit.vr.url,geometry:'由本套官网户型原图描绘',installedDevicesVerified:false,telemetryConnected:false}});
  }
}
