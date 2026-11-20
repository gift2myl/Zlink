import { buildDeviceConfiguration, CONFIG_PROFILES } from './device-configuration.js';

const indexUrl = new URL('./assets/plan-references/index.json', import.meta.url);
const live = new WeakMap();
let indexRequest;
const types = {
  light: ['照明', '灯', '#ae601d'], sensor: ['传感器', '感', '#28765b'],
  gateway: ['网关', '网', '#24649c'], control: ['面板', '控', '#7453a0'],
  lock: ['门锁', '锁', '#4c6375'], other: ['设备', '设', '#406d77']
};
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (value,min,max) => Math.max(min,Math.min(value,max));
const numeric = value => typeof value === 'number' && Number.isFinite(value);

export function loadListingPlanIndex() {
  if (!indexRequest) indexRequest=fetch(indexUrl).then(async response=>{
    if (!response.ok) throw Error('逐套户型索引暂时不可用');
    const {plans}=await response.json();
    if (!Array.isArray(plans)) throw Error('户型索引格式无效');
    return new Map(plans.filter(p=>/^\d+$/.test(String(p.id))).map(p=>[String(p.id),p]));
  }).catch(error=>{indexRequest=null;throw error;});
  return indexRequest;
}

function official(value) {
  try {
    const url=new URL(value);
    return url.protocol==='https:' && !url.username && !url.password && !url.port && /(^|\.)ziroom\.com$/.test(url.hostname) ? url : null;
  } catch { return null; }
}

function sameListing(value,id) {
  const url=official(value);
  return url && /^\d+$/.test(id) && url.pathname===`/x/${id}.html`;
}

function officialImage(value) {
  const url=official(value);
  return url && ['imgpro.ziroom.com','smsimg.ziroom.com','home-decoration-cdn.ziroom.com'].includes(url.hostname) &&
    /\.(jpe?g|png|webp)$/i.test(url.pathname) && !/(?:^|\/)(?:default|placeholder|nopic|no[_-]?(?:image|pic))[^/]*\./i.test(url.pathname) ? url.href : '';
}

function mediaFor(property,plan,id) {
  const matched=!property.imported && sameListing(property.sourceUrl,id);
  const vr=matched ? official(property.publicVrUrl) : null;
  const queryIds=vr?.searchParams.getAll('inv_no') || [];
  return {
    image:officialImage(plan?.originalUrl) || (matched ? officialImage(property.publicFloorplanUrl) : ''),
    vr:vr?.hostname==='metaverse.ziroom.com' && queryIds.length && queryIds.every(v=>v===id) ? vr.href : '',
    page:matched ? property.sourceUrl : plan?.sourceUrl || ''
  };
}

function sourceLinks(media) {
  return [[media.image,'官网户型原图'],[media.vr,'官网 VR'],[media.page,'官网房源详情']].filter(([url])=>url)
    .map(([url,name])=>`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${name} ↗</a>`).join('');
}

function validPlan(plan,id) {
  return plan && String(plan.id)===id && sameListing(plan.sourceUrl,id) && numeric(plan.width) && numeric(plan.height) &&
    plan.width>0 && plan.height>0 && Array.isArray(plan.segments) && plan.segments.some(s=>Array.isArray(s)&&s.length>=4&&s.slice(0,4).every(numeric));
}

function localImage(plan) {
  const url=new URL(plan.image || '',indexUrl);
  if(url.origin!==indexUrl.origin || !url.pathname.startsWith(new URL('./',indexUrl).pathname) || !/\.(png|webp|jpe?g)$/i.test(url.pathname)) throw Error('户型底图路径无效');
  return url.href;
}

function encodedPreview(value) {
  return typeof value==='string' && /^data:image\/(?:webp|jpeg);base64,/i.test(value) ? value : '';
}

async function decodeSource(url,signal,cors=false) {
  if(signal.aborted || !url)return null;
  const img=new Image();
  if(cors)img.crossOrigin='anonymous';
  const cancel=()=>{img.removeAttribute('src');};
  const timeout=setTimeout(cancel,10000);
  signal.addEventListener('abort',cancel,{once:true});
  try {
    img.src=url;await img.decode();
    return !signal.aborted && img.naturalWidth>=80 && img.naturalHeight>=80 ? img : null;
  } catch {return null;}
  finally{clearTimeout(timeout);signal.removeEventListener('abort',cancel);}
}

