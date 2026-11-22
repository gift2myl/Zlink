import * as T from './assets/vendor/three.module.js';
import { OrbitControls } from './assets/vendor/OrbitControls.js';
import * as productModels from './device-meshes.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const eyeHeight=1.52, height=2.68, bodyRadius=.145;

function edgeDistance(x,z,[ax,az,bx,bz]) {
  const dx=bx-ax,dz=bz-az;
  const t=clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz || 1),0,1);
  return Math.hypot(x-ax-dx*t,z-az-dz*t);
}

function inside(x,z,edges) {
  let inPlan=false;
  for(const [ax,az,bx,bz] of edges){
    if((az>z)!==(bz>z) && x<(bx-ax)*(z-az)/(bz-az)+ax)inPlan=!inPlan;
  }
  return inPlan;
}

function roomGeometry(plan,bounds) {
  const outline=plan.outline;
  const area=Math.abs(outline.reduce((sum,[x,y],i)=>{
    const [nx,ny]=outline[(i+1)%outline.length];return sum+x*ny-nx*y;
  },0))/2;
  const scale=Math.sqrt(plan.area/area);
  const coord=(x,y)=>[(x-bounds.cx)*scale,(y-bounds.cy)*scale];
  const polygon=outline.map(([x,y])=>coord(x,y));
  const edges=polygon.map((p,i)=>[...p,...polygon[(i+1)%polygon.length]]);
  const line=([x,y,u,v,thickness])=>[...coord(x,y),...coord(u,v),clamp((thickness || 2)*scale,.045,.3)];
  const walls=bounds.lines.map(line),windows=(plan.glazing || []).map(line);
  const barriers=[...edges,...windows,...walls];
  const furniture=(plan.fixtures || []).filter(f=>Array.isArray(f.bounds)&&f.bounds.length===4).map(f=>{
    const [x,y,u,v]=f.bounds;
    return {...f,rect:[...coord(x,y),...coord(u,v)]};
  });
  function walkable(x,z,r=bodyRadius) {
    if(!inside(x,z,edges) || barriers.some(s=>edgeDistance(x,z,s)<r+(s[4] || 0)/2))return false;
    return !furniture.some(f=>x>f.rect[0]-r && x<f.rect[2]+r && z>f.rect[1]-r && z<f.rect[3]+r);
  }
  const rooms=plan.anchors.map((a,i)=>{
    const [x,z]=coord(...(a.entry || [a.x,a.y]));
    const duplicates=plan.anchors.filter(r=>r.room===a.room);
    const name=duplicates.length>1 ? a.room+' '+(duplicates.indexOf(a)+1) : a.room;
    return {index:i,name,source:a,x,z};
  });
  return {rooms,polygon,edges,walls,windows,barriers,furniture,walkable,scale,coord};
}

// Windows on the source drawing can overlap a wall centerline. Split only
// collinear spans around the recorded opening so the pane remains visible.
function solidPieces(w,wins) {
  const [x,z,bx,bz,thick]=w,L=Math.hypot(bx-x,bz-z);
  if(!L)return [];
  const ux=(bx-x)/L,uz=(bz-z)/L;
  let intervals=[[0,L]];
  for(const [a,b,c,d] of wins){
    const len=Math.hypot(c-a,d-b);if(!len)continue;
    if(Math.abs((c-a)*uz-(d-b)*ux)>.12*len ||
       Math.max(Math.abs((a-x)*uz-(b-z)*ux),Math.abs((c-x)*uz-(d-z)*ux))>thick*.95)continue;
    const first=(a-x)*ux+(b-z)*uz,last=(c-x)*ux+(d-z)*uz;
    const lo=Math.min(first,last),hi=Math.max(first,last);
    intervals=intervals.flatMap(([u,v])=>hi<=u || lo>=v ? [[u,v]] : [[u,Math.min(lo,v)],[Math.max(hi,u),v]]);
  }
  return intervals.filter(([u,v])=>v-u>.025).map(([u,v])=>[x+u*ux,z+u*uz,x+v*ux,z+v*uz,thick]);
}

