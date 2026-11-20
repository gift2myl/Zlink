import {loadPlanPreview} from './listing-plan-preview.js';

// Extract only substantial, near-horizontal or vertical bands. Thin dimension lines and furniture
// outlines are excluded; uncertain outlines fall back to the source image.
function wallBands(mask, width, height, vertical) {
  const lines = vertical ? width : height, length = vertical ? height : width;
  const minSpan = Math.max(14, Math.round(Math.min(width, height) * .028));
  const finished = [], active = [];
  const close = band => {
    const thickness = band.last - band.first + 1;
    const a = Math.round(band.start / thickness), b = Math.round(band.end / thickness);
    if (thickness < 3 || thickness > length * .045 || b-a < Math.max(minSpan, thickness*2.8)) return;
    const center = (band.first+band.last)/2;
    finished.push(vertical ? [center,a,center,b,thickness] : [a,center,b,center,thickness]);
  };
  for (let y=1; y<lines-1; y++) {
    let first=-1;
    for (let x=1; x<length; x++) {
      const marked = x<length-1 && mask[vertical ? x*width+y : y*width+x];
      if (marked) { if (first<0) first=x; continue; }
      if (first<0) continue;
      const end=x-1;
      if (end-first>=minSpan) {
        const band=active.find(b=>b.last===y-1 && Math.abs(b.a-first)<=5 && Math.abs(b.b-end)<=5);
        if (band) {
          band.a=first;band.b=end;band.start+=first;band.end+=end;band.last=y;
        } else active.push({a:first,b:end,start:first,end,first:y,last:y});
      }
      first=-1;
    }
    for (let i=active.length-1;i>=0;i--) {
      if (active[i].last<y) close(active.splice(i,1)[0]);
    }
  }
  active.forEach(close);
  return finished;
}

// Horizontal opening removes vertical strokes before locating the center and thickness
// at each column. The transposed pass picks up walls interrupted by perpendicular joins.
function wallStrokes(mask,width,height,vertical) {
  const length=vertical?height:width,lines=vertical?width:height;
  const minSpan=Math.max(12,Math.round(Math.min(width,height)*.029));
  const opened=new Uint8Array(lines*length);
  for(let y=0;y<lines;y++){
    let start=0;
    for(let x=0;x<=length;x++){
      if(x<length && mask[vertical ? x*width+y : y*width+x])continue;
      if(x-start>=minSpan)opened.fill(1,y*length+start,y*length+x);
      start=x+1;
    }
  }
  const active=[],result=[];
  function finish(b){
    const span=b.last-b.first+1, thick=b.sumThickness/b.count,center=b.sumCenter/b.count;
    if(span<Math.max(minSpan,thick*3) || b.count/span<.85)return;
    result.push(vertical?[center,b.first,center,b.last,thick]:[b.first,center,b.last,center,thick]);
  }
  for(let x=0;x<length;x++){
    let start=0;
    for(let y=0;y<=lines;y++){
      if(y<lines && opened[y*length+x])continue;
      const thickness=y-start;
      if(thickness>=3 && thickness<=Math.min(width,height)*.037){
        const center=(start+y-1)/2;
        const band=active.find(b=>b.last<x && x-b.last<=3 && Math.abs(b.center-center)<=Math.min(3,thickness*.5) && Math.abs(b.sumCenter/b.count-center)<=3);
        if(band){
          band.last=x;band.center=center;band.sumCenter+=center;band.sumThickness+=thickness;band.count++;
        }else active.push({first:x,last:x,center,sumCenter:center,sumThickness:thickness,count:1});
      }
      start=y+1;
    }
    for(let i=active.length-1;i>=0;i--)if(x-active[i].last>3)finish(active.splice(i,1)[0]);
  }
  active.forEach(finish);
  return result;
}

export function traceWallPixels(pixels, width, height) {
  const mask=new Uint8Array(width*height);
  for(let i=0;i<mask.length;i++) {
    const r=pixels[4*i],g=pixels[4*i+1],b=pixels[4*i+2],high=Math.max(r,g,b);
    mask[i]=Number(high<163 && high-Math.min(r,g,b)<22 && pixels[4*i+3]>220);
  }
  const detect=(method,ratio)=>supportedWalls(method(mask,width,height,false),method(mask,width,height,true),width,height,ratio);
  const primary=detect(wallBands,2.2);
  return primary.length ? primary : detect(wallStrokes,1.55);
}