async function matchedPreview(property,url,signal) {
  try {
    const {loadPlanPreview}=await import('./listing-plan-preview.js');
    const preview=await loadPlanPreview(property,{signal});
    return officialImage(preview?.url)===url && encodedPreview(preview?.data) ? preview : null;
  } catch {return null;}
}

function roomId(value) {
  const room=String(value ?? '').trim().toLowerCase();
  if (/^bedroom(?:[-_ ]?[1-9])?$/.test(room)) {
    const n=room.match(/\d+$/)?.[0];return !n || n==='1' ? 'bedroom' : 'bedroom-'+n;
  }
  if(/卧室|主卧|次卧|卧房/.test(room)) {
    const n=room.match(/\d+/)?.[0];
    if(n) return Number(n)===1?'bedroom':'bedroom-'+Number(n);
    if(/二|次卧|[bB]/.test(room)) return 'bedroom-2';
    if(/三|[cC]/.test(room)) return 'bedroom-3';
    return 'bedroom';
  }
  if(/客厅|客餐厅|起居|living/.test(room)) return 'living';
  if(/玄关|门厅|入户|entry|entrance/.test(room)) return 'entry';
  if(/厨房|kitchen/.test(room)) return 'kitchen';
  if(/卫生间|浴室|bath/.test(room)) return 'bathroom';
  return room;
}

function markerType(device) {
  const id=device.catalogId;
  if(/sensor/.test(id)) return 'sensor';
  if(/max\d|gateway/.test(id)) return 'gateway';
  if(/door-lock/.test(id)) return 'lock';
  if(device.category==='场景光照') return 'light';
  if(device.category==='灵动控制') return 'control';
  return 'other';
}

function deviceGroups(property,plan,profile,configurationOptions) {
  const anchors=new Map();
  for(const a of plan.anchors || []){
    if(!numeric(a.x)||!numeric(a.y)||a.x<0||a.x>plan.width||a.y<0||a.y>plan.height)continue;
    const key=roomId(a.room);
    // Repeated room names without a unique identity cannot locate one device.
    if(anchors.has(key)){anchors.set(key,null);continue;}
    anchors.set(key,a);
  }
  const config=buildDeviceConfiguration(property,{...configurationOptions,profile});
  const groups=new Map();
  for (const item of config.devices) {
    const key=item.roomId+'--'+item.catalogId;
    if(!groups.has(key)) groups.set(key,{item,type:markerType(item),anchor:anchors.get(item.roomId),quantity:0});
    groups.get(key).quantity+=item.quantity;
  }
  return {config,groups:[...groups.values()]};
}

// Remove only the exterior light background connected to the raster edges. Keep the original inside the outline.
function textureCanvas(image,plan) {
  const canvas=document.createElement('canvas');
  canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const outline=Array.isArray(plan.outline)?plan.outline.filter(p=>Array.isArray(p) && numeric(p[0]) && numeric(p[1])):[];
  if(outline.length>=3){
    ctx.save();ctx.beginPath();
    for(const [i,[x,y]] of outline.entries()){
      const px=x*canvas.width/plan.width,py=y*canvas.height/plan.height;
      if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
    }
    ctx.closePath();ctx.clip();ctx.drawImage(image,0,0);ctx.restore();
    return canvas;
  }
  ctx.drawImage(image,0,0);
  const frame=ctx.getImageData(0,0,canvas.width,canvas.height),px=frame.data,w=canvas.width,h=canvas.height;
  const queue=new Int32Array(w*h), seen=new Uint8Array(w*h);
  let head=0,tail=0;
  function add(i) {
    if(seen[i])return;
    seen[i]=1;const k=i*4;
    if(px[k+3] && Math.min(px[k],px[k+1],px[k+2])<241)return;
    px[k+3]=0;queue[tail++]=i;
  }
  for(let x=0;x<w;x++){add(x);add((h-1)*w+x);}
  for(let y=0;y<h;y++){add(y*w);add(y*w+w-1);}
  while(head<tail){
    const i=queue[head++],x=i%w;
    if(x>0)add(i-1);if(x<w-1)add(i+1);if(i>=w)add(i-w);if(i+w<w*h)add(i+w);
  }
  ctx.putImageData(frame,0,0);return canvas;
}

