import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SVGRenderer } from './assets/vendor/renderers/SVGRenderer.js';
import { createCityMap } from './city-model.js';

export class SceneViewer {
  constructor(container, { geojson, districts, onDistrict, onDevice, onReady, active=true }) {
    this.container=container;this.geojson=geojson;this.districts=districts;this.onDistrict=onDistrict;this.onDevice=onDevice;this.onReady=onReady;this.active=active;
    this.mode='city';this.topView=false;this.labelLayer=document.getElementById('scene-labels');this.labelEntries=[];this.apartment=null;this.cutaway=true;this.clock=new THREE.Clock();
    this.scene=new THREE.Scene();
    this.software=false;
    try{this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});}catch(error){this.renderer=new SVGRenderer();this.renderer.setPrecision(2);this.software=true;this.container.dataset.renderMode='svg';}
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));this.renderer.setClearColor(0x111315,0);this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.2;
    if(this.renderer.shadowMap){this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;}
    this.renderer.domElement.setAttribute('aria-label','可旋转和缩放的三维房源场景');this.renderer.domElement.setAttribute('role','img');this.renderer.domElement.style.display=active?'':'none';container.prepend(this.renderer.domElement);
    this.camera=new THREE.PerspectiveCamera(40,1,.1,2000);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.07;this.controls.maxPolarAngle=Math.PI*.46;this.controls.minPolarAngle=.04;this.controls.enablePan=true;this.controls.autoRotateSpeed=.3;
    this.needsRender=true;this.controls.addEventListener('change',()=>this.needsRender=true);
    this.scene.add(new THREE.HemisphereLight(0xf1f4f7,0x353a40,2));
    this.sun=new THREE.DirectionalLight(0xfff6e9,3.8);this.sun.position.set(30,65,40);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.camera.left=-12;this.sun.shadow.camera.right=12;this.sun.shadow.camera.top=15;this.sun.shadow.camera.bottom=-15;this.sun.shadow.camera.near=.1;this.sun.shadow.camera.far=130;this.sun.shadow.bias=-.0003;this.sun.shadow.normalBias=.04;this.scene.add(this.sun);
    const rim=new THREE.DirectionalLight(0xdbe3eb,2);rim.position.set(-20,25,-30);this.scene.add(rim);
    this.fill=new THREE.DirectionalLight(0xf0f3f5,1.3);this.fill.position.set(-15,12,20);this.scene.add(this.fill);this.rim=rim;
    if(this.software){this.sun.intensity=.85;rim.intensity=.22;this.fill.intensity=.12;this.ambient=new THREE.AmbientLight(0xc7cbd1,.55);this.scene.add(this.ambient);}
    this.city=createCityMap(geojson,districts);this.scene.add(this.city.group);
    this.cityTarget=this.city.bounds.getCenter(new THREE.Vector3());this.cityTarget.y=0;
    this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.pointerDown=null;
    this.renderer.domElement.addEventListener('pointerdown',e=>this.pointerDown=[e.clientX,e.clientY]);
    this.renderer.domElement.addEventListener('pointerup',e=>{if(!this.pointerDown||Math.hypot(e.clientX-this.pointerDown[0],e.clientY-this.pointerDown[1])>5)return;this.pick(e);});
    this.renderer.domElement.addEventListener('pointermove',e=>{const hit=this.hit(e);this.renderer.domElement.style.cursor=hit?'pointer':'grab';});
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);
    this.setLabels(this.city.labels,'city');this.reset();this.resize();
    this.animationId=requestAnimationFrame(()=>this.animate());
    const loading=document.getElementById('scene-loading');if(loading&&active)loading.hidden=true;
    this.onReady?.();
  }
  setActive(active){this.active=!!active;this.renderer.domElement.style.display=this.active?'':'none';this.labelLayer.hidden=!this.active;if(!this.active)this.controls.autoRotate=false;else{this.needsRender=true;this.resize();}}
  async show(mode){
    this.mode=mode;this.controls.autoRotate=false;this.topView=false;
    if(mode==='apartment'&&!this.apartment){
      const {createApartment}=await import('./apartment-model.js');this.apartment=createApartment();this.scene.add(this.apartment.group);
      this.apartment.group.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
      const b=this.apartment.bounds instanceof THREE.Box3?this.apartment.bounds:new THREE.Box3().setFromObject(this.apartment.group);
      this.apartmentBounds=b;this.apartmentTarget=b.getCenter(new THREE.Vector3());this.apartmentTarget.y=.5;
      if(!this.software){const shadowFloor=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.ShadowMaterial({color:0x000814,opacity:.34}));shadowFloor.rotation.x=-Math.PI/2;shadowFloor.position.y=b.min.y-.03;shadowFloor.receiveShadow=true;this.apartment.group.add(shadowFloor);}
    }
    this.city.group.visible=mode==='city';if(this.apartment)this.apartment.group.visible=mode==='apartment';
    this.renderer.toneMappingExposure=mode==='city'?1.2:1.13;
    this.sun.castShadow=mode==='apartment';if(this.software){const apt=mode==='apartment';this.sun.intensity=apt?.60:.85;this.rim.intensity=apt?.14:.22;this.fill.intensity=apt?.08:.12;this.ambient.intensity=apt?.34:.55;}
    this.setLabels(mode==='city'?this.city.labels:[...(this.apartment.rooms||[]).map(r=>({...r,text:r.name,kind:'room'})),...(this.apartment.devices||[]).map(d=>({...d,text:d.name,kind:'device'}))],mode);
    this.reset();this.resize();
  }
  reset(){
    this.topView=false;
    if(this.mode==='city'){
      this.controls.target.copy(this.cityTarget);
      this.camera.position.copy(this.cityTarget).add(new THREE.Vector3(67,122,128));
      this.controls.minDistance=36;this.controls.maxDistance=400;this.camera.near=.2;this.camera.far=1500;
    }else{
      const t=this.apartmentTarget||new THREE.Vector3(0,.5,0);this.controls.target.copy(t);
      const max=Math.max(this.apartmentBounds?.getSize(new THREE.Vector3()).z||15,12);
      this.camera.position.copy(t).add(new THREE.Vector3(max*.50,max*.95,max*.62));
      this.controls.minDistance=4;this.controls.maxDistance=70;this.camera.near=.05;this.camera.far=250;
    }
    this.camera.lookAt(this.controls.target);this.camera.updateProjectionMatrix();this.controls.update();
  }
  toggleTop(){this.topView=!this.topView;const target=this.controls.target;const distance=this.mode==='city'?190:22;if(this.topView)this.camera.position.copy(target).add(new THREE.Vector3(0,distance,.001));else this.reset();this.controls.update();return this.topView;}
  setRotate(active){this.controls.autoRotate=active;return active;}
  focusDistrict(id){const p=this.city.focusPositions[id];if(!p)return;this.controls.target.copy(p);this.camera.position.copy(p).add(new THREE.Vector3(48,70,65));this.controls.update();for(const l of this.labelEntries)l.el.classList.toggle('selected',l.data.districtId===id);}
  focusDevice(id){if(!this.apartment)return;const d=this.apartment.devices.find(d=>d.id===id);if(!d)return;const p=d.position.clone();this.controls.target.copy(p);this.camera.position.copy(p).add(new THREE.Vector3(5.3,4.1,6));this.controls.update();}
  toggleWalls(){this.cutaway=!this.cutaway;if(this.apartment)this.apartment.group.traverse(o=>{if(o.userData?.cutawayUpper)o.visible=!this.cutaway;});this.needsRender=true;return this.cutaway;}
  setDeviceState(id,status){if(!this.apartment)return;const d=this.apartment.devices.find(d=>d.id===id);if(!d)return;for(const l of this.labelEntries)if(l.data.id===id)l.el.classList.toggle('alert',status==='offline');}
  setLabels(labels,mode){
    this.labelLayer.replaceChildren();this.labelEntries=[];
    this.leaders=document.createElementNS('http://www.w3.org/2000/svg','svg');this.leaders.classList.add('label-leaders');this.labelLayer.append(this.leaders);
    for(const data of labels){
      const el=document.createElement(data.kind==='room'?'span':'button');el.className='map-label';
      if(mode==='city'){
        const d=this.districts.find(d=>d.id===data.districtId);const name=document.createElement('span');name.textContent=data.text;const n=document.createElement('b');n.textContent=(d?.countLabel||'—')+' 套';el.append(name,n);el.title=data.text+' · 区域聚合房源';el.addEventListener('click',()=>this.onDistrict?.(data.districtId));
      }else{
        el.textContent=data.kind==='device'?'●':data.text;el.title=data.text;el.classList.add(data.kind==='room'?'room-label':'device-label');
        if(data.kind==='device'){el.setAttribute('aria-label','查看演示设备 '+data.text);el.addEventListener('click',()=>this.onDevice?.(data.id));if(data.id==='gateway')el.classList.add('alert');}
      }
      this.labelLayer.append(el);const line=document.createElementNS('http://www.w3.org/2000/svg','line');this.leaders.append(line);this.labelEntries.push({el,data,line});
    }
  }
  hit(e){const r=this.renderer.domElement.getBoundingClientRect();if(!r.width||!r.height)return;this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);const objects=this.mode==='city'?[this.city.group]:[this.apartment?.group].filter(Boolean);const hits=this.raycaster.intersectObjects(objects,true);return hits.find(h=>h.object.userData?.districtId||h.object.userData?.deviceId);}
  pick(e){const hit=this.hit(e);if(!hit)return;const d=hit.object.userData;if(d.districtId)this.onDistrict?.(d.districtId);if(d.deviceId)this.onDevice?.(d.deviceId);}
  resize(){const r=this.container.getBoundingClientRect();if(r.width<1||r.height<1)return;this.renderer.setSize(r.width,r.height,false);this.camera.aspect=r.width/r.height;this.camera.updateProjectionMatrix();this.needsRender=true;}
  animate(){
    this.animationId=requestAnimationFrame(()=>this.animate());
    const r=this.container.getBoundingClientRect();if(!this.active||!r.width||!r.height||document.hidden||r.bottom<0||r.top>innerHeight)return;
    this.controls.update();
    if(!this.software||this.needsRender){this.renderer.render(this.scene,this.camera);if(this.software)this.renderer.domElement.style.backgroundColor='transparent';this.needsRender=false;this.projectLabels(r);}
  }
  projectLabels(r){
    const placed=[];const origin=this.controls.target.clone().project(this.camera);const north=this.controls.target.clone().add(new THREE.Vector3(0,0,-10)).project(this.camera);const compass=document.querySelector('.scene-orientation svg');if(compass)compass.style.transform=`rotate(${Math.atan2((north.x-origin.x)*r.width,(north.y-origin.y)*r.height)*180/Math.PI}deg)`;
    this.leaders.setAttribute('viewBox',`0 0 ${r.width} ${r.height}`);
    for(const entry of this.labelEntries){
      const p=entry.data.position?.clone?.()||new THREE.Vector3();if(this.mode==='apartment'){this.apartment.group.localToWorld(p);if(entry.data.kind==='device')p.y+=.3;}
      p.project(this.camera);const x=(p.x*.5+.5)*r.width;let y=(-p.y*.5+.5)*r.height;
      const visible=p.z<1&&x>18&&x<r.width-18&&y>8&&y<r.height-5;
      entry.el.style.display=visible?'':'none';entry.line.style.display='none';if(!visible)continue;
      let drawX=x;
      if(this.mode==='city'){
        const width=entry.el.offsetWidth||65,height=entry.el.offsetHeight||49;
        const originalY=y;const offsets=[[0,-8],[-75,-8],[75,-8],[0,-65],[-75,-65],[75,-65],[-140,-8],[140,-8],[0,60],[-75,60],[75,60],[-140,-65],[140,-65],[0,-120],[-75,-120],[75,-120]];
        let best=null;
        for(const [dx,dy]of offsets){const px=Math.max(width/2+12,Math.min(r.width-width/2-12,x+dx));const py=Math.max(height+10,Math.min(r.height-42,originalY+dy));const overlap=placed.reduce((sum,a)=>sum+(Math.abs(a.x-px)<(a.w+width)/2+8&&Math.abs(a.y-py)<height+8?1:0),0);const cost=overlap*100000+dx*dx+dy*dy;if(!best||cost<best.cost)best={px,py,cost};}
        drawX=best.px;y=best.py;placed.push({x:drawX,y,w:width});
        if(Math.hypot(drawX-x,y-originalY)>20){entry.line.style.display='';entry.line.setAttribute('x1',x);entry.line.setAttribute('y1',originalY);entry.line.setAttribute('x2',drawX);entry.line.setAttribute('y2',y-4);}
      }
      entry.el.style.left=drawX+'px';entry.el.style.top=y+'px';
      if(this.mode==='apartment'&&entry.data.kind==='room')entry.el.style.opacity=this.camera.position.distanceTo(this.controls.target)>19?0:.85;
    }
  }
  dispose(){cancelAnimationFrame(this.animationId);this.resizeObserver.disconnect();this.controls.dispose();this.renderer.dispose?.();}
}
