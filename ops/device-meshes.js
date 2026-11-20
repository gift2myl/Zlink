import * as THREE from './assets/vendor/three.module.js';

// Appearance references: 心舍3.0.1灵之解决方案简介, p.6.
// Proportions and all installation locations below are proposals, not surveys.
export const DEVICE_STATE_COLORS=Object.freeze({unknown:'#8f9ba8',affected:'#efad44',offline:'#ed5d67',fault:'#ed8b43',alarm:'#f04455'});
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const ROOM_ANCHORS={living:[-.45,0],entry:[1.37,-2.09],bedroom:[-.45,3.75],kitchen:[1.65,-4.55],bathroom:[-1.05,-2.10],'north-balcony':[1.65,-6.9],'south-balcony':[-.45,6.85]};
const ROOM_BOUNDS={living:[-2.10,-1.20,1.20,1.10],entry:[.30,-2.70,2.40,-1.60],bedroom:[-2.10,1.40,1.20,6.10],kitchen:[.90,-6.10,2.40,-3.00],bathroom:[-2.10,-2.70,0,-1.50],'north-balcony':[.90,-7.40,2.40,-6.15],'south-balcony':[-2.10,6.15,1.20,7.30]};

function inferForm(d){
  if(d.formFactor)return d.formFactor;
  const s=String(d.catalogId||d.name||'');
  return /max|网关/i.test(s)?'gateway':/ztouch|面屏|中控/i.test(s)?'control-panel':/lock|门锁/i.test(s)?'door-lock':/smoke|烟/i.test(s)?'smoke-sensor':/gas|燃气/i.test(s)?'gas-sensor':/ceiling|吸顶/i.test(s)?'ceiling-light':/curtain|窗帘/i.test(s)?'curtain-motor':'wall-switch';
}
function poseFor(d,index){
  const room=d.roomId||'living',base=ROOM_ANCHORS[room]||ROOM_ANCHORS.living;
  const form=inferForm(d);let p=[base[0],1.20,base[1]],y=0;
  // Existing dining surface (tabletop y=.775); a planning marker, not a
  // commissioned installation position. Keep the body clear of the fridge.
  if(form==='gateway')p=[-1.05,.805,-.30];
  else if(form==='door-lock'){p=[1.28,1.07,-.43];y=-Math.PI/2;}
  else if(form==='control-panel'||form==='wall-switch'||form==='socket'||form==='environment-sensor'){
    if(room==='bedroom'){p=[1.22,form==='socket'?.42:1.34,2.05];y=-Math.PI/2;}
    else if(room==='kitchen'){p=[2.42,1.25,-4.50];y=-Math.PI/2;}
    // The former z=.64 position was behind the fridge. This west-wall section
    // is within the living room and clear of its furniture.
    else{p=[-2.145,1.32,-.78];y=Math.PI/2;}
    if(form==='wall-switch')p[2]+=.26;
  }else if(form==='ceiling-light')p=[base[0],2.61,base[1]];
  else if(form==='surface-spotlight'||form==='recessed-spotlight')p=[base[0],2.56,base[1]];
  else if(form==='smoke-sensor')p=room==='living'?[-1.57,2.60,-.58]:[base[0]-.24,2.60,base[1]];
  // Kitchen west wall: east-side x=2.42 intersects the upper cabinets.
  // Height and gas-type suitability still require the actual installation plan.
  else if(form==='gas-sensor'){p=[.90,2.07,-4.60];y=Math.PI/2;}
  else if(form==='curtain-motor')p=room==='bedroom'?[1.04,2.30,6.08]:[base[0]+1.12,2.30,base[1]+.95];
  else if(form==='curtain-track'||form==='light-strip')p=room==='bedroom'?[-.45,2.58,6.08]:[base[0],2.58,base[1]+.95];
  else if(form==='wall-ac'){p=[1.18,2.27,5.55];y=-Math.PI/2;}
  else if(form==='floor-ac')p=[base[0]+1.2,.9,base[1]-.7];
  else if(form==='television')p=[base[0]-1.45,1.25,base[1]];
  else if(form==='hvac-controller')p=[base[0]+.70,.80,base[1]-.8];
  return {position:V(...p),rotation:y,roomKnown:!!ROOM_ANCHORS[room],form};
}