function getBounds(plan) {
  const lines=plan.segments.filter(s=>Array.isArray(s)&&s.length>=4&&s.slice(0,4).every(numeric));
  let minX=plan.width,maxX=0,minY=plan.height,maxY=0;
  for(const [x1,y1,x2,y2] of lines){minX=Math.min(minX,x1,x2);maxX=Math.max(maxX,x1,x2);minY=Math.min(minY,y1,y2);maxY=Math.max(maxY,y1,y2);}
  const width=Math.max(1,maxX-minX),height=Math.max(1,maxY-minY);
  return {lines,cx:(maxX+minX)/2,cy:(maxY+minY)/2,width,height};
}

// Fit the drawing on the opening 2D view, keeping its full image available when panning.
function imageBounds(img) {
  const width=img.naturalWidth,height=img.naturalHeight;
  const full={width,height,cx:width/2,cy:height/2};
  const ratio=Math.min(1,320/Math.max(width,height)),w=Math.round(width*ratio),h=Math.round(height*ratio);
  const scratch=document.createElement('canvas');scratch.width=w;scratch.height=h;
  try {
    const ctx=scratch.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(img,0,0,w,h);
    const pixels=ctx.getImageData(0,0,w,h).data,cols=new Uint16Array(w),rows=new Uint16Array(h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const k=(y*w+x)*4;
      if(pixels[k+3]>160 && Math.min(pixels[k],pixels[k+1],pixels[k+2])<210){cols[x]++;rows[y]++;}
    }
    // A detached compass or logo should not shift the floor plan off-centre on narrow screens.
    function mainSpan(counts,threshold) {
      let best=null,group=null;
      for(let i=0;i<counts.length;i++){
        if(counts[i]<threshold)continue;
        if(!group || i-group.last>counts.length*.07)group={first:i,last:i,mass:0};
        group.last=i;group.mass+=counts[i];
        if(!best || group.mass>best.mass)best=group;
      }
      return best && best.last-best.first>=10 ? best : null;
    }
    const xs=mainSpan(cols,Math.max(4,h*.065)),ys=mainSpan(rows,Math.max(4,w*.045));
    if(!xs || !ys)return full;
    const left=xs.first/ratio,right=(xs.last+1)/ratio,top=ys.first/ratio,bottom=(ys.last+1)/ratio;
    return{width:(right-left)*1.10,height:(bottom-top)*1.10,cx:(left+right)/2,cy:(top+bottom)/2};
  }catch{return full;} // The browser may display an official cross-origin image while withholding pixels.
}

function create2d(canvas,plan,bounds,image,onMove) {
  const ctx=canvas.getContext('2d');
  const events=new AbortController(),opts={signal:events.signal};
  const touches=new Map();
  let viewport={w:1,h:1},zoom=1,scale=1,dx=0,dy=0;
  function project(x,y) {return [(x-bounds.cx)*scale+viewport.w/2+dx,(y-bounds.cy)*scale+viewport.h/2+dy];}
  function draw() {
    const {w,h}=viewport,dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    scale=Math.min((w-56)/bounds.width,(h-54)/bounds.height)*zoom;
    const [left,top]=project(0,0);
    ctx.drawImage(image,left,top,plan.width*scale,plan.height*scale);
    onMove(project);
  }
  function magnify(factor,cx=viewport.w/2,cy=viewport.h/2){
    const next=clamp(zoom*factor,.6,3),k=next/zoom;
    dx=(dx+viewport.w/2-cx)*k+cx-viewport.w/2;
    dy=(dy+viewport.h/2-cy)*k+cy-viewport.h/2;
    zoom=next;draw();
  }
  canvas.addEventListener('wheel',e=>{e.preventDefault();const box=canvas.getBoundingClientRect();magnify(e.deltaY<0?1.12:1/1.12,e.clientX-box.left,e.clientY-box.top);},{...opts,passive:false});
  canvas.addEventListener('pointerdown',e=>{touches.set(e.pointerId,[e.clientX,e.clientY]);canvas.setPointerCapture(e.pointerId);},opts);
  canvas.addEventListener('pointermove',e=>{
    const prev=touches.get(e.pointerId);if(!prev)return;
    const other=[...touches.entries()].find(([id])=>id!==e.pointerId)?.[1];
    touches.set(e.pointerId,[e.clientX,e.clientY]);
    if(other){const old=Math.hypot(prev[0]-other[0],prev[1]-other[1]);if(old>2){const box=canvas.getBoundingClientRect();magnify(Math.hypot(e.clientX-other[0],e.clientY-other[1])/old,(e.clientX+other[0])/2-box.left,(e.clientY+other[1])/2-box.top);}}
    else {dx+=e.clientX-prev[0];dy+=e.clientY-prev[1];draw();}
  },opts);
  canvas.addEventListener('lostpointercapture',e=>touches.delete(e.pointerId),opts);
  return {resize(w,h){viewport={w,h};draw();},reset(){zoom=1;dx=0;dy=0;draw();},
    zoom:magnify,draw,destroy(){events.abort();touches.clear();}};
}

