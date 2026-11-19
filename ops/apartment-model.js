import * as THREE from 'three';

// Reference-guided, approximate reconstruction of the cited listing. Geometry is
// authored procedurally; photos are evidence, never a substitute for 3D surfaces.
// +X east, +Z south, +Y up. All dimensions below are plausible estimates in metres.
const SOURCE = 'https://www.ziroom.com/x/810151211.html';
const WALL_H = 2.7;
const V = (x,y,z) => new THREE.Vector3(x,y,z);
const geoCache = new Map();
function rng(seed=37) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }

function texture(kind, data=false) {
  if (typeof document === 'undefined') {
    const t = new THREE.DataTexture(new Uint8Array([190,185,175,255]),1,1);
    t.colorSpace=data?THREE.NoColorSpace:THREE.SRGBColorSpace; t.needsUpdate=true; return t;
  }
  const c=document.createElement('canvas'); c.width=c.height=512;
  const a=c.getContext('2d'), r=rng(kind.length*913);
  if (kind==='oak' || kind==='floor') {
    const grey=kind==='floor';
    a.fillStyle=grey?'#aaa394':'#d3bc93'; a.fillRect(0,0,512,512);
    const rows=grey?4:3;
    for(let j=0;j<rows;j++){
      const h=512/rows;
      a.fillStyle=grey?`rgba(70,60,45,${.025+r()*.07})`:`rgba(98,63,28,${.025+r()*.06})`;
      a.fillRect(0,j*h,512,h);
      for(let k=0;k<220;k++){
        const y=j*h+r()*h, x=r()*512;
        a.strokeStyle=`rgba(73,54,34,${.012+r()*.065})`; a.lineWidth=.25+r()*.6;
        a.beginPath();a.moveTo(x,y);a.bezierCurveTo(x+35,y-2,x+110,y+2,x+160+r()*150,y);a.stroke();
      }
      if(grey){
        a.fillStyle='rgba(68,63,56,.21)';a.fillRect(0,j*h,512,1.1);
        const joint=(j%2?210:420);a.fillRect(joint,j*h,1.3,h);
        a.fillStyle='rgba(255,255,255,.24)';a.fillRect(0,j*h+1.4,512,.8);
      }
    }
  } else if(kind==='tile'){
    a.fillStyle='#aca494';a.fillRect(0,0,512,512);
    for(let i=0;i<15000;i++) { const n=r();a.fillStyle=n>.5?'rgba(255,255,255,.025)':'rgba(30,25,20,.018)';a.fillRect(r()*512,r()*512,1+r()*3,1+r()*3); }
    a.strokeStyle='#d1cabd';a.lineWidth=2.2;
    for(let i=0;i<=2;i++){a.beginPath();a.moveTo(i*256,0);a.lineTo(i*256,512);a.stroke();a.beginPath();a.moveTo(0,i*256);a.lineTo(512,i*256);a.stroke();}
  } else if(kind==='fabric-height') {
    a.fillStyle='#7f7f7f';a.fillRect(0,0,512,512);
    for(let i=0;i<512;i+=3){a.strokeStyle=i%2?'#949494':'#767676';a.lineWidth=1;a.beginPath();a.moveTo(i,0);a.lineTo(i,512);a.stroke();a.beginPath();a.moveTo(0,i);a.lineTo(512,i);a.stroke();}
  } else if(kind==='label'){
    a.fillStyle='#f8f8f4';a.fillRect(0,0,512,512);a.fillStyle='#4c94b1';a.fillRect(0,0,512,95);
    ['#519c78','#aac489','#dfca75','#dca065','#cc7864'].forEach((x,i)=>{a.fillStyle=x;a.fillRect(50,135+i*47,300-i*32,30);});
  } else {
    a.fillStyle='#b1ada3';a.fillRect(0,0,512,512);
  }
  const t=new THREE.CanvasTexture(c);t.colorSpace=data?THREE.NoColorSpace:THREE.SRGBColorSpace;
  t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;return t;
}

// Rounded rigid solids use a continuous bevel rather than stacked boxes.
function roundedGeometry(w,h,d,r=.02,segments=2) {
  r=Math.min(r,w*.49,h*.49,d*.49);
  const key=[w,h,d,r,segments].join(':'); if(geoCache.has(key)) return geoCache.get(key);
  if(r<=0){const q=new THREE.BoxGeometry(w,h,d);geoCache.set(key,q);return q;}
  const count=segments*2+1, g=new THREE.BoxGeometry(1,1,1,count,count,count).toNonIndexed();
  const p=g.attributes.position,n=g.attributes.normal,core=V(w/2-r,h/2-r,d/2-r), q=V(0,0,0), nn=V(0,0,0);
  for(let i=0;i<p.count;i++){
    q.fromBufferAttribute(p,i);nn.copy(q);
    ['x','y','z'].forEach(k=>nn[k]-=Math.sign(nn[k])*.5/count);nn.normalize();
    p.setXYZ(i,core.x*Math.sign(q.x)+nn.x*r,core.y*Math.sign(q.y)+nn.y*r,core.z*Math.sign(q.z)+nn.z*r);
    n.setXYZ(i,nn.x,nn.y,nn.z);
  }
  p.needsUpdate=n.needsUpdate=true;g.computeBoundingBox();g.computeBoundingSphere();geoCache.set(key,g);return g;
}