function supportedWalls(horizontal,vertical,width,height,minRatio) {
  if(horizontal.length<3 || vertical.length<3) return [];
  const all=[...horizontal,...vertical];
  if(all.length>450) return [];
  // A wall separated by a doorway can still have another substantially parallel or transverse
  // segment nearby. Drop isolated symbols (north arrow, dimension labels, scale bars).
  const tolerance=Math.max(12,Math.min(width,height)*.042);
  const bounds=all.map(([x,y,u,v])=>[Math.min(x,u),Math.min(y,v),Math.max(x,u),Math.max(y,v)]);
  const remaining=new Set(all.keys()),connected=[];
  while(remaining.size){
    const first=remaining.values().next().value;
    remaining.delete(first);
    const group=[first];
    for(let cursor=0;cursor<group.length;cursor++){
      const a=bounds[group[cursor]];
      for(const j of remaining){
        const b=bounds[j];
        if(Math.max(a[0]-b[2],b[0]-a[2],0)>tolerance || Math.max(a[1]-b[3],b[1]-a[3],0)>tolerance)continue;
        remaining.delete(j);group.push(j);
      }
    }
    // A north arrow's two connected strokes can mimic a tiny separate building.
    const reach=Math.max(Math.max(...group.map(j=>bounds[j][2]))-Math.min(...group.map(j=>bounds[j][0])),
      Math.max(...group.map(j=>bounds[j][3]))-Math.min(...group.map(j=>bounds[j][1])));
    if(group.length>=2 && reach>Math.min(width,height)*.12)connected.push(...group.map(j=>all[j]));
  }
  if(connected.length<8) return [];
  const xs=connected.flatMap(s=>[s[0],s[2]]),ys=connected.flatMap(s=>[s[1],s[3]]);
  const spanX=Math.max(...xs)-Math.min(...xs),spanY=Math.max(...ys)-Math.min(...ys);
  const total=connected.reduce((sum,[x,y,u,v])=>sum+Math.hypot(x-u,y-v),0);
  return spanX>width*.13 && spanY>height*.13 && total>minRatio*(spanX+spanY) ? connected : [];
}

// Room labels are read from this listing's original image. Coordinates share its aspect ratio.
export function previewRoomAnchors(preview, width, height) {
  return (preview?.labels || []).filter(a => typeof a.room==='string' &&
    Number.isFinite(a.x) && a.x>0 && a.x<1 && Number.isFinite(a.y) && a.y>0 && a.y<1)
    .map(a => ({room:a.room,x:a.x*width,y:a.y*height}));
}

function readWallGeometry(bitmap, span) {
  const ratio=span/Math.max(bitmap.width,bitmap.height);
  const width=Math.round(bitmap.width*ratio),height=Math.round(bitmap.height*ratio);
  const canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)return null;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(bitmap,0,0,width,height);
  const segments=traceWallPixels(ctx.getImageData(0,0,width,height).data,width,height);
  return segments.length ? {width,height,segments} : null;
}

const imageHosts=new Set(['imgpro.ziroom.com','smsimg.ziroom.com','home-decoration-cdn.ziroom.com']);
export async function traceListingPlan(property,{signal}={}) {
  if(!property || property.imported || !property.publicFloorplanUrl) return null;
  let media,source;
  try{media=new URL(property.publicFloorplanUrl);source=new URL(property.sourceUrl);}catch{return null;}
  const id=String(property.realListingId||property.id);
  if(!/^\d+$/.test(id) || source.protocol!=='https:' || source.hostname!=='www.ziroom.com' ||
     source.pathname!=='/x/'+id+'.html' || media.protocol!=='https:' || !imageHosts.has(media.hostname) ||
     media.port || media.username || media.password) return null;
  const controller=new AbortController();
  const cancel=()=>controller.abort();
  if(signal?.aborted) return null;
  signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,10000);
  let bitmap;
  try {
    const preview=await loadPlanPreview(property,{signal:controller.signal});
    const reviewed=preview?.reviewedGeometry;
    if(!controller.signal.aborted && reviewed && reviewed.width>0 && reviewed.height>0 && reviewed.segments?.length &&
      Math.abs(reviewed.width/reviewed.height-preview.width/preview.height)<.02){
      return {...reviewed,id,name:property.name,layout:property.layout,area:property.area,sourceUrl:source.href,
        image:media.href,originalUrl:media.href,previewData:preview.data,method:'reviewed',reviewed:true};
    }
    const reply=await fetch(preview?.data||media.href,{mode:'cors',credentials:'omit',signal:controller.signal});
    if(!reply.ok)return null;
    const blob=await reply.blob();
    if(blob.size>8e6 || !blob.type.startsWith('image/'))return null;
    bitmap=await createImageBitmap(blob);
    if(controller.signal.aborted || bitmap.width<180 || bitmap.height<160 || bitmap.width*bitmap.height>28e6)return null;
    const span=Math.min(800,Math.max(bitmap.width,bitmap.height));
    const geometry=readWallGeometry(bitmap,span) || (span<800 && readWallGeometry(bitmap,800));
    if(!geometry || controller.signal.aborted)return null;
    return {id,name:property.name,layout:property.layout,area:property.area,sourceUrl:source.href,
      image:media.href,originalUrl:media.href,previewData:preview?.data,...geometry,
      anchors:previewRoomAnchors(preview,geometry.width,geometry.height),method:'automatic',reviewed:false};
  } catch {return null;}
  finally {bitmap?.close();clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