async function create3d(canvas,plan,bounds,raster,onMove) {
  const [T,{OrbitControls}]=await Promise.all([import('three'),import('three/addons/controls/OrbitControls.js')]);
  const renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'low-power'});
  const scene=new T.Scene(),camera=new T.OrthographicCamera(-7,7,7,-7,.05,130);
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setClearColor(0x000000,0);
  renderer.outputColorSpace=T.SRGBColorSpace;
  const unit=10/Math.max(bounds.width,bounds.height),wallHeight=.68;
  const toX=x=>(x-bounds.cx)*unit,toZ=y=>(y-bounds.cy)*unit;
  const texture=new T.CanvasTexture(raster);texture.colorSpace=T.SRGBColorSpace;
  const planeGeometry=new T.PlaneGeometry(plan.width*unit,plan.height*unit);
  const planeMaterial=new T.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.03,depthWrite:false,side:T.DoubleSide});
  const base=new T.Mesh(planeGeometry,planeMaterial);
  base.rotation.x=-Math.PI/2;base.position.set(toX(plan.width/2),-.003,toZ(plan.height/2));scene.add(base);
  const box=new T.BoxGeometry(1,1,1);
  const sides=new T.MeshLambertMaterial({color:0xbdc9ca}),ends=new T.MeshLambertMaterial({color:0xa7b5b6});
  const top=new T.MeshLambertMaterial({color:0x455e67});
  const walls=new T.InstancedMesh(box,[ends,ends,top,sides,sides,sides],bounds.lines.length);
  const matrix=new T.Object3D();
  for(const [i,s] of bounds.lines.entries()){
    const [x1,y1,x2,y2,t]=s,dx=(x2-x1)*unit,dz=(y2-y1)*unit;
    matrix.position.set(toX((x1+x2)/2),wallHeight/2,toZ((y1+y2)/2));
    matrix.rotation.y=-Math.atan2(dz,dx);
    matrix.scale.set(Math.max(.015,Math.hypot(dx,dz)),wallHeight,clamp((numeric(t)?t:3)*unit,.03,.18));
    matrix.updateMatrix();walls.setMatrixAt(i,matrix.matrix);
  }
  walls.computeBoundingSphere();scene.add(walls);
  scene.add(new T.HemisphereLight(0xffffff,0x879ba6,1.6));
  const sun=new T.DirectionalLight(0xfffbef,1.4);sun.position.set(-4,12,9);scene.add(sun);
  const controls=new OrbitControls(camera,canvas);
  controls.enableDamping=false;controls.enablePan=true;controls.maxPolarAngle=Math.PI*.46;controls.minPolarAngle=.001;
  controls.minZoom=.55;controls.maxZoom=4;
  let width=1,height=1,dead=false;
  const vector=new T.Vector3();
  function draw() {
    if(dead)return;
    renderer.render(scene,camera);
    onMove((x,y)=>{vector.set(toX(x),wallHeight*.5,toZ(y)).project(camera);return[(vector.x*.5+.5)*width,(.5-vector.y*.5)*height];});
  }
  function reset(topView=false) {
    controls.target.set(0,wallHeight*.4,0);camera.zoom=1;
    camera.position.set(...(topView?[0,26,.01]:[9,17,13]));camera.lookAt(controls.target);
    controls.update();fit();draw();
  }
  function fit() {
    const aspect=width/height,x=bounds.width*unit/2,z=bounds.height*unit/2;
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    camera.updateMatrixWorld();
    for(const a of [-x,x])for(const b of [-z,z])for(const y of [0,wallHeight]){
      vector.set(a,y,b).applyMatrix4(camera.matrixWorldInverse);
      minX=Math.min(minX,vector.x);maxX=Math.max(maxX,vector.x);
      minY=Math.min(minY,vector.y);maxY=Math.max(maxY,vector.y);
    }
    const half=Math.max((maxY-minY)*.59,(maxX-minX)*.59/aspect,.6);
    camera.top=half;camera.bottom=-half;camera.left=-half*aspect;camera.right=-camera.left;
    camera.updateProjectionMatrix();
  }
  controls.addEventListener('change',draw);
  reset();
  return {
    resize(w,h){width=w;height=h;renderer.setSize(w,h,false);fit();draw();},
    reset,zoom(factor){camera.zoom=clamp(camera.zoom*factor,controls.minZoom,controls.maxZoom);camera.updateProjectionMatrix();draw();},draw,
    destroy(){dead=true;controls.removeEventListener('change',draw);controls.dispose();walls.dispose();box.dispose();sides.dispose();ends.dispose();top.dispose();planeGeometry.dispose();planeMaterial.dispose();texture.dispose();renderer.dispose();renderer.forceContextLoss();}
  };
}