// A low-contrast procedural surface gives an architectural scale cue; no
// photographed flooring, furniture or scenery from another listing is used.
function floorTexture() {
  const c=document.createElement('canvas');c.width=512;c.height=512;
  const g=c.getContext('2d');g.fillStyle='#b9ac98';g.fillRect(0,0,512,512);
  const tones=['#c9bdab','#c5baa6','#ccbfaa','#c6b9a5','#c3b8a4'];
  for(let row=0;row<8;row++){
    const offset=(row%3)*57;
    for(let col=-1;col<4;col++){
      const x=col*256+offset,y=row*64;
      g.fillStyle=tones[(row*7+col+5)%tones.length];g.fillRect(x+1,y+1,255,63);
      for(let k=0;k<18;k++){
        const yy=y+3+k*3.2;
        g.strokeStyle=k%3===0?'rgba(100,84,65,.07)':'rgba(255,255,255,.10)';
        g.beginPath();g.moveTo(x,yy);g.bezierCurveTo(x+77,yy+(k%4),x+156,yy-(k%3),x+250,yy);g.stroke();
      }
    }
  }
  const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.repeat.set(.55,.55);return tex;
}

function freeResources(root) {
  const geometries=new Set(),materials=new Set(),textures=new Set();
  root.traverse(o=>{
    if(o.geometry)geometries.add(o.geometry);
    for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){
      materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);
    }
  });
  textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());
  root.removeFromParent();
}

