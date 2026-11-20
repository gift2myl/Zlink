const esc=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label={today:'索引标注：当天',yesterday:'索引标注：前一天','2 weeks ago':'索引标注：约两周前','3 weeks ago':'索引标注：约三周前'};
const safeSource=value=>{try{const u=new URL(value);return u.protocol==='https:'&&/(^|\.)ziroom\.com$/.test(u.hostname)&&/^\/xiaoqu\/\d+\.html$/.test(u.pathname)?u.href:null;}catch{return null;}};

/** Discovery evidence stays separate from deduplicated property inventory. */
export async function mountCollectionLeads(container,{showModal,downloadFile}){
  if(!container)return;
  try{
    const response=await fetch('./ops/assets/official-index-candidates.json',{cache:'no-cache'});
    if(!response.ok)return;
    const dataset=await response.json();
    const rows=(dataset.candidates||[]).filter(row=>row.includeInCollectedInventory===false&&safeSource(row.sourceUrl));
    if(!rows.length)return;
    const communities=new Set(rows.map(row=>row.community)).size;
    container.innerHTML=`<div class="collection-leads-copy"><span class="tag blue">补采进展</span><h3>新增 ${rows.length} 条检索线索，覆盖 ${communities} 个小区。</h3><p>官网公开索引含“灵之智能”标签。真实房源身份、当前可租状态和对应户型待核验，暂不计入上方房源数量。</p><small>检索日期 ${esc(dataset.discoveredAtLocal)} · 原索引时间逐条保留</small></div><div class="collection-leads-actions"><button class="button" data-view-leads>查看补采线索</button><button class="button" data-download-leads>下载线索清单</button></div>`;
    container.hidden=false;
    container.querySelector('[data-download-leads]').onclick=()=>downloadFile('北京灵之智能补采线索.json',JSON.stringify(dataset,null,2),'application/json;charset=utf-8');
    container.querySelector('[data-view-leads]').onclick=()=>{
      showModal('北京灵之智能 · 补采线索',`<span class="tag blue">官网公开检索索引 · ${rows.length} 条描述</span><p>这些描述来自自如小区页的公开索引，不是已核验的独立房源。小区编号不作为房源编号；房源台账仍按已收录记录统计。</p><div class="collection-leads-table"><table><thead><tr><th>小区 / 居室</th><th>区域 / 列表商圈</th><th>地铁参考</th><th>证据</th></tr></thead><tbody>${rows.map(row=>`<tr><td><strong>${esc(row.community)}</strong><small>${esc(row.bedrooms)}居 · ${esc(row.orientation)}向 · 灵之智能</small></td><td>${esc(row.district)} · ${esc(row.businessArea)}${row.businessAreaNote?`<small>${esc(row.businessAreaNote)}</small>`:''}</td><td>${esc(row.station)}站<small>官网标注步行约 ${esc(row.distanceM)} 米</small></td><td><a class="text-btn" href="${esc(safeSource(row.sourceUrl))}" target="_blank" rel="noopener noreferrer">官网小区来源 ↗</a><small>${esc(label[row.indexCrawledLabel]||row.indexCrawledLabel)}</small></td></tr>`).join('')}</tbody></table></div><div class="source-block"><h3>下一步核验</h3><p>补齐真实房源ID及其对应详情后，再去重并入房源台账。户型图、室内照片和VR逐套关联；索引描述本身不能生成真实户型。</p><p>公开索引不提供精确北京总量，也不证明房源此刻仍可租。</p></div>`);
    };
  }catch{container.hidden=true;}
}