export function mountListingPlanViewer(container,{property,plan:givenPlan,profile='base',configurationOptions={}}={}) {
  if(!container || !property) throw new TypeError('需要查看器容器和房源记录');
  live.get(container)?.destroy();
  const controller=new AbortController(),{signal}=controller;
  const id=String(property.realListingId || property.id || '');
  let engine=null,observer=null,epoch=0,mode='3d',failed3d=false;
  let config,groups=[],selected=-1,plan,raster,original,bounds,ui,automatic=false,imageOnly=false;
  let activeCanvas=null,resourceLost=null,renderConfiguration=null;
  const shell=document.createElement('section');
  shell.className='lpv';shell.setAttribute('aria-label','本套房源户型与配置点位');
  container.replaceChildren(shell);
  const find=selector=>shell.querySelector(selector);
  const title=escape(property.name || property.listingLabel || '房源');
  shell.innerHTML=`<p class="lpv-message" role="status">正在载入${title}的户型资料…</p>`;

  function clearEngine() {
    if(activeCanvas && resourceLost)activeCanvas.removeEventListener('webglcontextlost',resourceLost);
    resourceLost=null;activeCanvas=null;
    engine?.destroy();engine=null;
  }
  function destroy() {
    if(signal.aborted)return;
    controller.abort();epoch++;observer?.disconnect();clearEngine();
    if(live.get(container)===api)live.delete(container);
    shell.remove();
  }
  function fallback(reason,retry=false) {
    const media=mediaFor(property,plan,id);
    shell.innerHTML=`<header class="lpv-heading"><h3>${title} · 户型与设备</h3></header><p class="lpv-message" role="status">${escape(reason)}</p>
      <div class="lpv-sources">${sourceLinks(media)}${retry?'<button type="button" data-retry>重新载入</button>':''}</div>
      <div class="lpv-config"><label>配置方案<select data-profile>${CONFIG_PROFILES.filter(p=>['base','plus','upgrade'].includes(p.id)).map(p=>`<option value="${p.id}">${escape(p.label)}</option>`).join('')}</select></label>
      <label>方案设备<select data-devices></select></label><span class="lpv-count"></span></div><div class="lpv-info" aria-live="polite"></div>`;
    const choice=find('[data-profile]');
    if(!['base','plus','upgrade'].includes(profile))profile='base';
    choice.value=profile;
    ui={select:find('[data-devices]'),info:find('.lpv-info'),marks:document.createElement('div')};
    const fill=()=>{
      profile=choice.value;
      ({groups,config}=deviceGroups(property,{anchors:[]},profile,configurationOptions));
      ui.select.innerHTML=groups.map(({item,quantity},i)=>`<option value="${i}">${escape(item.roomName)} · ${escape(item.name)} × ${quantity}</option>`).join('');
      ui.select.disabled=!groups.length;
      find('.lpv-count').textContent=`规划 ${config.summary.plannedDeviceCount} 件 · 位置待核验`;
      showSelection(0);
    };
    renderConfiguration=fill;
    choice.addEventListener('change',fill,{signal});
    ui.select.addEventListener('change',()=>showSelection(Number(ui.select.value)),{signal});
    fill();
    find('[data-retry]')?.addEventListener('click',()=>{
      const retryView=mountListingPlanViewer(container,{property,plan:givenPlan,profile,configurationOptions});
      api.ready=retryView.ready;
      api.destroy=()=>retryView.destroy();
      api.setConfigurationOptions=options=>retryView.setConfigurationOptions(options);
    },{once:true,signal});
  }
  function showSelection(index) {
    selected=index;
    const group=groups[index];
    if(!group){ui.info.textContent='本套暂无可展开的规划设备。';return;}
    const {item,quantity,anchor}=group,source=item.configurationSource;
    ui.select.value=String(index);
    ui.info.innerHTML=`<div><strong>${escape(item.name)}</strong> <span>${escape(item.roomName)} · 规划 ${quantity} 件</span></div>
      <div><span>型号</span> ${escape(item.model)}${item.specification?' · '+escape(item.specification):''}</div>
      <div><span>配置依据</span> ${escape(source.title)} · 第 ${escape(source.pages.join('、'))} 页</div>
      <div>${anchor ? (automatic || imageOnly ? '原图房间标注为「'+escape(anchor.room)+'」，具体安装位置待核验。' : '房间内为方案示意位置，实际安装与状态待核验。') : '原图尚未定位该房间，设备仅列入规划清单。'}</div>`;
    for(const btn of ui.marks.children)btn.setAttribute('aria-pressed',String(Number(btn.dataset.group)===selected));
  }
  function updateGroups() {
    ({config,groups}=deviceGroups(property,plan,profile,configurationOptions));
    const presentTypes=new Set(groups.filter(g=>g.anchor).map(g=>g.type));
    ui.legend.innerHTML=Object.entries(types).filter(([key])=>presentTypes.has(key)).map(([,v])=>
      `<span><i style="background:${v[2]}"></i>${v[0]}</span>`).join('');
    ui.select.innerHTML=groups.map(({item,quantity,anchor},i)=>
      `<option value="${i}">${escape(item.roomName)} · ${escape(item.name)} × ${quantity}${anchor?'':'（待定位）'}</option>`).join('');
    ui.select.disabled=!groups.length;
    ui.marks.innerHTML=groups.map(({item,type,anchor},i)=>anchor?
      `<button class="lpv-point" style="--point-color:${types[type][2]}" type="button" data-group="${i}" aria-pressed="false" aria-label="${escape(item.roomName+' '+item.name)}" title="${escape(item.roomName+' · '+item.name)}">${types[type][1]}</button>`:'').join('');
    ui.lines.replaceChildren();
    for(const btn of ui.marks.children) {
      const line=document.createElementNS('http://www.w3.org/2000/svg','line');
      ui.lines.append(line);
    }
    const placed=groups.filter(g=>g.anchor).reduce((sum,g)=>sum+g.quantity,0);
    ui.count.textContent=`规划 ${config.summary.plannedDeviceCount} 件，已对应房间 ${placed} 件`;
    const sourceNote=imageOnly?'本套三维墙线待核验。':'墙线由该套原图提取，墙高为示意值。';
    const placementNote=placed && (automatic || imageOnly) ? '按原图房间文字定位，设备为配置示意。' :
      placed ? '设备为方案点位，实际安装位置待核验。' : '尚无可对应的房间点位，设备可从方案清单查看。';
    ui.note.textContent=config.applicability.label+'。'+sourceNote+placementNote;
    showSelection(groups.findIndex(g=>g.anchor)>=0?groups.findIndex(g=>g.anchor):0);
    engine?.draw();
  }
  function positionMarkers(project) {
    if(!ui || signal.aborted)return;
    const w=ui.stage.clientWidth,h=ui.stage.clientHeight;
    const roomCenters=new Map((plan.anchors || []).filter(a=>numeric(a.x)&&numeric(a.y)).map(a=>[a,project(a.x,a.y)]));
    const active=[];
    for(const [i,btn] of [...ui.marks.children].entries()) {
      const anchor=groups[Number(btn.dataset.group)]?.anchor;
      if(!anchor)continue;
      const [x,y]=roomCenters.get(anchor);
      const line=ui.lines.children[i];
      const offscreen=x<0 || x>w || y<0 || y>h;
      btn.hidden=offscreen;line.style.display=offscreen?'none':'';
      if(offscreen)continue;
      let point;
      for(let radius=0;radius<85 && !point;radius+=28){
        const steps=radius===0?1:Math.max(8,Math.round(radius/3));
        for(let k=0;k<steps;k++){
          const angle=-Math.PI/2+k*2*Math.PI/steps;
          const px=clamp(x+radius*Math.cos(angle),16,w-16),py=clamp(y+radius*Math.sin(angle),16,h-16);
          const distance=Math.hypot(px-x,py-y);
          const withinRoom=[...roomCenters.values()].every(([rx,ry])=>Math.hypot(px-rx,py-ry)+1>=distance);
          if(withinRoom && active.every(other=>Math.hypot(px-other[0],py-other[1])>26)){point=[px,py];break;}
        }
      }
      const [px,py]=point || [clamp(x,16,w-16),clamp(y,16,h-16)];
      btn.style.left=px+'px';btn.style.top=py+'px';
      line.setAttribute('x1',String(x));line.setAttribute('y1',String(y));line.setAttribute('x2',String(px));line.setAttribute('y2',String(py));
      active.push([px,py]);
    }
  }
  function resize() {
    if(!engine || !ui.stage.clientWidth || !ui.stage.clientHeight)return;
    engine.resize(ui.stage.clientWidth,ui.stage.clientHeight);
  }
  async function setMode(next) {
    const version=++epoch;clearEngine();mode=next;
    const canvas=document.createElement('canvas');
    canvas.setAttribute('aria-label',next==='3d'?'本套墙线三维参考，拖动旋转、滚轮缩放':'本套户型平面与方案点位');
    ui.layer.replaceChildren(canvas);
    for(const button of shell.querySelectorAll('[data-mode]')) {
      button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
      button.disabled=(failed3d || imageOnly) && button.dataset.mode==='3d';
    }
    ui.top.disabled=mode!=='3d';
    ui.hint.textContent=mode==='3d'?'拖动旋转 · 滚轮或双指缩放':imageOnly?'拖动平移 · 滚轮或双指缩放':failed3d?'当前设备使用二维户型，可选择方案点位。':'点击图中点位查看设备';
    let candidate;
    try {
      candidate=mode==='3d'?await create3d(canvas,plan,bounds,raster,positionMarkers):
        create2d(canvas,plan,bounds,original,positionMarkers);
    } catch {
      if(signal.aborted || version!==epoch)return;
      if(next==='3d'){failed3d=true;await setMode('2d');return;}
      fallback('该套参考图暂时无法绘制，可以打开官网原图。',true);return;
    }
    if(signal.aborted || version!==epoch){candidate.destroy();return;}
    engine=candidate;activeCanvas=canvas;
    if(mode==='3d') {
      resourceLost=event=>{event.preventDefault();if(!signal.aborted){failed3d=true;void setMode('2d');}};
      canvas.addEventListener('webglcontextlost',resourceLost);
    }
    resize();
  }
  async function init() {
    try {
      let proposed=givenPlan===undefined?(await loadListingPlanIndex().catch(()=>null))?.get(id):givenPlan;
      if(signal.aborted)return;
      const directSource=mediaFor(property,null,id).image;
      automatic=proposed?.method==='automatic' && proposed?.reviewed===false;
      if(!validPlan(proposed,id) && directSource){
        shell.innerHTML=`<p class="lpv-message" role="status">正在从${title}的官网原图提取墙线…</p>`;
        try {
          const {traceListingPlan}=await import('./on-demand-plan.js');
          proposed=await traceListingPlan(property,{signal});
        } catch {proposed=null;}
        automatic=true;
        if(signal.aborted)return;
      }
      if(automatic && (!directSource || officialImage(proposed?.image)!==directSource || officialImage(proposed?.originalUrl)!==directSource))proposed=null;
      if(validPlan(proposed,id)){
        plan=proposed;
        if(automatic){
          const data=encodedPreview(plan.previewData);
          if(data)original=await decodeSource(data,signal);
          if(!original)original=await decodeSource(directSource,signal,true);
        }else original=await decodeSource(localImage(plan),signal);
        if(original){bounds=getBounds(plan);raster=textureCanvas(original,plan);}
      }
      if(signal.aborted)return;
      if(!original){
        if(!directSource){fallback('尚无与本套挂牌对应的可查看户型图。可查阅已有官网资料。');return;}
        const preview=await matchedPreview(property,directSource,signal);
        if(preview)original=await decodeSource(preview.data,signal);
        if(!original)original=await decodeSource(directSource,signal);
        if(signal.aborted)return;
        if(!original){fallback('该套户型原图暂未能载入，可通过官网资料复核。',true);return;}
        imageOnly=true;
        const width=original.naturalWidth,height=original.naturalHeight;
        let anchors=[];
        if(preview?.labels?.length){
          const tracer=await import('./on-demand-plan.js').catch(()=>null);
          if(typeof tracer?.previewRoomAnchors==='function')anchors=tracer.previewRoomAnchors(preview,width,height) || [];
          if(signal.aborted)return;
        }
        plan={id,sourceUrl:property.sourceUrl,originalUrl:directSource,layout:property.layout,area:property.area,width,height,anchors};
        bounds=imageBounds(original);
      }
      const media=mediaFor(property,plan,id);
      const geometryStatus=imageOnly?'官网原图 · 三维墙线待核验':plan.reviewed===true?'已对照原图复核墙线':automatic?'原图自动提取 · 待复核':'已对照原图复核墙线';
      shell.innerHTML=`<header class="lpv-heading"><div><h3>${title} · 户型与设备</h3><p>${escape([plan.layout,plan.area ? String(plan.area).replace(/\s*㎡$/,'')+' ㎡':'','挂牌号 '+id,geometryStatus].filter(Boolean).join(' · '))}</p></div><div class="lpv-sources">${sourceLinks(media)}</div></header>
        <div class="lpv-toolbar"><div class="lpv-switch" role="group" aria-label="查看方式"><button type="button" data-mode="3d">三维户型</button><button type="button" data-mode="2d">二维对照</button></div>
        <div class="lpv-navigation"><button type="button" data-action="top">俯视</button><button type="button" data-action="reset">复位</button><button type="button" data-action="out" aria-label="缩小">−</button><button type="button" data-action="in" aria-label="放大">＋</button></div></div>
        <div class="lpv-stage"><div class="lpv-canvas"></div><svg class="lpv-lines" aria-hidden="true"></svg><div class="lpv-marks" role="group" aria-label="房间方案点位"></div></div><div class="lpv-key"><div class="lpv-legend"></div><span class="lpv-hint"></span></div>
        <div class="lpv-config"><label>配置方案<select data-profile>${CONFIG_PROFILES.filter(p=>['base','plus','upgrade'].includes(p.id)).map(p=>`<option value="${p.id}">${escape(p.label)}</option>`).join('')}</select></label>
        <label>方案设备<select data-devices></select></label><span class="lpv-count"></span></div>
        <div class="lpv-info" aria-live="polite"></div><p class="lpv-note"></p>`;
      ui={stage:find('.lpv-stage'),layer:find('.lpv-canvas'),marks:find('.lpv-marks'),lines:find('.lpv-lines'),legend:find('.lpv-legend'),hint:find('.lpv-hint'),top:find('[data-action=top]'),select:find('[data-devices]'),count:find('.lpv-count'),info:find('.lpv-info'),note:find('.lpv-note')};
      const profileSelect=find('[data-profile]');
      if(!['base','plus','upgrade'].includes(profile))profile='base';
      profileSelect.value=profile;renderConfiguration=updateGroups;updateGroups();
      profileSelect.addEventListener('change',()=>{profile=profileSelect.value;updateGroups();},{signal});
      ui.select.addEventListener('change',()=>showSelection(Number(ui.select.value)),{signal});
      shell.addEventListener('click',event=>{
        const button=event.target.closest('button');
        if(!button || !shell.contains(button) || button.disabled)return;
        if(button.hasAttribute('data-group')){showSelection(Number(button.dataset.group));return;}
        if(button.dataset.mode && mode!==button.dataset.mode){void setMode(button.dataset.mode);return;}
        if(button.dataset.action==='top')engine?.reset(true);
        if(button.dataset.action==='reset')engine?.reset(false);
        if(button.dataset.action==='in')engine?.zoom(1.25);
        if(button.dataset.action==='out')engine?.zoom(.8);
      },{signal});
      observer=new ResizeObserver(resize);observer.observe(ui.stage);
      await setMode(imageOnly?'2d':'3d');
    } catch { if(!signal.aborted)fallback('本套户型资料暂时未能载入，可打开对应官网资料重试。',true); }
  }
  function setConfigurationOptions(options){
    if(signal.aborted || !CONFIG_PROFILES.some(p=>p.id===options?.profile))return;
    configurationOptions=options;profile=options.profile;
    const choice=find('[data-profile]');
    if(choice){choice.value=profile;renderConfiguration?.();}
  }
  const api={ready:null,destroy,setConfigurationOptions};
  live.set(container,api);api.ready=init();return api;
}