export function createListingRoomScene(canvas,{plan,bounds,initialRoom,interior,raster,onRoom,onDevice,miniMap}) {
  const g=roomGeometry(plan,bounds);
  const scene=new T.Scene();
  scene.background=new T.Color(interior?0xe5edf0:0xe9eff1);
  const renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.65));renderer.outputColorSpace=T.SRGBColorSpace;
  const camera=new T.PerspectiveCamera(interior?70:40,1,.035,150);
  camera.rotation.order='YXZ';
  const events=new AbortController(),opts={signal:events.signal};
  let width=1,h=1,room=initialRoom,dead=false,yaw=0,pitch=-.13,orbit=null;
  let showLabels=true,selectedId='',overviewTop=false,fullHeight=false;
  const longest=Math.max(bounds.width,bounds.height)*g.scale;
  const model=new T.Group(),walls=new T.Group(),fixtures=new T.Group(),devices=new T.Group();
  scene.add(model);model.add(walls,fixtures,devices);
  const box=new T.BoxGeometry(1,1,1);
  const surface=(color,extra={})=>new T.MeshStandardMaterial({color,roughness:.85,...extra});
  const paint=document.createElement('canvas');paint.width=8;paint.height=192;
  const painter=paint.getContext('2d'),fade=painter.createLinearGradient(0,0,0,192);
  for(const [t,c] of [[0,'#d9d9d4'],[.10,'#f8f6f1'],[.42,'#f7f5ef'],[.82,'#eeeae1'],[1,'#d4d0c4']])fade.addColorStop(t,c);
  painter.fillStyle=fade;painter.fillRect(0,0,8,192);
  const paintMap=new T.CanvasTexture(paint);paintMap.colorSpace=T.SRGBColorSpace;
  const plaster=surface(0xf5f3eb,{map:paintMap}),baseboard=surface(0xb8b6a8),trim=surface(0xd8d4c7);
  const frame=surface(0x667d84,{roughness:.53}),sill=surface(0xd9dcd7);
  const glass=new T.MeshBasicMaterial({color:0xbddee6,transparent:true,opacity:.58,depthWrite:false});
  const wood=surface(0xa39079),linen=surface(0xe3e0d6),quilt=surface(0x8eaaa6),pillow=surface(0xf0ebe0);
  function cuboid(group,mat,x,y,z,length,tall,deep,heading=0) {
    const m=new T.Mesh(box,mat);m.scale.set(length,tall,deep);m.position.set(x,y,z);m.rotation.y=heading;m.castShadow=true;m.receiveShadow=true;group.add(m);return m;
  }
  function span(segment,mat,bottom,top,thickness,group=walls) {
    const [ax,az,bx,bz,d]=segment;
    return cuboid(group,mat,(ax+bx)/2,(top+bottom)/2,(az+bz)/2,
      Math.hypot(bx-ax,bz-az),top-bottom,thickness || d,-Math.atan2(bz-az,bx-ax));
  }
  const shape=new T.Shape(g.polygon.map(([x,z])=>new T.Vector2(x,-z)));
  const slab=new T.ShapeGeometry(shape);
  const floor=new T.Mesh(slab,surface(0xffffff,{map:floorTexture(),side:T.DoubleSide}));
  floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
  if(interior){
    // Contact shadows follow the actual drawn footprint and fixtures. The plan's
    // printed furniture and dimension marks stay off the walkable floor surface.
    const tile=document.createElement('canvas');tile.width=720;
    tile.height=Math.round(tile.width*plan.height/plan.width);const ctx=tile.getContext('2d'),k=tile.width/plan.width;
    ctx.scale(k,k);
    ctx.strokeStyle='rgba(64,52,39,.28)';ctx.lineCap='round';
    const lines=[...plan.segments,...plan.glazing];
    for(const [width,alpha] of [[20,.04],[12,.055],[7,.065],[4,.09]]){
      ctx.strokeStyle='rgba(64,52,39,'+alpha+')';ctx.lineWidth=width;
      for(const [x,y,u,v] of lines){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(u,v);ctx.stroke();}
    }
    ctx.fillStyle='#403a32';ctx.shadowBlur=6;ctx.shadowColor='rgba(42,34,27,.65)';
    for(const f of plan.fixtures||[]){const [a,b,c,d]=f.bounds;ctx.fillRect(a+1,b+1,c-a-2,d-b-2);}
    const ao=new T.CanvasTexture(tile);ao.colorSpace=T.SRGBColorSpace;
    const aoMat=new T.MeshBasicMaterial({map:ao,transparent:true,depthWrite:false,opacity:.72});
    const contact=new T.Mesh(new T.PlaneGeometry(plan.width*g.scale,plan.height*g.scale),aoMat);
    const [x,z]=g.coord(plan.width/2,plan.height/2);contact.rotation.x=-Math.PI/2;contact.position.set(x,.008,z);scene.add(contact);
  }
  if(!interior && raster){
    const tex=new T.CanvasTexture(raster);tex.colorSpace=T.SRGBColorSpace;
    const paper=new T.Mesh(new T.PlaneGeometry(plan.width*g.scale,plan.height*g.scale),
      new T.MeshBasicMaterial({map:tex,transparent:true,alphaTest:.04,depthWrite:false}));
    paper.rotation.x=-Math.PI/2;
    const [x,z]=g.coord(plan.width/2,plan.height/2);paper.position.set(x,.007,z);scene.add(paper);
  }
  if(interior){
    const ceiling=new T.Mesh(slab,surface(0xf2f0e9,{side:T.DoubleSide}));ceiling.rotation.x=-Math.PI/2;ceiling.position.y=height;scene.add(ceiling);
  }
  for(const w of g.walls)for(const s of solidPieces(w,g.windows)){
    span(s,plaster,0,height);span(s,baseboard,0,.095,s[4]+.023);
    if(interior)span(s,trim,height-.035,height,s[4]+.014);
  }
  for(const w of g.windows){
    const [ax,az,bx,bz]=w,len=Math.hypot(bx-ax,bz-az);
    if(len<.05)continue;
    span(w,plaster,0,.7,.12);span(w,sill,.7,.75,.20);span(w,glass,.76,2.19,.025);
    span(w,frame,.75,.79,.065);span(w,frame,2.15,2.2,.065);span(w,plaster,2.2,height,.12);
    const parts=Math.max(1,Math.round(len/1.22)),angle=-Math.atan2(bz-az,bx-ax);
    for(let j=0;j<=parts;j++){
      const f=j/parts;cuboid(walls,frame,ax+(bx-ax)*f,1.46,az+(bz-az)*f,.035,1.42,.065,angle);
    }
  }
  for(const f of g.furniture){
    const [a,b,c,d]=f.rect,x=(a+c)/2,z=(b+d)/2,w=c-a,l=d-b;
    if(w<=.15||l<=.15)continue;
    if(f.kind==='counter'){
      cuboid(fixtures,wood,x,.43,z,w*.98,.78,l*.98);
      cuboid(fixtures,sill,x,.85,z,w,.055,l);
      const along=w>l;
      const doors=Math.max(1,Math.round(Math.max(w,l)/.54));
      for(let i=1;i<doors;i++){
        const offset=i/doors-.5;
        cuboid(fixtures,trim,x+(along?w*offset:0),.45,z+(along?0:l*offset),along?.012:w*.99,.63,along?l*.99:.012);
      }
      continue;
    }
    if(f.kind==='sofa'){
      const along=w>l,side=along?(z>0?1:-1):(x>0?1:-1);
      cuboid(fixtures,quilt,x,.23,z,w,.40,l);
      cuboid(fixtures,quilt,x+(along?0:side*w*.4),.51,z+(along?side*l*.4:0),along?w:w*.16,.45,along?l*.16:l);
      for(const sun of [-1,1])cuboid(fixtures,quilt,x+(along?sun*w*.45:0),.42,z+(along?0:sun*l*.45),along?w*.09:w,.28,along?l:l*.09);
      continue;
    }
    if(f.kind==='toilet'){
      const bowl=new T.Mesh(new T.SphereGeometry(1,16,10),linen);
      bowl.position.set(x,.30,z);bowl.scale.set(w*.46,.19,l*.41);bowl.castShadow=true;fixtures.add(bowl);
      cuboid(fixtures,linen,x,.15,z,w*.55,.26,l*.58);
      const seat=new T.Mesh(new T.TorusGeometry(1,.12,8,24),pillow);seat.rotation.x=Math.PI/2;seat.scale.set(w*.39,l*.36,.1);
      seat.position.set(x,.46,z);fixtures.add(seat);continue;
    }
    if(f.kind!=='bed')continue;
    const along=f.head==='north'||f.head==='south',sgn=f.head==='north'||f.head==='west'?-1:1;
    cuboid(fixtures,wood,x,.17,z,w,.30,l);
    cuboid(fixtures,linen,x,.37,z,w*.985,.17,l*.985);
    cuboid(fixtures,quilt,x+(along?0:-sgn*w*.17),.469,z+(along?-sgn*l*.17:0),
      w*(along?.97:.63),.035,l*(along?.63:.97));
    cuboid(fixtures,wood,x+(along?0:sgn*(w-.045)/2),.54,z+(along?sgn*(l-.045)/2:0),along?w:.045,.42,along?.045:l);
    const count=(along?w:l)>1.26?2:1;
    for(let i=0;i<count;i++){
      const off=(i-(count-1)/2)*(along?w:l)*.46;
      cuboid(fixtures,pillow,x+(along?off:sgn*w*.32),.49,z+(along?sgn*l*.32:off),
        along?w*.78/count:w*.20,.10,along?l*.20:l*.78/count);
    }
  }
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
  scene.add(new T.AmbientLight(0xfff7e7,.54));
  scene.add(new T.HemisphereLight(0xfffffa,0xb6b7b1,1.64));
  const daylight=new T.DirectionalLight(0xfff1d7,2.1);daylight.position.set(-8,14,8);daylight.castShadow=true;
  const shadow=daylight.shadow;shadow.mapSize.set(1024,1024);
  Object.assign(shadow.camera,{left:-longest,right:longest,top:longest,bottom:-longest,near:.1,far:55});
  shadow.camera.updateProjectionMatrix();shadow.normalBias=.025;shadow.bias=-.0004;scene.add(daylight);
  const fill=new T.DirectionalLight(0xc8e0eb,.68);fill.position.set(3,3,-7);scene.add(fill);
  const labels=document.createElement('div');labels.className='lpv-model-pins';canvas.after(labels);
  let records=[],configKey='',projected=new T.Vector3();
  const ray=new T.Raycaster();
  function drawMap(){
    if(!interior || !miniMap)return;
    const ctx=miniMap.getContext('2d'),w=miniMap.width,h=miniMap.height;
    const xs=g.polygon.map(p=>p[0]),zs=g.polygon.map(p=>p[1]);
    const x0=Math.min(...xs),z0=Math.min(...zs),dx=Math.max(...xs)-x0,dz=Math.max(...zs)-z0;
    const k=Math.min((w-18)/dx,(h-18)/dz),xx=x=>(x-x0-dx/2)*k+w/2,yy=z=>(z-z0-dz/2)*k+h/2;
    ctx.clearRect(0,0,w,h);ctx.beginPath();g.polygon.forEach(([x,z],i)=>i?ctx.lineTo(xx(x),yy(z)):ctx.moveTo(xx(x),yy(z)));
    ctx.closePath();ctx.fillStyle='#dde1d7';ctx.fill();
    const line=(s,color,weight)=>{ctx.beginPath();ctx.moveTo(xx(s[0]),yy(s[1]));ctx.lineTo(xx(s[2]),yy(s[3]));ctx.lineWidth=weight;ctx.strokeStyle=color;ctx.stroke();};
    g.walls.forEach(s=>line(s,'#4d6169',Math.max(1.3,s[4]*k)));
    g.windows.forEach(s=>line(s,'#429db2',1.75));
    const x=xx(camera.position.x),y=yy(camera.position.z),a=-yaw-Math.PI/2;
    ctx.fillStyle='#247aaf40';ctx.beginPath();ctx.moveTo(x,y);ctx.arc(x,y,20,a-.55,a+.55);ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.arc(x,y,4.6,0,Math.PI*2);ctx.fillStyle='#1676aa';ctx.fill();ctx.lineWidth=1.7;ctx.strokeStyle='#fff';ctx.stroke();
  }
  function draw(){
    if(dead)return;
    camera.updateMatrixWorld();renderer.render(scene,camera);drawMap();
    for(const rec of records) {
      if(!showLabels || interior && rec.room.index!==room){rec.label.hidden=true;continue;}
      projected.copy(rec.mesh.position);projected.y+=.16;
      const dist=projected.distanceTo(camera.position);
      if(interior && (dist<.25 || dist>6.5)){rec.label.hidden=true;continue;}
      projected.project(camera);const visible=projected.z>=-1 && projected.z<=1 && Math.abs(projected.x)<.97 && Math.abs(projected.y)<.96;
      rec.label.hidden=!visible;
      if(visible){rec.label.style.left=((projected.x+1)*width/2)+'px';rec.label.style.top=((1-projected.y)*h/2)+'px';}
    }
  }
  function freeDistance(x,z,angle) {
    const sx=-Math.sin(angle)*.14,sz=-Math.cos(angle)*.14;
    for(let n=1;n<=58;n++)if(!g.walkable(x+sx*n,z+sz*n,.07))return n*.14;
    return 8.12;
  }
  function look(){
    camera.rotation.set(pitch,yaw,0,'YXZ');draw();
  }
  function turn(angle){
    if(!interior)return;
    yaw+=angle;look();
  }
  function goRoom(index) {
    const target=g.rooms[index];if(!target)return false;
    let x=target.x,z=target.z;
    // Allow a small correction for a rounding difference on the audited entry.
    if(!g.walkable(x,z)){
      let located=false;
      for(let radius=.04;!located&&radius<=.32;radius+=.04)for(let j=0;j<16;j++){
        const a=j*Math.PI/8,tx=target.x+radius*Math.cos(a),tz=target.z+radius*Math.sin(a);
        if(g.walkable(tx,tz)){x=tx;z=tz;located=true;break;}
      }
      if(!located)return false;
    }
    room=index;camera.position.set(x,eyeHeight,z);
    let best=-Infinity; yaw=0;pitch=-.12;
    for(let j=0;j<48;j++){
      const a=(j+.28)*Math.PI/24;
      const middle=Math.min(5.5,freeDistance(x,z,a));
      const score=middle*.56+Math.min(4,freeDistance(x,z,a-.45))*.27+Math.min(4,freeDistance(x,z,a+.45))*.17+.18*Math.abs(Math.sin(2*a));
      if(score>best){best=score;yaw=a;}
    }
    const feature=g.furniture.find(f=>f.room===target.source.room);
    if(feature){
      const [a,b,c,d]=feature.rect,dx=(a+c)/2-x,dz=(b+d)/2-z;
      const distance=Math.hypot(dx,dz);
      if(distance>.28){
        yaw=Math.atan2(-dx,-dz)+.095;
        pitch=clamp(Math.atan2((feature.kind==='counter'?1.05:.80)-eyeHeight,distance),-.48,-.13);
      }
    }
    if(!feature && /卫生|浴室|阳台/.test(target.name)){
      const clearance=freeDistance(x,z,yaw);
      if(clearance<3)pitch=clamp(-Math.atan2(eyeHeight-.32,clearance*1.2),-.58,-.17);
    }
    onRoom?.(index);look();return true;
  }
  function step(forward,side=0){
    if(!interior)return;
    const dx=-Math.sin(yaw)*forward+Math.cos(yaw)*side,dz=-Math.cos(yaw)*forward-Math.sin(yaw)*side;
    const count=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.045));
    for(let n=0;n<count;n++){
      const p=camera.position;
      if(g.walkable(p.x+dx/count,p.z))p.x+=dx/count;
      if(g.walkable(p.x,p.z+dz/count))p.z+=dz/count;
    }
    // Only relabel the room when near its audited entry and with a clear path.
    let distance=Math.hypot(camera.position.x-g.rooms[room].x,camera.position.z-g.rooms[room].z);
    let nearest=room;
    for(const other of g.rooms){
      const dx=other.x-camera.position.x,dz=other.z-camera.position.z,d=Math.hypot(dx,dz);
      if(other.index===room || d>=Math.min(distance-.17,1.3))continue;
      if(Array.from({length:10},(_,i)=>(i+1)/10).every(t=>g.walkable(camera.position.x+t*dx,camera.position.z+t*dz,.06))){
        nearest=other.index;distance=d;
      }
    }
    if(nearest!==room){room=nearest;onRoom?.(room);}
    draw();
  }
  let start=null,prev=null,moved=false;
  canvas.tabIndex=interior?0:-1;
  canvas.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;start=prev=[e.clientX,e.clientY];moved=false;
    canvas.focus({preventScroll:true});if(interior)canvas.setPointerCapture(e.pointerId);
  },opts);
  canvas.addEventListener('pointermove',e=>{
    if(!prev)return;
    const dx=e.clientX-prev[0],dy=e.clientY-prev[1];
    moved ||= Math.hypot(e.clientX-start[0],e.clientY-start[1])>5;
    if(interior){yaw-=dx*.005;pitch=clamp(pitch-dy*.004,-1.13,1.18);look();}
    prev=[e.clientX,e.clientY];
  },opts);
  canvas.addEventListener('pointerup',e=>{
    if(prev && !moved){
      const r=canvas.getBoundingClientRect();
      ray.setFromCamera(new T.Vector2(2*(e.clientX-r.left)/r.width-1,1-2*(e.clientY-r.top)/r.height),camera);
      const hit=ray.intersectObjects([...devices.children,walls,fixtures],true).find(r=>r.object.visible);
      if(hit?.object.userData.deviceId)onDevice?.(hit.object.userData.deviceId);
    }prev=null;start=null;
  },opts);
  canvas.addEventListener('pointercancel',()=>{prev=null;start=null;},opts);
  canvas.addEventListener('keydown',e=>{
    if(!interior || e.ctrlKey || e.metaKey || e.altKey)return;
    const key=e.key.toLowerCase();
    if(!['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key))return;
    e.preventDefault();
    if(key==='arrowleft'||key==='arrowright')turn(key==='arrowleft'?.12:-.12);
    else if(key==='a'||key==='d')step(0,key==='a'?-.22:.22);
    else step(key==='w'||key==='arrowup'?.25:-.25);
  },opts);
  function reset(top=false){
    if(interior)return goRoom(room);
    overviewTop=top;orbit.target.set(0,.4,0);
    camera.position.set(...(top?[0,longest*1.8,.001]:[longest*.88,longest*1.10,longest*.99]));
    orbit.update();draw();
  }
  function resize(w,hh){
    width=w;h=hh;camera.aspect=w/hh;camera.updateProjectionMatrix();renderer.setSize(w,hh,false);draw();
  }
  let raf=0,rotating=false;
  if(interior){
    if(!goRoom(room)){destroy();throw Error('当前房间入口不能通过边界校验');}
  }else{
    orbit=new OrbitControls(camera,canvas);orbit.maxPolarAngle=Math.PI*.47;orbit.minDistance=2;orbit.maxDistance=longest*4;
    orbit.addEventListener('change',draw);walls.scale.y=.35;reset();
  }
  function devicePose(device,room,slot){
    const a=g.coord(room.source.x,room.source.y),form=device.formFactor||'';
    const wallForms=/panel|switch|socket|sensor|lock|curtain|blind/;
    const overhead=/ceiling|spotlight|track-light|smoke/;
    if(overhead.test(form)){
      const ang=slot*2.4,rad=slot?.24:0;return [a[0]+Math.cos(ang)*rad,height-.1,a[1]+Math.sin(ang)*rad,0];
    }
    let closest=null,best=Infinity;
    for(const s of g.walls){
      const [x,z,u,v]=s,dx=u-x,dz=v-z,l=dx*dx+dz*dz;if(l<.15)continue;
      const margin=Math.min(.38/Math.sqrt(l),.38),t=clamp(((a[0]-x)*dx+(a[1]-z)*dz)/l,margin,1-margin);
      const px=x+t*dx,pz=z+t*dz,d=Math.hypot(a[0]-px,a[1]-pz);
      if(d<best){best=d;closest={s,t,dx,dz,l};}
    }
    if(!closest)return [a[0],1.05,a[1],0];
    const {s,dx,dz,l}=closest,len=Math.sqrt(l);
    const offset=clamp(closest.t+((slot%5)-2)*.20/len,.04,.96);
    const x=s[0]+dx*offset,z=s[1]+dz*offset;
    const sign=(a[0]-x)*(-dz)+(a[1]-z)*dx>=0?1:-1,nx=-dz/len*sign,nz=dx/len*sign;
    const onWall=wallForms.test(form),dist=s[4]/2+(onWall?.04:.22);
    const y=/socket/.test(form)?.45:/curtain|blind/.test(form)?2.25:/gateway/.test(form)?.09:1.36;
    return [x+nx*dist,y,z+nz*dist,Math.atan2(nx,nz)];
  }
  function setDevices(placements,labelsVisible) {
    showLabels=labelsVisible!==false;
    const key=placements.map(p=>p.device.id+':'+p.anchorIndex).join('|');
    if(key!==configKey){
      for(const o of [...devices.children])freeResources(o);
      labels.replaceChildren();records=[];configKey=key;
      const roomCounts=new Map();
      for(const {device,anchorIndex} of placements){
        const room=g.rooms[anchorIndex];if(!room)continue;
        const slot=roomCounts.get(anchorIndex)||0;roomCounts.set(anchorIndex,slot+1);
        const visual=productModels.createConfiguredDeviceMesh(device),mesh=visual.group || visual;
        const [x,y,z,rot]=devicePose(device,room,slot);mesh.position.set(x,y,z);mesh.rotation.y=rot;devices.add(mesh);
        const indicator=visual.indicator || mesh.getObjectByName('state-halo');
        const label=document.createElement('button');label.type='button';label.className='lpv-device-pin';label.dataset.sceneDevice=device.id;
        const shortName=({gateway:'网关','ceiling-light':'吸顶灯','wall-switch':'开关','control-panel':'面板','smoke-sensor':'烟感','gas-sensor':'燃气','door-lock':'门锁'})[device.formFactor] || device.name;
        label.textContent=shortName;label.setAttribute('aria-label',room.name+' · '+device.name);label.title=room.name+' · '+device.name+' · 配置示意';labels.append(label);
        label.addEventListener('click',()=>onDevice?.(device.id));
        records.push({room,mesh,label,indicator,device});
      }
    }
    const states=new Map(placements.map(p=>[p.device.id,p.device]));
    for(const rec of records){
      const d=states.get(rec.device.id),color=productModels.DEVICE_STATE_COLORS[d.state]||'#79909e';
      rec.label.style.setProperty('--state',color);rec.label.dataset.state=d.state || 'unknown';
      rec.label.setAttribute('aria-pressed',String(rec.device.id===selectedId));
      rec.label.title=rec.room.name+' · '+d.name+' · '+(d.stateLabel || '配置示意');
      if(rec.indicator){rec.indicator.material.color.set(color);rec.indicator.visible=Boolean(d.state && d.state!=='unknown' || rec.device.id===selectedId);}
    }
    draw();
  }
  function focusDevice(id){
    const rec=records.find(r=>r.device.id===id);if(!rec)return false;
    selectedId=id;
    if(interior){
      goRoom(rec.room.index);
      const v=rec.mesh.position;
      if(Math.hypot(v.x-camera.position.x,v.z-camera.position.z)<.28)step(-.48);
      camera.lookAt(v);yaw=camera.rotation.y;pitch=camera.rotation.x;
    }else{
      orbit.target.copy(rec.mesh.position);camera.position.set(rec.mesh.position.x+4,rec.mesh.position.y+4,rec.mesh.position.z+4);orbit.update();
    }
    for(const r of records)r.label.setAttribute('aria-pressed',String(r===rec));
    draw();return true;
  }
  function setRotate(active){
    if(interior || dead)return false;
    rotating=!!active;cancelAnimationFrame(raf);
    let last=performance.now();
    function animate(time){
      if(!rotating||dead)return;
      const angle=Math.min(.06,(time-last)/1000)*.27;last=time;
      const offset=camera.position.clone().sub(orbit.target);
      offset.applyAxisAngle(new T.Vector3(0,1,0),angle);camera.position.copy(orbit.target).add(offset);orbit.update();
      raf=requestAnimationFrame(animate);
    }
    if(rotating)raf=requestAnimationFrame(animate);return rotating;
  }
  function destroy(){
    if(dead)return;
    dead=true;events.abort();cancelAnimationFrame(raf);
    orbit?.removeEventListener('change',draw);orbit?.dispose();labels.remove();
    daylight.shadow.dispose();freeResources(scene);renderer.dispose();renderer.forceContextLoss();
    records=[];labels.replaceChildren();
  }
  return {draw,resize,goRoom,step,turn,reset,setDevices,focusDevice,setRotate,destroy,
    toggleTop(){if(interior)return false;reset(!overviewTop);return overviewTop;},
    toggleWalls(){if(interior)return true;fullHeight=!fullHeight;walls.scale.y=fullHeight?1:.35;draw();return fullHeight;},
    zoom(f){if(interior)step(f>1?.28:-.28);else {camera.position.sub(orbit.target).multiplyScalar(1/f).add(orbit.target);orbit.update();}}
  };
}