export function createApartment() {
  const group=new THREE.Group();group.name='lingzhi-reference-apartment';
  group.userData={kind:'apartment',source:SOURCE,reconstruction:'approximate-procedural',pickable:false};
  const roomsData=[
    ['bedroom','卧室',-.45,3.75],['living','餐厅 / 起居厅',-.45,-.02],
    ['entry','玄关 / 洗漱区',1.37,-2.09],['bathroom','卫生间',-1.05,-2.1],
    ['kitchen','厨房',1.65,-4.55],['north-balcony','洗衣阳台',1.65,-6.9],['south-balcony','南向阳台',-.45,6.85]
  ];
  const rooms=roomsData.map(([id,name,x,z])=>({id,name,position:V(x,.04,z)}));
  const roomNames=Object.fromEntries(rooms.map(r=>[r.id,r.name]));
  let serial=0;
  function assembly(name,parent=group,room='shared',extra={}) {
    const g=new THREE.Group();g.name=name;g.userData={id:name,kind:'assembly',room,roomName:roomNames[room]||'建筑结构',pickable:true,...extra};parent.add(g);return g;
  }
  function item(name,geometry,material,parent,position=[0,0,0],rotation=[0,0,0],extra={}){
    const m=new THREE.Mesh(geometry,material);m.name=name;m.position.set(...position);m.rotation.set(...rotation);
    m.castShadow=true;m.receiveShadow=true;
    m.userData={id:name+'-'+(++serial),part:name,kind:'part',room:parent.userData.room||'shared',pickable:true,...extra};
    parent.add(m);return m;
  }
  const std=(color,roughness=.7,metalness=0,extra={})=>new THREE.MeshStandardMaterial({color,roughness,metalness,...extra});
  const oakMap=texture('oak'),floorMap=texture('floor'),tileMap=texture('tile'),clothBump=texture('fabric-height',true);
  clothBump.repeat.set(4,4);
  const mat={
    wall:std('#e8e6df',.9),cut:std('#c7c5bd',.86),white:std('#f0efe8',.48),cabinet:std('#e6e6df',.38),
    oak:std('#ffffff',.62,0,{map:oakMap}),dark:std('#2e3333',.58),black:std('#151b1c',.38),
    metal:std('#afb7b9',.27,1),steel:std('#8c979b',.4,.8),silver:std('#c0c3c1',.42,.65),
    porcelain:std('#f1f1ea',.23),counter:std('#e4e3d8',.36),cloth:std('#d6d0cb',.96,0,{bumpMap:clothBump,bumpScale:.0014}),
    headboard:std('#d9d6ca',.94,0,{bumpMap:clothBump,bumpScale:.002}),curtain:std('#b8afa6',.98,0,{side:THREE.DoubleSide,bumpMap:clothBump,bumpScale:.002}),
    showerCurtain:std('#e4e4dc',.96,0,{side:THREE.DoubleSide,bumpMap:clothBump,bumpScale:.001}),
    red:std('#bd3b2d',.85),paper:std('#eeebe1',.94),glow:std('#eff3e9',.25,0,{emissive:'#fff5df',emissiveIntensity:.25}),
    glass:new THREE.MeshPhysicalMaterial({color:'#bad5d8',roughness:.08,metalness:0,transparent:true,opacity:.20,depthWrite:false,side:THREE.DoubleSide}),
    mirror:std('#c3cfd0',.06,.92),water:std('#5c7479',.2,.2),blue:std('#5b9cba',.4),green:std('#7ba591',.5)
  };
  const architecture=assembly('architecture');
  const floors=assembly('floors',architecture,'shared',{kind:'floors'});
  const walls=assembly('walls',architecture,'shared',{kind:'walls',wallHeight:WALL_H,cutawayUpperVisible:false,visibilityPolicy:'Upper east/front wall pieces are hidden by default. Toggle meshes with userData.cutawayUpper.'});
  const windows=assembly('windows',architecture);
  const doors=assembly('doors',architecture);
  const furniture=assembly('furnishings');
  const furnishingGroups=Object.fromEntries(rooms.map(r=>[r.id,assembly('furnishings-'+r.id,furniture,r.id)]));
  const deviceLayer=assembly('demo-devices',group,'shared',{kind:'demonstration-devices',isDemo:true});
  const roof=assembly('roof',architecture,'shared',{kind:'roof',openRoof:true});roof.visible=false;
  const box=(name,w,h,d,material,pos,parent,r=.012,rot=[0,0,0],extra={})=>item(name,roundedGeometry(w,h,d,r),material,parent,pos,rot,extra);
  const cyl=(name,r,h,material,pos,parent,rot=[0,0,0],segments=24)=>item(name,new THREE.CylinderGeometry(r,r,h,segments),material,parent,pos,rot);
  const torus=(name,r,t,material,pos,parent,rot=[0,0,0],arc=Math.PI*2)=>item(name,new THREE.TorusGeometry(r,t,10,36,arc),material,parent,pos,rot);
  function beam(name,a,b,r,material,parent){const aa=V(...a),bb=V(...b),dir=bb.clone().sub(aa);const m=cyl(name,r,dir.length(),material,aa.add(bb).multiplyScalar(.5).toArray(),parent);m.quaternion.setFromUnitVectors(V(0,1,0),dir.normalize());return m;}
  function hose(name,pts,r,material,parent){return item(name,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p=>V(...p))),32,r,8,false),material,parent);}
  function floorRect(id,x1,z1,x2,z2,wet=false){
    const map=(wet?tileMap:floorMap).clone();map.needsUpdate=true;
    map.repeat.set((x2-x1)/(wet?1.2:2.0),(z2-z1)/(wet?1.2:1.4));
    const m=std('#ffffff',wet?.6:.73,0,{map});
    const q=box('floor-'+id,x2-x1,.025,z2-z1,m,[(x1+x2)/2,.012,(z1+z2)/2],floors,0);
    q.userData.room=id;q.userData.kind='floor';return q;
  }
  const outline=[[-2.25,-2.85],[.75,-2.85],[.75,-7.55],[2.55,-7.55],[2.55,-1.45],[1.35,-1.45],[1.35,7.45],[-2.25,7.45]];
  const shp=new THREE.Shape();outline.forEach(([x,z],i)=>i?shp.lineTo(x,-z):shp.moveTo(x,-z));shp.closePath();
  const slab=new THREE.ExtrudeGeometry(shp,{depth:.2,bevelEnabled:false});slab.rotateX(-Math.PI/2);
  item('folded-plan-foundation',slab,std('#c4c4bb',.9),floors,[0,-.2,0]);
  floorRect('bedroom',-2.13,1.37,1.23,6.13);
  floorRect('living',-2.13,-1.23,1.23,1.13);
  floorRect('entry',.27,-2.73,2.43,-1.57,true);
  floorRect('entry-link',.27,-1.57,1.23,-1.23,true);
  floorRect('bathroom',-2.13,-2.73,.03,-1.47,true);
  floorRect('kitchen',.87,-6.13,2.43,-2.97,true);
  floorRect('north-balcony',.87,-7.43,2.43,-6.13,true);
  floorRect('south-balcony',-2.13,6.13,1.23,7.33,true);

  function wallSegment(name,x1,z1,x2,z2,bottom=0,top=WALL_H,cutaway=false,material=mat.wall,thickness=.16){
    if(top-bottom<.008)return;
    const len=Math.hypot(x2-x1,z2-z1),rot=[0,-Math.atan2(z2-z1,x2-x1),0];
    const add=(low,high,upper)=>{
      if(high-low<.008)return;
      const m=box(name+(upper?'-upper':'-base'),len,high-low,thickness,material,[(x1+x2)/2,(low+high)/2,(z1+z2)/2],walls,.006,rot,{kind:'wall',cutawayUpper:upper,fullHeight:WALL_H});
      if(upper)m.visible=false;
    };
    if(cutaway){add(bottom,Math.min(top,.78),false);add(Math.max(bottom,.78),top,true);}else add(bottom,top,false);
  }
  function wall(name,x1,z1,x2,z2,openings=[],cutaway=false,material=mat.wall){
    const len=Math.hypot(x2-x1,z2-z1),dx=(x2-x1)/len,dz=(z2-z1)/len,points=[0,len];
    openings.forEach(o=>points.push(o.start,o.start+o.width));points.sort((a,b)=>a-b);
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i];if(b-a<.01)continue;
      const op=openings.find(o=>(a+b)/2>o.start-.001&&(a+b)/2<o.start+o.width+.001);
      const p=[x1+a*dx,z1+a*dz,x1+b*dx,z1+b*dz];
      if(op){wallSegment(name+'-'+i+'-sill',...p,0,op.bottom||0,cutaway,material);wallSegment(name+'-'+i+'-header',...p,op.top||2.16,WALL_H,cutaway,material);}
      else wallSegment(name+'-'+i,...p,0,WALL_H,cutaway,material);
    }
  }
  const wetWallMap=tileMap.clone();wetWallMap.repeat.set(1.8,2);wetWallMap.needsUpdate=true;
  const wetWall=std('#ffffff',.56,0,{map:wetWallMap});
  wall('main-west',-2.25,-2.85,-2.25,6.25,[],false);
  wall('north-shoulder',-2.25,-2.85,.75,-2.85,[],false);
  wall('kitchen-west',.75,-2.85,.75,-6.25,[],false,wetWall);
  wall('north-balcony-west',.75,-6.25,.75,-7.55,[{start:.12,width:1.06,bottom:.95,top:2.58}],false,wetWall);
  wall('north-glazing',.75,-7.55,2.55,-7.55,[{start:.12,width:1.56,bottom:.95,top:2.58}],false,wetWall);
  wall('kitchen-east',2.55,-7.55,2.55,-1.45,[],true,wetWall);
  wall('entry-return',2.55,-1.45,1.35,-1.45,[],true);
  wall('main-east',1.35,-1.45,1.35,6.25,[{start:.25,width:.92,bottom:0,top:2.14}],true);
  wall('bath-south',-2.25,-1.35,.15,-1.35,[],true,wetWall);
  wall('bath-east',.15,-2.85,.15,-1.35,[{start:.3,width:.84,bottom:0,top:2.12}],true,wetWall);
  wall('kitchen-door-wall',.75,-2.85,2.55,-2.85,[{start:.2,width:.86,bottom:0,top:2.14}],false);
  wall('bedroom-north',-2.25,1.25,1.35,1.25,[{start:.87,width:1.18,bottom:1.1,top:2.18},{start:2.55,width:.91,bottom:0,top:2.16}],true);
  wall('bedroom-south',-2.25,6.25,1.35,6.25,[{start:.35,width:2.55,bottom:0,top:2.53}],true);
  wall('south-balcony-west',-2.25,6.25,-2.25,7.45,[{start:.13,width:.95,bottom:.88,top:2.6}],false);
  wall('south-balcony-east',1.35,6.25,1.35,7.45,[{start:.13,width:.95,bottom:.88,top:2.6}],true);
  wall('south-balcony-front',-2.25,7.45,1.35,7.45,[{start:.13,width:3.34,bottom:.88,top:2.6}],true);
  function skirting(name,a,b,parent=floors){beam(name,a,b,.022,mat.white,parent);}
  skirting('west-bedroom-skirting',[-2.15,.075,1.37],[-2.15,.075,6.1]);
  skirting('east-bedroom-skirting',[1.23,.075,1.37],[1.23,.075,6.1]);
  skirting('living-west-skirting',[-2.14,.075,-1.23],[-2.14,.075,1.12]);

  function windowUnit(name,x,z,w,bottom,height,angle=0,cols=2,room='shared',safety=false){
    const g=assembly(name,windows,room,{kind:'window',evidence:'reference-photo'});g.position.set(x,bottom,z);g.rotation.y=angle;
    const fw=.045,trans=height-.45;
    box(name+'-left-jamb',fw,height,.09,mat.white,[-w/2+fw/2,height/2,0],g,.006);
    box(name+'-right-jamb',fw,height,.09,mat.white,[w/2-fw/2,height/2,0],g,.006);
    [0,trans,height].forEach((y,i)=>box(name+'-horizontal-'+i,w,.045,.095,mat.white,[0,y,0],g,.005));
    box(name+'-sill',w+.13,.045,.25,mat.white,[0,-.025,.025],g,.007);
    for(let i=0;i<cols;i++){
      const cw=(w-fw*2)/cols,cx=-w/2+fw+cw*(i+.5);
      if(i)box(name+'-mullion-'+i,.035,height,.10,mat.white,[-w/2+fw+cw*i,height/2,.012],g,.004);
      const pane=box(name+'-pane-'+i,cw-.03,trans-.06,.012,mat.glass,[cx,trans/2,.005],g,0);pane.castShadow=false;
      const tp=box(name+'-transom-pane-'+i,cw-.03,height-trans-.05,.012,mat.glass,[cx,(height+trans)/2,.005],g,0);tp.castShadow=false;
      box(name+'-handle-'+i,.018,.1,.027,mat.white,[cx+cw*.32,trans*.5,.063],g,.004);
    }
    if(safety){
      const positions=[];
      for(let a=-height;a<w+height;a+=.18){
        let x1=Math.max(0,a),y1=Math.max(0,-a),x2=Math.min(w,a+height),y2=Math.min(height,w-a);
        if(x2>x1){positions.push(x1-w/2,y1,-.05,x2-w/2,y2,-.05);}
      }
      const gg=new THREE.BufferGeometry();gg.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      const line=new THREE.LineSegments(gg,new THREE.LineBasicMaterial({color:'#87948f',transparent:true,opacity:.35}));line.name=name+'-safety-mesh';line.userData={id:line.name,kind:'safety-grille',room,pickable:true,source:SOURCE};g.add(line);
    }
    return g;
  }
  windowUnit('bedroom-internal-window',-.79,1.25,1.18,1.1,1.08,0,2,'bedroom');
  windowUnit('south-balcony-window',-.45,7.45,3.34,.88,1.72,0,4,'south-balcony');
  windowUnit('south-west-side-window',-2.25,6.85,.95,.88,1.72,Math.PI/2,1,'south-balcony');
  windowUnit('south-east-side-window',1.35,6.85,.95,.88,1.72,Math.PI/2,1,'south-balcony');
  windowUnit('north-balcony-window',1.65,-7.55,1.56,.95,1.63,0,2,'north-balcony',true);
  windowUnit('north-west-side-window',.75,-6.9,1.06,.95,1.63,Math.PI/2,1,'north-balcony');

  function doorUnit(name,x,z,w,h=2.12,angle=0,open=.0,dark=false,room='shared'){
    const g=assembly(name,doors,room,{kind:'door',hinged:true});g.position.set(x,0,z);g.rotation.y=angle;
    box(name+'-jamb-l',.065,h+.04,.17,mat.white,[-w/2-.03,h/2,0],g,.006);
    box(name+'-jamb-r',.065,h+.04,.17,mat.white,[w/2+.03,h/2,0],g,.006);
    box(name+'-header',w+.12,.065,.17,mat.white,[0,h+.01,0],g,.006);
    const hinge=assembly(name+'-hinge',g,room,{kind:'hinge'});hinge.position.x=-w/2;hinge.rotation.y=open;
    box(name+'-leaf',w-.02,h-.025,.045,dark?mat.dark:mat.white,[w/2,h/2,.015],hinge,.006);
    for(const side of[-1,1]){
      box(name+'-handle-rosette-'+side,.055,.1,.018,mat.black,[w-.12,1.03,side*.04],hinge,.012);
      box(name+'-lever-'+side,.14,.021,.026,mat.black,[w-.17,1.05,side*.06],hinge,.008);
    }
    return {group:g,hinge,width:w};
  }
  const entrance=doorUnit('entrance-door',1.35,-.74,.92,2.12,Math.PI/2,0,true,'living');
  doorUnit('bedroom-door',.755,1.25,.91,2.14,0,-.35,false,'bedroom');
  doorUnit('bathroom-door',.15,-2.13,.84,2.1,Math.PI/2,.45,false,'bathroom');
  doorUnit('kitchen-door',1.38,-2.85,.86,2.12,0,-.48,false,'kitchen');

  function radiator(name,x,z,width=.9,angle=0,room='living'){
    const g=assembly(name,furnishingGroups[room],room);g.position.set(x,0,z);g.rotation.y=angle;
    const n=Math.max(8,Math.floor(width/.072));
    for(let i=0;i<n;i++)box(name+'-column-'+i,.048,.70,.095,mat.white,[-width/2+(i+.5)*width/n,.52,0],g,.022);
    beam(name+'-upper-pipe',[-width/2,.83,0],[width/2,.83,0],.022,mat.white,g);
    beam(name+'-lower-pipe',[-width/2,.21,0],[width/2,.21,0],.022,mat.white,g);
    beam(name+'-valve',[width/2,.79,0],[width/2+.10,.79,0],.018,mat.metal,g);
    cyl(name+'-valve-knob',.027,.06,mat.white,[width/2+.1,.8,0],g,[0,0,Math.PI/2]);return g;
  }
  radiator('bedroom-column-radiator',-.6,6.18,1.13,0,'bedroom');
  radiator('entry-column-radiator',1.18,.48,.76,Math.PI/2,'living');

  function curtain(name,x,z,width,height,material,parent,folds=7,angle=0,bottom=.06){
    const g=assembly(name,parent,parent.userData.room);g.position.set(x,bottom,z);g.rotation.y=angle;
    const nx=Math.ceil(folds*10),ny=24,geo=new THREE.PlaneGeometry(width,height,nx,ny),p=geo.attributes.position;
    for(let i=0;i<p.count;i++){
      const u=(p.getX(i)+width/2)/width,v=(p.getY(i)+height/2)/height;
      const wave=Math.sin(u*folds*Math.PI*2),wave2=Math.sin(u*folds*Math.PI*4+.6);
      p.setXYZ(i,p.getX(i)+.012*Math.sin(v*5+u*4),p.getY(i)+height/2+.016*Math.sin(u*9)*(1-v),.042*wave+.011*wave2+.015*Math.sin(v*3));
    }
    geo.computeVertexNormals();item(name+'-fabric',geo,material,g);
    hose(name+'-hem',Array.from({length:40},(_,i)=>{const u=i/39;return[-width/2+u*width,.04,.042*Math.sin(u*folds*Math.PI*2)];}),.007,material,g);
    return g;
  }
  const bedGroup=assembly('bed',furnishingGroups.bedroom,'bedroom',{evidence:['bedroom.webp','bedroom3.webp']});
  const bx=-.99,bz=3.83;
  box('bed-headboard',.11,.95,1.62,mat.headboard,[-2.02,.76,bz],bedGroup,.06);
  box('mattress',1.99,.19,1.51,mat.cloth,[bx,.54,bz],bedGroup,.065);
  for(const x of[bx-.94,bx+.94])for(const z of[bz-.71,bz+.71])cyl('bed-leg',.023,.36,mat.dark,[x,.2,z],bedGroup);
  for(const z of[bz-.755,bz+.755])beam('bed-side-rail',[bx-.98,.38,z],[bx+.98,.38,z],.024,mat.dark,bedGroup);
  for(const x of[bx-.98,bx+.98])beam('bed-end-rail',[x,.38,bz-.755],[x,.38,bz+.755],.024,mat.dark,bedGroup);
  // One continuous lightly wrinkled fitted-sheet surface.
  const sheetGeo=new THREE.PlaneGeometry(1.96,1.48,50,40);sheetGeo.rotateX(-Math.PI/2);
  const sp=sheetGeo.attributes.position;
  for(let i=0;i<sp.count;i++){
    const x=sp.getX(i),z=sp.getZ(i),edge=Math.pow(Math.abs(x)/.98,8)+Math.pow(Math.abs(z)/.74,8);
    sp.setY(i,.647+.0035*Math.sin(x*22+z*7)+.0018*Math.sin(z*49)-.010*edge);
  }sheetGeo.computeVertexNormals();item('fitted-sheet-top',sheetGeo,mat.cloth,bedGroup,[bx,0,bz]);
  for(const z of[bz-.751,bz+.751])hose('mattress-piped-seam',[[bx-.92,.61,z],[bx,.615,z],[bx+.92,.61,z]],.0035,mat.headboard,bedGroup);
  const art=assembly('red-art',furnishingGroups.bedroom,'bedroom');art.position.set(-2.145,1.87,bz);art.rotation.y=Math.PI/2;
  box('art-canvas',.77,.87,.018,mat.paper,[0,0,0],art,.003);
  for(const x of[-.397,.397])box('art-frame-upright',.024,.91,.035,mat.oak,[x,0,.012],art,.003);
  for(const y of[-.447,.447])box('art-frame-horizontal',.81,.024,.035,mat.oak,[0,y,.012],art,.003);
  const heart=new THREE.Shape();heart.moveTo(-.29,-.28);heart.bezierCurveTo(-.31,.02,-.2,.31,0,.34);heart.bezierCurveTo(.16,.26,.31,.05,.29,-.18);heart.bezierCurveTo(.28,-.24,.17,-.30,.11,-.31);heart.lineTo(.012,-.15);heart.lineTo(-.075,-.31);heart.bezierCurveTo(-.15,-.33,-.22,-.31,-.29,-.28);
  item('red-abstract-shape',new THREE.ShapeGeometry(heart,32),mat.red,art,[0,0,.012]);
  const wardrobe=assembly('wardrobe',furnishingGroups.bedroom,'bedroom');
  box('wardrobe-carcass',.61,2.13,1.03,mat.cabinet,[-1.80,1.085,1.96],wardrobe,.012);
  for(let i=0;i<2;i++){
    box('wardrobe-door-'+i,.025,2.07,.497,mat.white,[-1.483,1.09,1.70+i*.515],wardrobe,.006);
    box('wardrobe-handle-'+i,.021,.20,.018,mat.steel,[-1.46,1.04,1.94+(i? .04:-.04)],wardrobe,.003);
  }
  function chair(name,x,z,angle,parent,scale=1){
    const g=assembly(name,parent,parent.userData.room);g.position.set(x,0,z);g.rotation.y=angle;g.scale.setScalar(scale);
    box(name+'-seat',.43,.035,.43,mat.oak,[0,.455,0],g,.045);
    const back=box(name+'-curved-back',.435,.285,.035,mat.oak,[0,.72,.205],g,.055,[.14,0,0]);
    for(const side of[-1,1]){
      beam(name+'-front-leg',[side*.19,.025,-.20],[side*.18,.46,-.13],.018,mat.black,g);
      beam(name+'-rear-leg',[side*.21,.025,.22],[side*.18,.82,.23],.019,mat.black,g);
      beam(name+'-seat-support',[side*.18,.41,-.14],[side*.18,.43,.20],.015,mat.black,g);
    }
    return g;
  }
  const desk=assembly('desk',furnishingGroups.bedroom,'bedroom');
  box('desk-top',.58,.045,.97,mat.oak,[-1.78,.755,5.43],desk,.018);
  for(const x of[-2.0,-1.55])for(const z of[5.04,5.82])beam('desk-leg',[x,.025,z],[x,.73,z],.024,mat.oak,desk);
  chair('desk-chair',-1.08,5.43,Math.PI/2,furnishingGroups.bedroom,.94);
  const lamp=assembly('desk-lamp',desk,'bedroom');lamp.position.set(-1.82,.79,5.12);
  cyl('lamp-base',.07,.018,mat.white,[0,0,0],lamp);
  beam('lamp-upright',[0,0,0],[0,.28,0],.008,mat.steel,lamp);
  beam('lamp-arm',[0,.28,0],[.13,.31,0],.007,mat.steel,lamp);
  const shade=item('lamp-shade',new THREE.ConeGeometry(.08,.06,24,1,true),mat.white,lamp,[.13,.295,0]);shade.rotation.z=.12;
  const vase=item('small-desk-vase',new THREE.LatheGeometry([new THREE.Vector2(.035,0),new THREE.Vector2(.045,.025),new THREE.Vector2(.043,.11),new THREE.Vector2(.025,.14)],24),std('#9ba99c',.55),desk,[-1.87,.78,5.72]);
  for(let i=0;i<4;i++)beam('vase-stem',[-1.87,.9,5.72],[-1.87+Math.sin(i*2)*.06,1.05+i*.035,5.72+Math.cos(i*2)*.03],.0025,mat.green,desk);
  curtain('balcony-curtain-west',-1.91,6.10,.40,2.48,mat.curtain,furnishingGroups.bedroom,6);
  curtain('balcony-curtain-east',1.0,6.10,.42,2.48,mat.curtain,furnishingGroups.bedroom,6);
  beam('balcony-curtain-rail',[-2.10,2.58,6.08],[1.19,2.58,6.08],.013,mat.steel,furnishingGroups.bedroom);
  curtain('internal-window-curtain',-1.36,1.40,.33,1.62,mat.curtain,furnishingGroups.bedroom,5,0,.82);
  beam('internal-window-curtain-rail',[-1.57,2.48,1.40],[-.16,2.48,1.40],.01,mat.steel,furnishingGroups.bedroom);

  const dining=assembly('dining-set',furnishingGroups.living,'living');
  cyl('round-oak-tabletop',.53,.04,mat.oak,[-.92,.755,-.19],dining,[0,0,0],64);
  for(const [x,z] of[[-1.23,-.48],[-.61,-.48],[-1.23,.10],[-.61,.10]])beam('dining-table-leg',[x,.025,z],[x,.73,z],.027,mat.oak,dining);
  chair('dining-chair-north',-.92,-.96,Math.PI,dining);
  chair('dining-chair-east',-.13,-.19,Math.PI/2,dining);
  chair('dining-chair-south',-.92,.59,0,dining);
  const fridge=assembly('fridge',furnishingGroups.living,'living');fridge.position.set(-1.80,0,.75);fridge.rotation.y=Math.PI/2;
  box('fridge-body',.58,1.79,.62,mat.silver,[0,.92,0],fridge,.018);
  for(const [y,h] of[[1.31,.94],[.674,.30],[.285,.43]])box('fridge-door-'+y,.565,h,.036,mat.silver,[0,y,.328],fridge,.012);
  for(const y of[.824,.51])box('fridge-dark-recess',.55,.026,.022,mat.black,[0,y,.349],fridge,.003);
  item('fridge-energy-label',new THREE.PlaneGeometry(.062,.11),std('#ffffff',.7,0,{map:texture('label')}),fridge,[.19,1.70,.351]);
  const fan=assembly('tower-appliance',furnishingGroups.living,'living');fan.position.set(-1.82,0,-.01);
  box('tower-body',.25,.88,.24,mat.silver,[0,.46,0],fan,.04);
  box('tower-front-grill',.205,.70,.018,mat.black,[0,.46,.126],fan,.018);
  for(let i=0;i<11;i++)box('tower-grill-fin-'+i,.006,.66,.014,mat.dark,[-.09+i*.018,.46,.14],fan,.001);
  cyl('tower-control',.025,.004,mat.black,[0,.905,0],fan);

  function cabinet(name,x,y,z,w,h,d,parent,front='west',material=mat.white){
    const g=assembly(name,parent,parent.userData.room);box(name+'-body',w,h,d,mat.cabinet,[x,y,z],g,.008);
    if(front==='west'){
      box(name+'-front',.025,h-.028,d-.02,material,[x-w/2-.014,y,z],g,.006);
      box(name+'-handle',.027,.018,d*.48,mat.steel,[x-w/2-.032,y+h*.34,z],g,.004);
    }else{
      box(name+'-front',w-.02,h-.028,.025,material,[x,y,z+d/2+.014],g,.006);
    }return g;
  }
  const kitchen=furnishingGroups.kitchen;
  // The sink cabinet is a hollow carcass. A solid top would incorrectly fill the
  // counter opening and hide the actual basin depth from the overhead view.
  const sinkCab=assembly('base-cabinet-sink',kitchen,'kitchen');
  box('sink-cabinet-front',.025,.832,.88,mat.white,[1.846,.46,-5.65],sinkCab,.006);
  box('sink-cabinet-handle',.027,.018,.43,mat.steel,[1.828,.752,-5.65],sinkCab,.004);
  box('sink-cabinet-back',.018,.86,.90,mat.cabinet,[2.451,.46,-5.65],sinkCab,.003);
  box('sink-cabinet-bottom',.60,.018,.90,mat.cabinet,[2.16,.04,-5.65],sinkCab,.003);
  for(const z of[-6.09,-5.21])box('sink-cabinet-side',.60,.86,.018,mat.cabinet,[2.16,.46,z],sinkCab,.003);
  for(const [i,z,d] of[[1,-4.875,.62],[2,-4.175,.74],[3,-3.50,.59]])cabinet('base-cabinet-'+i,2.16,.46,z,.60,.86,d,kitchen);
  box('kitchen-plinth',.51,.10,2.79,mat.steel,[2.19,.07,-4.66],kitchen,.003);
  const ct=new THREE.Shape();ct.moveTo(-.325,-1.43);ct.lineTo(.325,-1.43);ct.lineTo(.325,1.43);ct.lineTo(-.325,1.43);ct.closePath();
  const hole=new THREE.Path();hole.moveTo(-.22,.59);hole.lineTo(-.22,1.10);hole.lineTo(.22,1.10);hole.lineTo(.22,.59);hole.closePath();ct.holes.push(hole);
  const counterGeo=new THREE.ExtrudeGeometry(ct,{depth:.035,bevelEnabled:true,bevelSize:.004,bevelThickness:.004,bevelSegments:2});counterGeo.rotateX(-Math.PI/2);
  item('quartz-counter-with-sink-opening',counterGeo,mat.counter,kitchen,[2.16,.895,-4.66]);
  // Sink: rim and open sloped basin, with the actual counter opening above it.
  const sink=assembly('kitchen-sink',kitchen,'kitchen');sink.position.set(2.16,.90,-5.505);
  for(const x of[-.23,.23])box('sink-rim-x',.025,.014,.55,mat.metal,[x,.025,0],sink,.005);
  for(const z of[-.265,.265])box('sink-rim-z',.48,.014,.025,mat.metal,[0,.025,z],sink,.005);
  const basinPositions=[-.215,.018,-.25,.215,.018,-.25,.215,.018,.25,-.215,.018,.25,-.165,-.16,-.20,.165,-.16,-.20,.165,-.16,.20,-.165,-.16,.20];
  const basinIndex=[0,5,1,0,4,5,1,6,2,1,5,6,2,7,3,2,6,7,3,4,0,3,7,4,4,6,5,4,7,6];
  const basin=new THREE.BufferGeometry();basin.setAttribute('position',new THREE.Float32BufferAttribute(basinPositions,3));basin.setIndex(basinIndex);basin.computeVertexNormals();
  item('open-stainless-basin',basin,mat.steel,sink);
  cyl('sink-drain',.028,.004,mat.black,[0,-.156,0],sink);
  hose('curved-kitchen-faucet',[[.24,.015,0],[.25,.28,0],[.18,.36,0],[.02,.34,0],[-.025,.25,0]],.013,mat.metal,sink);
  cyl('faucet-base',.026,.07,mat.metal,[.24,.055,0],sink);
  const hob=assembly('hob-and-hood',kitchen,'kitchen');
  box('black-glass-hob',.53,.025,.72,mat.black,[2.13,.953,-3.60],hob,.016);
  for(const z of[-3.82,-3.40]){
    cyl('burner-base',.116,.018,mat.dark,[2.13,.976,z],hob);
    torus('burner-ring',.082,.008,mat.black,[2.13,1.006,z],hob,[Math.PI/2,0,0]);
    for(let i=0;i<4;i++){const a=i*Math.PI/2;beam('hob-pot-support',[2.13+Math.cos(a)*.04,1.025,z+Math.sin(a)*.04],[2.13+Math.cos(a)*.135,1.025,z+Math.sin(a)*.135],.008,mat.black,hob);}
  }
  for(const z of[-3.70,-3.49])cyl('hob-knob',.022,.022,mat.steel,[1.94,.979,z],hob);
  for(let i=0;i<4;i++)cabinet('upper-cabinet-'+i,2.30,2.19,-5.77+i*.66,.43,.77,.645,kitchen);
  box('hood-body',.58,.12,.82,mat.steel,[2.17,1.76,-3.60],hob,.018);
  box('hood-black-control-face',.035,.15,.82,mat.black,[1.87,1.78,-3.60],hob,.008);
  for(let i=0;i<15;i++)box('hood-vent-slat-'+i,.40,.008,.010,mat.dark,[2.17,1.689,-3.94+i*.048],hob,.001);
  for(let i=0;i<4;i++)cyl('hood-button-'+i,.010,.006,mat.silver,[1.848,1.78,-3.74+i*.07],hob,[0,0,Math.PI/2],12);
  for(const z of[-4.85,-4.63])box('kitchen-outlet',.014,.085,.085,mat.white,[2.454,1.23,z],kitchen,.007);
  beam('kitchen-utility-pipe',[.87,.72,-5.9],[.87,.72,-3.12],.018,mat.white,kitchen);

  const laundry=furnishingGroups['north-balcony'];
  const washer=assembly('washer',laundry,'north-balcony');washer.position.set(2.10,0,-6.74);washer.rotation.y=-Math.PI/2;
  box('washer-body',.60,.86,.58,mat.white,[0,.455,0],washer,.026);
  box('washer-top',.62,.03,.61,mat.white,[0,.90,0],washer,.012);
  box('washer-control-strip',.56,.13,.018,mat.cabinet,[0,.79,.299],washer,.008);
  cyl('washer-selector',.031,.014,mat.silver,[.10,.80,.318],washer,[Math.PI/2,0,0]);
  box('washer-display',.13,.041,.012,mat.black,[-.12,.81,.316],washer,.003);
  torus('washer-door-rim',.19,.034,mat.white,[0,.435,.31],washer);
  torus('washer-door-seal',.155,.017,mat.dark,[0,.435,.32],washer);
  cyl('washer-door-glass',.143,.025,std('#465e66',.13,.2,{transparent:true,opacity:.8}),[0,.435,.318],washer,[Math.PI/2,0,0],40);
  box('washer-door-handle',.018,.09,.025,mat.silver,[.18,.47,.346],washer,.006);
  const heater=assembly('water-heater',laundry,'north-balcony');heater.position.set(2.40,1.99,-6.75);heater.rotation.y=-Math.PI/2;
  box('heater-casing',.40,.65,.23,mat.white,[0,0,0],heater,.025);
  box('heater-dark-panel',.35,.10,.016,mat.black,[0,-.22,.125],heater,.006);
  for(const x of[-.09,.09])cyl('heater-dial',.023,.014,mat.silver,[x,-.22,.143],heater,[Math.PI/2,0,0]);
  for(const x of[-.10,.10])hose('heater-water-pipe',[[x,-.33,0],[x,-.46,.025],[x,-.54,-.04]],.009,mat.metal,heater);
  hose('heater-flue',[[0,.33,0],[0,.47,0],[.18,.53,0],[.4,.53,0]],.045,mat.steel,heater);
  hose('washer-supply-hose',[[2.40,.65,-6.72],[2.42,.92,-6.9],[2.43,1.55,-6.91]],.009,mat.white,laundry);

  const bath=furnishingGroups.bathroom;
  // Taupe interior wall linings match the wet-zone photographs.
  box('bath-west-tile-lining',.014,2.60,1.24,wetWall,[-2.154,1.32,-2.10],bath,0);
  box('bath-north-tile-lining',2.14,2.60,.014,wetWall,[-1.05,1.32,-2.754],bath,0);
  const toilet=assembly('toilet',bath,'bathroom');toilet.position.set(-.49,0,-1.91);toilet.rotation.y=Math.PI;
  const profile=[[.12,0],[.15,.04],[.13,.18],[.19,.29],[.24,.38],[.25,.42],[.215,.43],[.18,.38],[.15,.32]].map(p=>new THREE.Vector2(...p));
  const bowl=item('toilet-porcelain-bowl',new THREE.LatheGeometry(profile,48),mat.porcelain,toilet,[0,.045,.04]);bowl.scale.z=1.32;
  const seat=torus('toilet-seat',.22,.023,mat.porcelain,[0,.479,.04],toilet,[Math.PI/2,0,0]);seat.scale.y=1.34;
  const water=cyl('toilet-water',.13,.006,mat.water,[0,.36,.04],toilet);water.scale.z=1.25;
  box('toilet-cistern',.42,.43,.17,mat.porcelain,[0,.63,-.25],toilet,.04);
  box('toilet-cistern-lid',.44,.035,.19,mat.white,[0,.86,-.25],toilet,.015);
  box('toilet-flush-button',.07,.008,.045,mat.silver,[0,.883,-.25],toilet,.009);
  const shower=assembly('shower',bath,'bathroom');
  box('shower-pan',.82,.035,1.16,mat.porcelain,[-1.64,.047,-2.11],shower,.014);
  box('shower-drain',.09,.008,.09,mat.steel,[-1.91,.069,-2.51],shower,.003);
  for(let i=0;i<4;i++)box('drain-slot',.006,.002,.06,mat.dark,[-1.94+i*.018,.074,-2.51],shower,0);
  beam('shower-riser',[-2.06,.94,-2.36],[-2.06,2.18,-2.36],.014,mat.metal,shower);
  hose('shower-head-arm',[[-2.06,2.18,-2.36],[-2.04,2.31,-2.36],[-1.78,2.33,-2.36],[-1.70,2.28,-2.36]],.014,mat.metal,shower);
  cyl('rain-shower-head',.13,.018,mat.metal,[-1.70,2.27,-2.36],shower);
  for(let i=0;i<12;i++){const a=i*Math.PI/6;cyl('shower-nozzle',.003,.003,mat.dark,[-1.70+Math.cos(a)*.085,2.258,-2.36+Math.sin(a)*.085],shower,[0,0,0],6);}
  beam('shower-mixer',[-2.05,1.0,-2.48],[-2.05,1.0,-2.24],.026,mat.metal,shower);
  hose('shower-handset-hose',[[-2.05,1.0,-2.26],[-1.97,.61,-2.25],[-1.96,.53,-2.45],[-2.02,1.51,-2.49]],.008,mat.metal,shower);
  beam('shower-handset',[-2.02,1.48,-2.49],[-1.97,1.66,-2.49],.014,mat.metal,shower);
  curtain('shower-curtain',-1.11,-2.30,.75,2.20,mat.showerCurtain,bath,6,Math.PI/2,.05);
  beam('shower-curtain-rail',[-1.11,2.36,-2.72],[-1.11,2.36,-1.50],.013,mat.metal,bath);
  for(let j=0;j<3;j++)beam('towel-shelf-bar',[-1.90,2.12,-1.52-j*.065],[-1.27,2.12,-1.52-j*.065],.009,mat.metal,bath);
  for(const x of[-1.90,-1.27])beam('towel-shelf-bracket',[x,1.99,-1.48],[x,2.12,-1.70],.009,mat.metal,bath);

  const wash=assembly('basin-and-mirror',furnishingGroups.entry,'entry');wash.position.set(2.36,0,-2.10);wash.rotation.y=-Math.PI/2;
  box('wash-area-tile',.90,2.60,.018,wetWall,[0,1.32,-.08],wash,0);
  box('basin-outer',.55,.14,.43,mat.porcelain,[0,.78,.10],wash,.045);
  box('basin-inset',.43,.015,.30,std('#d6dedb',.2),[0,.855,.11],wash,.06);
  cyl('basin-drain',.018,.005,mat.steel,[0,.865,.17],wash);
  beam('basin-faucet',[-.03,.87,-.01],[-.03,1.04,-.01],.016,mat.metal,wash);
  beam('basin-faucet-spout',[-.03,1.04,-.01],[-.03,1.04,.085],.014,mat.metal,wash);
  box('mirror-cabinet',.60,.81,.12,mat.white,[0,1.72,-.025],wash,.008);
  box('mirror-front',.57,.78,.008,mat.mirror,[0,1.72,.04],wash,.003);
  beam('visible-waste-pipe',[.39,.04,-.015],[.39,2.67,-.015],.043,mat.white,wash);
  for(const y of[.22,1.5,2.4])cyl('pipe-collar',.051,.07,mat.white,[.39,y,-.015],wash);
  hose('basin-trap',[[0,.70,.07],[0,.40,.07],[.08,.34,.01],[.08,.51,-.07]],.017,mat.metal,wash);
  box('wash-area-outlet',.09,.09,.025,mat.white,[-.39,1.27,-.05],wash,.008);

  const balcony=furnishingGroups['south-balcony'];
  for(const x of[-1.12,.35]){
    beam('drying-rail',[x,2.46,6.42],[x,2.46,7.27],.012,mat.metal,balcony);
    for(const z of[6.48,7.20])beam('drying-ceiling-suspension',[x,2.46,z],[x,2.69,z],.003,mat.steel,balcony);
  }
  // Demonstration devices are kept in a separate semantic layer.
  const devices=[];
  function device(id,name,room,position,builder){
    const g=assembly('device-'+id,deviceLayer,room,{kind:'device',deviceId:id,isDemo:true,placement:'illustrative'});g.position.copy(V(...position));builder(g);
    g.traverse(o=>{o.userData={...o.userData,deviceId:id,isDemo:true,room,pickable:true};});
    devices.push({id,name,position:V(...position),mesh:g,room,isDemo:true});return g;
  }
  device('gateway','演示网关','living',[1.17,1.94,-.12],g=>{
    box('gateway-housing',.065,.18,.26,mat.white,[0,0,0],g,.024);
    for(let i=0;i<4;i++)box('gateway-led-'+i,.008,.008,.013,i?mat.green:mat.blue,[-.038,-.035,-.07+i*.045],g,.003);
    beam('gateway-antenna-1',[0,.08,-.085],[0,.27,-.085],.008,mat.white,g);
    beam('gateway-antenna-2',[0,.08,.085],[0,.27,.085],.008,mat.white,g);
  });
  device('living-light','餐厅照明（演示）','living',[-.48,2.61,-.12],g=>{
    cyl('light-rim',.18,.085,mat.white,[0,0,0],g,[0,0,0],48);
    cyl('light-diffuser',.168,.016,mat.glow,[0,-.05,0],g,[0,0,0],48);
  });
  // A photographed bedroom ceiling disc is also represented as a furnishing.
  cyl('bedroom-ceiling-light-rim',.19,.08,mat.white,[-.45,2.61,3.65],furnishingGroups.bedroom,[0,0,0],48);
  cyl('bedroom-ceiling-light-diffuser',.18,.012,mat.glow,[-.45,2.564,3.65],furnishingGroups.bedroom,[0,0,0],48);
  device('bedroom-ac','卧室空调（演示）','bedroom',[1.18,2.27,5.55],g=>{
    box('ac-casing',.21,.29,.84,mat.white,[0,0,0],g,.05);
    box('ac-outlet',.025,.045,.70,mat.dark,[-.117,-.088,0],g,.008);
    for(let i=0;i<9;i++)box('ac-louver-'+i,.034,.026,.055,mat.white,[-.136,-.09,-.31+i*.077],g,.003);
    box('ac-indicator',.006,.018,.039,mat.blue,[-.11,.04,-.25],g,.002);
  });
  device('door-lock','入户门锁（演示）','living',[1.30,1.07,-.44],g=>{
    box('smart-lock-plate',.045,.31,.07,mat.black,[0,0,0],g,.018);
    box('smart-lock-screen',.006,.10,.052,mat.dark,[-.027,.07,0],g,.006);
    beam('smart-lock-lever',[-.04,-.045,0],[-.04,-.045,-.14],.011,mat.black,g);
    for(let j=0;j<3;j++)for(let k=0;k<3;k++)box('lock-key-'+j+'-'+k,.003,.003,.003,mat.silver,[-.031,.05+j*.018,-.016+k*.016],g,.001);
  });
  device('smoke-sensor','烟感（演示）','kitchen',[1.55,2.62,-3.10],g=>{
    cyl('smoke-sensor-puck',.056,.035,mat.white,[0,0,0],g);
    for(let i=0;i<10;i++){const a=i*Math.PI/5;box('smoke-vent-'+i,.014,.004,.004,mat.dark,[Math.cos(a)*.04,-.02,Math.sin(a)*.04],g,.001,[0,-a,0]);}
    cyl('smoke-status-led',.004,.002,mat.green,[0,-.020,0],g);
  });
  device('water-sensor','漏水传感器（演示）','north-balcony',[1.70,.055,-6.67],g=>{
    box('water-sensor-puck',.08,.027,.06,mat.white,[0,0,0],g,.014);
    cyl('water-sensor-mark',.012,.001,mat.blue,[0,.015,0],g);
    for(const z of[-.018,.018])cyl('water-contact',.004,.01,mat.steel,[0,-.018,z],g);
  });
  device('curtain-sensor','窗帘驱动（演示）','bedroom',[1.04,2.31,6.09],g=>{
    cyl('curtain-motor',.035,.34,mat.white,[0,0,0],g);
    cyl('curtain-motor-cap',.039,.025,mat.silver,[0,-.17,0],g);
  });

  // Every rendered mesh has a stable semantic part identity for ray casting.
  group.traverse(o=>{
    if(o.isMesh){o.userData.pickable=true;o.userData.source=SOURCE;o.userData.roomName=roomNames[o.userData.room]||'建筑结构';}
  });
  group.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(group);
  const metadata={
    title:'望京路3号院 · 参考户型重建',sourceURL:SOURCE,reportedArea:50.83,reportedLayout:'1室1厅1卫',reportedFloor:'5/7层',
    method:'依据户型图与实景照片的程序化近似重建',notMeasuredSurvey:true,
    wallHeight:WALL_H,wallGroupName:'walls',roofGroupName:'roof',deviceLayerName:'demo-devices',
    devicePlacementAndStatesAreDemo:true,
    disclaimer:'户型关系与主要陈设依据公开图片还原，尺寸、高度及遮挡部分为推断。智能设备位置与运行状态用于演示。',
    camera:{position:[12.8,21.8,17.4],target:[.15,.55,-.05],fov:37,orthographicVerticalSpan:18},
    planCamera:{position:[.15,25,.02],target:[.15,0,0],up:[0,0,-1]},
    roomIds:rooms.map(r=>r.id),boundsDimensions:bounds.getSize(V(0,0,0)).toArray(),
    materialAssumptions:'地面按照片灰米色与户型图木纹综合近似；木地板或木纹砖的实体材质无法由现有图片确认。',
    referenceFiles:['floorplan.webp','bedroom.webp','bedroom2.webp','bedroom3.webp','room4.webp','room5.webp','room6.webp','room7.webp','room8.webp','room9.webp','room10.webp']
  };
  return {group,devices,rooms,bounds,metadata};
}