function modelFor(device,form){
  const group=new THREE.Group();group.name='configuration-device-'+device.id;
  const material=(color,roughness=.6,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  const white=material('#efefeb'),silver=material('#a9afb1',.30,.55),dark=material('#131d24',.40),screen=material('#0b1522',.25),glass=material('#283c52',.28),blue=material('#177fff',.38),warm=material('#fff4d5',.38),gray=material('#687986');
  const mats=[white,silver,dark,screen,glass,blue,warm,gray];
  const add=(geometry,mat,x=0,y=0,z=0)=>{const mesh=new THREE.Mesh(geometry,mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;};
  const box=(w,h,d,mat,x=0,y=0,z=0)=>add(new THREE.BoxGeometry(w,h,d),mat,x,y,z);
  const cylinder=(r,h,mat,x=0,y=0,z=0)=>add(new THREE.CylinderGeometry(r,r,h,20),mat,x,y,z);
  const disk=(r,h,mat,x=0,y=0,z=0)=>{const m=cylinder(r,h,mat,x,y,z);m.rotation.x=Math.PI/2;return m;};
  const line=(a,b,r,mat)=>{const av=V(...a),bv=V(...b),delta=bv.clone().sub(av);const m=cylinder(r,delta.length(),mat,...av.add(bv).multiplyScalar(.5).toArray());m.quaternion.setFromUnitVectors(V(0,1,0),delta.normalize());return m;};
  if(form==='gateway'){
    box(.25,.045,.175,white);box(.23,.008,.15,silver,0,-.025,0);
    for(const x of[-.095,.095]){line([x,.015,-.055],[x*1.25,.235,-.07],.009,white);cylinder(.011,.015,silver,x,.027,-.055);}
    for(let i=0;i<4;i++)box(.012,.004,.004,i?gray:blue,-.058+i*.038,.01,.089);
    for(let i=0;i<5;i++)box(.002,.008,.10,gray,-.08+i*.04,-.027,0);
  }else if(form==='control-panel'){
    box(.105,.105,.025,dark);box(.087,.087,.004,screen,0,.003,.015);
    box(.064,.012,.002,white,-.004,.028,.018);
    for(let j=0;j<2;j++)for(let i=0;i<3;i++)box(.018,.018,.002,(i+j)%3===0?blue:glass,-.026+i*.026,-.002-j*.025,.019);
    box(.026,.003,.002,gray,0,-.043,.018);
  }else if(form==='door-lock'){
    box(.063,.31,.027,dark);box(.048,.135,.004,screen,0,.064,.017);
    for(let j=0;j<3;j++)for(let i=0;i<3;i++)box(.004,.004,.002,silver,-.014+i*.014,.03+j*.024,.021);
    cylinder(.02,.015,dark,0,-.026,.025).rotation.x=Math.PI/2;
    box(.115,.025,.027,dark,.045,-.03,.046);box(.028,.016,.004,silver,0,-.115,.017);
  }else if(form==='ceiling-light'){
    const r=/45/.test(String(device.catalogId||device.model))?.24:.185;
    cylinder(r,.066,silver);cylinder(r*.965,.050,white,0,-.017,0);cylinder(r*.93,.008,warm,0,-.046,0);
  }else if(form==='smoke-sensor'||form==='gas-sensor'){
    const onWall=form==='gas-sensor';
    if(onWall){box(.088,.088,.017,white);disk(.035,.009,white,0,0,.014);disk(.016,.004,silver,0,0,.020);}
    else{cylinder(.058,.026,white);cylinder(.037,.008,silver,0,-.018,0);cylinder(.027,.006,white,0,-.024,0);}
    for(let i=0;i<8;i++){const a=i*Math.PI/4;
      if(onWall)box(.009,.002,.002,gray,Math.cos(a)*.027,Math.sin(a)*.027,.021);
      else box(.009,.003,.003,gray,Math.cos(a)*.043,-.017,Math.sin(a)*.043).rotation.y=-a;
    }
    if(onWall)box(.006,.003,.003,gray,0,-.026,.021);else cylinder(.004,.002,gray,0,-.028,0);
  }else if(form==='wall-switch'||form==='socket'||form==='environment-sensor'){
    box(.086,.086,.018,white);
    if(form==='socket'){
      for(const x of[-.018,.018])box(.005,.014,.003,dark,x,.012,.011);
      box(.004,.013,.003,dark,0,-.009,.011);box(.012,.005,.003,dark,-.019,-.026,.011);box(.009,.004,.003,dark,.017,-.026,.011);
    }else if(form==='environment-sensor'){
      for(let i=0;i<5;i++)box(.045,.002,.002,gray,0,-.013-i*.006,.012);box(.018,.005,.002,gray,0,.018,.012);
    }else{
      const s=String(device.model||device.name||'');const keys=/三|3/.test(s)?3:/双|二|2/.test(s)?2:1;
      for(let i=0;i<keys;i++){const x=-.036+(i+.5)*.072/keys;box(.072/keys-.002,.07,.005,white,x,.002,.013);box(.016,.002,.002,gray,x,-.026,.017);}
    }
  }else if(form==='surface-spotlight'||form==='recessed-spotlight'){
    cylinder(.055,.04,silver,0,.02,0);const head=new THREE.Group();head.rotation.z=.32;group.add(head);
    const body=cylinder(.049,.08,silver,0,-.03,0);group.remove(body);head.add(body);
    const face=cylinder(.040,.009,dark,0,-.075,0);group.remove(face);head.add(face);
    const lens=cylinder(.026,.010,warm,0,-.081,0);group.remove(lens);head.add(lens);
  }else if(form==='curtain-motor'){
    box(.05,.30,.045,white);box(.054,.018,.049,silver,0,.15,0);box(.008,.015,.002,gray,0,-.1,.024);
  }else if(form==='curtain-track'){
    box(2.5,.028,.035,silver);box(2.47,.006,.014,dark,0,-.018,0);
    for(let i=0;i<12;i++)box(.018,.022,.018,white,-1.1+i*.20,-.03,0);
  }else if(form==='light-strip'){
    box(2.5,.012,.018,white);box(2.48,.003,.016,warm,0,-.008,0);
  }else if(form==='hvac-controller'){
    box(.18,.11,.055,white);box(.16,.025,.004,gray,0,.025,.03);
    for(let i=0;i<8;i++)box(.01,.018,.004,dark,-.065+i*.019,-.04,.031);
  }else if(form==='wall-ac'){
    box(.84,.29,.21,white);box(.73,.045,.025,dark,0,-.08,.113);box(.69,.018,.03,white,0,-.095,.127);box(.04,.017,.003,gray,.27,.04,.108);
  }else if(form==='floor-ac'){
    cylinder(.17,1.8,white);box(.20,.6,.035,dark,0,.35,.16);box(.06,.05,.008,screen,0,.73,.174);
  }else if(form==='television'){
    box(1.25,.71,.045,dark);box(1.20,.66,.005,screen,0,.008,.027);line([-.35,-.36,0],[-.46,-.42,.10],.012,dark);line([.35,-.36,0],[.46,-.42,.10],.012,dark);
  }else if(form==='magnetic-track-light'){
    box(1.6,.045,.045,dark);for(const x of[-.5,0,.5]){cylinder(.04,.12,dark,x,-.065,0);cylinder(.032,.003,warm,x,-.128,0);}
  }else if(form==='roller-blind'||form==='venetian-blind'){
    box(1.5,.065,.065,white,0,0,0);
    if(form==='roller-blind')box(1.47,1.2,.018,white,0,-.63,0);else for(let i=0;i<14;i++)box(1.47,.056,.012,white,0,-.08-i*.075,0);
  }else box(.09,.09,.025,white);
  const indicatorMaterial=new THREE.MeshBasicMaterial({color:DEVICE_STATE_COLORS[device.state||'unknown'],transparent:true,opacity:.96,depthTest:false});
  const indicator=new THREE.Mesh(new THREE.TorusGeometry(.095,.007,5,24),indicatorMaterial);
  indicator.rotation.x=-Math.PI/2;indicator.position.y=form==='ceiling-light'?.10:.20;indicator.renderOrder=10;indicator.name='state-halo';group.add(indicator);
  group.userData={kind:'configured-device',deviceId:device.id,formFactor:form,placement:'proposed',sourcePage:6,notSurveyed:true,appearance:'reference-guided-approximation',state:device.state||'unknown'};
  group.traverse(o=>{o.userData={...o.userData,deviceId:device.id,room:device.roomId,pickable:true};});
  return {group,indicator,indicatorMaterial,materials:mats};
}

export function createDeviceLayer(devices=[],roomStates=[]) {
  const group=new THREE.Group();group.name='configured-smart-devices';
  const records=[],areas=[];
  for(let i=0;i<devices.length;i++){
    const d=devices[i],pose=poseFor(d,i);if(!pose.roomKnown)continue;
    const visual=modelFor(d,pose.form);visual.group.position.copy(pose.position);visual.group.rotation.y=pose.rotation;group.add(visual.group);
    records.push({...d,position:pose.position,mesh:visual.group,visual});
  }
  for(const [roomId,b]of Object.entries(ROOM_BOUNDS)){
    const state=roomStates.find(r=>r.roomId===roomId)?.state||'unknown';
    const mat=new THREE.MeshBasicMaterial({color:DEVICE_STATE_COLORS[state]||DEVICE_STATE_COLORS.fault,transparent:true,opacity:state==='unknown'?0:.14,depthWrite:false,side:THREE.DoubleSide});
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(b[2]-b[0],b[3]-b[1]),mat);floor.rotation.x=-Math.PI/2;floor.position.set((b[0]+b[2])/2,.045,(b[1]+b[3])/2);floor.renderOrder=2;floor.userData={kind:'room-state',roomId,pickable:false};group.add(floor);areas.push({roomId,floor,material:mat});
  }
  function applyState(summary){
    for(const record of records){const d=summary.devices.find(x=>x.id===record.id);if(!d)continue;record.state=d.state;record.stateLabel=d.stateLabel;record.mesh.userData.state=d.state;record.visual.indicatorMaterial.color.set(DEVICE_STATE_COLORS[d.state]||DEVICE_STATE_COLORS.unknown);record.visual.indicator.visible=true;}
    for(const a of areas){const state=summary.roomStates.find(r=>r.roomId===a.roomId)?.state||'unknown';a.material.color.set(DEVICE_STATE_COLORS[state]||DEVICE_STATE_COLORS.fault);a.material.opacity=state==='unknown'?0:.14;a.floor.visible=state!=='unknown';}
  }
  function dispose(){group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){const ms=Array.isArray(o.material)?o.material:[o.material];for(const m of ms)m.dispose();}});group.removeFromParent();}
  return {group,devices:records,roomAreas:areas,applyState,dispose};
}
