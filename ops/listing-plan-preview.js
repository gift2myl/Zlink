const buckets = new Map();
let details;
const bucketRoot = new URL('./assets/plan-previews/', import.meta.url);

// Buckets contain only previews of the published image for that specific listing.
export async function loadPlanPreview(property, {signal}={}) {
  const id = String(property?.realListingId || property?.id || '');
  if (signal?.aborted || property?.imported || !/^\d{2,}$/.test(id) || !property.publicFloorplanUrl) return null;
  const key = id.at(-2);
  if (!buckets.has(key)) {
    if (buckets.size >= 3) buckets.delete(buckets.keys().next().value);
    const request = fetch(new URL(key+'.json',bucketRoot)).then(response => {
      if (!response.ok) throw new Error('户型预览暂不可用');
      return response.json();
    }).catch(() => {buckets.delete(key);return {};});
    buckets.set(key,request);
  }
  details ||= fetch(new URL('plan-details.json',bucketRoot)).then(r=>r.ok?r.json():{}).catch(()=>{details=null;return {};});
  const [bucket,metadata]=await Promise.all([buckets.get(key),details]);
  const row=bucket[id];
  if (signal?.aborted || !row || row.url !== property.publicFloorplanUrl ||
    !/^data:image\/(webp|jpeg);base64,[a-zA-Z0-9+/=]+$/.test(row.data) ||
    !Number.isInteger(row.width) || !Number.isInteger(row.height) || row.width<100 || row.height<100) return null;
  const read=metadata[id];
  if(read?.url!==row.url)return row;
  return {...row,labels:Array.isArray(read.labels)?read.labels:[],reviewedGeometry:read.geometry};
}
