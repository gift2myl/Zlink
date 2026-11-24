// This page accepts a panorama only when the listing and every inv_no agree.
export function verifiedVrUrl(property) {
  const id=String(property?.realListingId || '');
  if(!/^\d+$/.test(id) || id!==String(property?.id) || property.imported || !property.publicVrUrl)return null;
  try {
    const detail=new URL(property.sourceUrl);
    const tour=new URL(property.publicVrUrl);
    const ids=tour.searchParams.getAll('inv_no');
    const panoramas=tour.searchParams.getAll('zrVrId');
    if(detail.origin!=='https://www.ziroom.com' || detail.pathname!=='/x/'+id+'.html' ||
       detail.username || detail.password || tour.origin!=='https://metaverse.ziroom.com' ||
       tour.pathname!=='/pano-vr' || tour.username || tour.password ||
       !ids.length || !ids.every(value=>value===id) || panoramas.length!==1 || !/^[a-zA-Z0-9_-]+$/.test(panoramas[0]))return null;
    return tour.href;
  } catch {return null;}
}

export function createOfficialVrPlayer(resolveProperty) {
  const dialog=document.getElementById('official-vr-dialog');
  const stage=document.getElementById('official-vr-stage');
  const title=document.getElementById('official-vr-title');
  const identity=document.getElementById('official-vr-identity');
  const external=document.getElementById('official-vr-external');
  const closeButton=document.getElementById('official-vr-close');
  let shownId=null, originHash=null, launcher=null;

  function reset() {
    stage.replaceChildren();
    external.hidden=true;
    external.removeAttribute('href');
    shownId=null;
    if(dialog.open)dialog.close();
  }

  function open(id) {
    if(dialog.open && shownId===id)return;
    const property=resolveProperty(id);
    const url=verifiedVrUrl(property);
    shownId=id;
    stage.replaceChildren();
    title.textContent=property?.name ? property.name+' · 官网实景 VR' : '官网实景 VR';
    identity.textContent=[property?.healthLabel, property?.district, property?.businessArea, property?.layout].filter(Boolean).join(' · ');
    external.hidden=!url;
    if(url){
      external.href=url;
      const loading=document.createElement('p');
      loading.className='official-vr-loading';
      loading.setAttribute('role','status');
      loading.textContent='正在打开自如全景…';
      const frame=document.createElement('iframe');
      frame.title=(property.listingLabel || property.name)+' · 自如官方全景';
      frame.allow='fullscreen; accelerometer; gyroscope; xr-spatial-tracking';
      frame.allowFullscreen=true;
      frame.referrerPolicy='strict-origin-when-cross-origin';
      frame.addEventListener('load',()=>loading.remove(),{once:true});
      frame.addEventListener('error',()=>{loading.textContent='全景未加载，可点「在官网打开」。';},{once:true});
      frame.src=url;
      stage.append(loading,frame);
    }else{
      external.removeAttribute('href');
      const note=document.createElement('p');
      note.className='official-vr-empty';
      note.textContent=property ? '本套房源暂未取得已核验的官网 VR。' : '北京房源台账中未找到这套房源。';
      stage.append(note);
    }
    if(!dialog.open)dialog.showModal();
  }

  function close() {
    if(!dialog.open)return;
    if(originHash!==null){
      history.back();
    }else{
      const known=resolveProperty(shownId);
      reset();
      location.replace(known ? '#map-listing-'+known.id : '#beijing-map');
    }
  }

  function handleRoute(hash) {
    const match=/^#vr-(\d+)$/.exec(hash);
    if(match){
      open(match[1]);
      return true;
    }
    if(!dialog.open)return false;
    const restoring=originHash===hash;
    reset();
    if(restoring && launcher?.isConnected)launcher.focus({preventScroll:true});
    originHash=null;
    launcher=null;
    return restoring;
  }

  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[data-official-vr]');
    if(!link || event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)return;
    const id=link.dataset.officialVr;
    if(link.hash!=='#vr-'+id || !verifiedVrUrl(resolveProperty(id)))return;
    event.preventDefault();
    if(location.hash!==link.hash){
      originHash=location.hash;
      launcher=link;
      history.pushState(null,'',link.hash);
    }
    open(id);
  });
  closeButton.addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  return {handleRoute};
}
