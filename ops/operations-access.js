const storageName = 'zlink-ops-session-v1';
const dialog = document.getElementById('ops-access');
const form = dialog.querySelector('form');
const field = form.elements.passphrase;
const feedback = dialog.querySelector('[role="status"]');
const accessButton = document.getElementById('ops-access-button');
const localPreview = ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && !!document.getElementById('initial-map');
let unlocked = false;
let destination = '';
let ciphertext;

async function decryptSnapshot(secret) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('口令不正确。');
  if (!ciphertext) {
    const response = await fetch('./ops/assets/operations-private.bin', {cache:'no-cache'});
    if (!response.ok) throw new Error('运维明细暂时无法读取，请重试。');
    ciphertext = new Uint8Array(await response.arrayBuffer());
  }
  const raw = Uint8Array.from(atob(secret.replace(/-/g,'+').replace(/_/g,'/')+'='), c=>c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['decrypt']);
  let bytes;
  try { bytes = await crypto.subtle.decrypt({name:'AES-GCM',iv:ciphertext.subarray(0,12)},key,ciphertext.subarray(12)); }
  catch { throw new Error('口令不正确。'); }
  const decoded = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const data = await new Response(decoded).json();
  if (!data.snapshot?.date || data.directory?.date !== data.snapshot.date) throw new Error('运维明细日期不一致。');
  return data;
}

export function openOperationsAccess(hash='') {
  destination = hash;
  if (!dialog.open) {
    field.value = '';
    feedback.textContent = '';
    dialog.showModal();
    field.focus();
  }
}

export async function loadOperationsData(readAsset) {
  if (localPreview) {
    const [snapshot,directory,plan] = await Promise.all([readAsset('beijing-occupancy-health.json'),readAsset('local-home-directory.json'),readAsset('local-health-improvement.json')]);
    snapshot.improvementPlan = plan;
    return {snapshot,directory};
  }
  accessButton.hidden = false;
  document.querySelector('.header-actions .environment').lastChild.textContent = '运维快照';
  const secret = sessionStorage.getItem(storageName);
  if (secret) {
    try {
      const data = await decryptSnapshot(secret);
      unlocked = true;
      accessButton.textContent = '锁定明细';
      return data;
    } catch (error) {
      if (error.message !== '口令不正确。') throw error;
      sessionStorage.removeItem(storageName);
    }
  }
  return {snapshot:await readAsset('operations-summary.json'),directory:null};
}

accessButton.addEventListener('click',()=>{
  if (!unlocked) {openOperationsAccess();return;}
  sessionStorage.removeItem(storageName);
  location.reload();
});
dialog.querySelector('[data-access-cancel]').addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{field.value='';});
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const submit=form.querySelector('[type=submit]');
  if (submit.disabled) return;
  submit.disabled=true;
  const secret=field.value.trim();
  feedback.textContent='正在解锁…';
  try {
    await decryptSnapshot(secret);
    if (!dialog.open) return;
    sessionStorage.setItem(storageName,secret);
    if(destination)history.replaceState(null,'',destination);
    location.reload();
  } catch(error) {
    feedback.textContent=error.message==='口令不正确。' ? error.message : '暂时无法解锁，请重试。';
    field.select();
  } finally {submit.disabled=false;}
});
window.addEventListener('pageshow',event=>{if(event.persisted && unlocked && !sessionStorage.getItem(storageName))location.reload();});
