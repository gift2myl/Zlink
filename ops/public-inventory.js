const pageSize = 12;
const unknown = "__unknown__";
const mounts = new WeakMap();
const routes = {
  "#public-inventory": ["listings", "", ""],
  "#tagged-inventory": ["listings", "", "yes"],
  "#check-inventory": ["checks", "", ""],
  "#verified-inventory": ["checks", "verified", ""],
  "#unmatched-inventory": ["checks", "unmatched", ""]
};

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function link(label, value) {
  if (!value) return "";
  let url;
  try { url = new URL(value); } catch { return ""; }
  if (url.protocol !== "https:" || url.username || url.password) return "";
  return `<a href="${escapeText(url.href)}" target="_blank" rel="noopener noreferrer">${escapeText(label)} ↗</a>`;
}

function emptyState() {
  return {view:"listings", status:"", tag:"", query:"", business:"", community:"", room:"", page:1};
}

function normalizedRows(data) {
  const listings = new Map(data.listings.map(row => [String(row.id), row]));
  const checks = new Map();
  for (const row of data.checks) {
    if (!row.id) continue;
    const key = String(row.id);
    if (!checks.has(key)) checks.set(key, []);
    checks.get(key).push(row);
  }
  function normalize(listing, check, related) {
    listing ??= {};
    check ??= {};
    const row = {
      listing, check,
      id:String(listing.id || check.id || ""),
      codes:related.map(item => item.code).filter(Boolean),
      community:check.community || listing.community || "",
      business:check.business || listing.business || "",
      district:check.district || listing.district || "",
      layout:check.layout || (listing.roomLabel ? `合租·${listing.roomLabel}` : listing.bedrooms ? `${listing.bedrooms}居` : ""),
      area:check.area ?? listing.area,
      orientation:check.orientation || listing.orientation || "",
      explicit:Boolean(listing.explicit || check.explicit),
      status:check.status || "",
      detailUrl:check.detailUrl || listing.detailUrl
    };
    const bedrooms = Number(listing.bedrooms) || Number(String(row.layout).match(/(\d+)\s*(?:室|居)/)?.[1]);
    row.room = listing.roomLabel || /合租|卧/.test(row.layout) ? "合租单间" : bedrooms ? `${bedrooms}居` : "";
    row.search = [row.id, ...row.codes, row.community, row.business, row.district, listing.title, listing.transit]
      .filter(Boolean).join(" ").toLowerCase();
    return row;
  }
  return {
    listings:data.listings.map(listing => {
      const related = checks.get(String(listing.id)) || [];
      return normalize(listing, related[0], related);
    }),
    checks:data.checks.map(check => normalize(listings.get(String(check.id)), check, [check]))
  };
}

function numericArea(value) {
  return value === null || value === undefined || value === "" ? "" : String(value).replace(/\s*(?:㎡|m²|平米|平方米)\s*$/i,"") + " ㎡";
}

function optionList(values, value, all, missing) {
  const fields = [...new Set(values.filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b),"zh-CN",{numeric:true}));
  const options = [["",all],...fields.map(v => [String(v),String(v)])];
  if (values.some(v => !v)) options.push([unknown, missing]);
  return options.map(([key,text]) => `<option value="${escapeText(key)}"${value === key ? " selected" : ""}>${escapeText(text)}</option>`).join("");
}

function valueMatches(value, selected) {
  return !selected || (selected === unknown ? !value : String(value) === selected);
}

function groupLabel(row) {
  if (row.status === "unmatched") return "待核实";
  return row.explicit ? "明示灵之智能" : "未见该套公开标签";
}

function detail(row) {
  const unmatched = row.status === "unmatched";
  const fields = [
    ["送核编号",row.codes.join("、")], ["公开挂牌号",row.id],
    ["行政区",row.district], ["商圈",row.business], ["小区",row.community],
    ["居室",row.layout], ["面积",numericArea(row.area)], ["朝向",row.orientation],
    ["楼层",row.listing.floor], ["交通",row.listing.transit],
    ["挂牌信息",Array.isArray(row.listing.availability) ? row.listing.availability.join("、") : row.listing.availability],
    ["灵之标签",groupLabel(row)], ["卡片标签",Array.isArray(row.listing.tags) ? row.listing.tags.join("、") : ""],
    ["公开筛选页",Array.isArray(row.listing.sourcePages) ? row.listing.sourcePages.join("、") : ""]
  ].filter(([,value]) => value);
  const links = [
    link("自如房源详情",row.detailUrl), link("按编号查询",row.check.searchUrl),
    link("原始户型图",row.check.planUrl), link("VR 看房",row.check.vrUrl)
  ].filter(Boolean);
  return `<div class="pi-detail"><dl>${fields.map(([name,value]) => `<div><dt>${escapeText(name)}</dt><dd>${escapeText(value)}</dd></div>`).join("")}</dl>
    <p>${unmatched ? "本次官网查询未返回对应挂牌，可通过编号查询入口复核。" : "设备安装清单、实时运行状态均待运维侧核验。"}</p>
    ${links.length ? `<div class="pi-links">${links.join("")}</div>` : ""}</div>`;
}

function record(row, view) {
  const title = view === "checks" ? row.codes.join("、") : row.community || row.listing.title || row.id;
  const secondary = view === "checks" ? row.community : row.listing.title || row.id;
  const summary = [row.business, row.layout, numericArea(row.area)].filter(Boolean).join(" · ");
  const status = row.status === "unmatched" ? "官网未返回" : "编号已核实";
  return `<details class="pi-record"><summary><span class="pi-ident"><b>${escapeText(title)}</b>${secondary && secondary !== title ? `<small>${escapeText(secondary)}</small>` : ""}</span>
    <span class="pi-room">${escapeText(summary || "暂无房源资料")}</span><span class="pi-evidence">
    ${view === "checks" ? `<span class="pi-status${row.status === "unmatched" ? " pi-pending" : ""}">${status}</span>` : ""}
    <span class="${row.explicit ? "pi-positive" : "pi-neutral"}">${escapeText(groupLabel(row))}</span></span><span class="pi-arrow" aria-hidden="true">⌄</span>
    </summary>${detail(row)}</details>`;
}

export async function mountPublicInventory(container) {
  if (!container) return;
  mounts.get(container)?.abort();
  const controller = new AbortController();
  mounts.set(container,controller);
  const {signal} = controller;
  container.innerHTML = '<section class="pi"><p class="pi-load" role="status">正在读取北京房源台账…</p></section>';
  let data;
  try {
    const response = await fetch(new URL("./assets/public-inventory.json",import.meta.url),{signal});
    if (!response.ok) throw new Error("无法读取数据");
    data = await response.json();
    if (!Array.isArray(data.listings) || !Array.isArray(data.checks)) throw new Error("数据结构无效");
  } catch {
    if (signal.aborted) return;
    container.innerHTML = '<section class="pi"><p class="pi-load" role="alert">房源台账暂时未能加载。 <button type="button" class="pi-inline">重新加载</button></p></section>';
    container.querySelector("button").addEventListener("click",() => mountPublicInventory(container),{once:true,signal});
    return;
  }
  if (signal.aborted) return;
  const groups = normalizedRows(data);
  const state = emptyState();
  function loadRoute(hash) {
    if (!routes[hash]) return;
    Object.assign(state,emptyState());
    [state.view,state.status,state.tag] = routes[hash];
  }
  loadRoute(location.hash);
  const totals = [
    ["#public-inventory","公开筛选挂牌",groups.listings.length,`北京筛选结果，${data.pages} 页去重`],
    ["#tagged-inventory","明示灵之智能",groups.listings.filter(row => row.explicit).length,"本套挂牌卡片明确标注"],
    ["#verified-inventory","送核编号已匹配",data.checks.filter(r=>r.status==="verified").length,`来自 ${data.checks.length} 个送核编号`],
    ["#unmatched-inventory","官网未返回",data.checks.filter(r=>r.status==="unmatched").length,"本次按编号查询无结果"]
  ];
  container.innerHTML = `<section class="pi" aria-label="北京公开房源台账"><header class="pi-heading"><h2>北京公开房源台账</h2><span>采集日期 <time>${escapeText(data.date)}</time></span></header>
    <div class="pi-metrics">${totals.map(([key,label,count,scope])=>`<button type="button" data-route="${key}"><span>${escapeText(label)}</span><strong>${escapeText(count)}</strong><small>${escapeText(scope)}</small></button>`).join("")}</div>
    <p class="pi-note">公开筛选挂牌与送核编号有重合，分别统计。挂牌和标签用于核对房源资料，设备实装与在线状态需另行核验。</p>
    <div class="pi-nav"><nav class="pi-tabs" aria-label="选择台账"><button type="button" data-route="#public-inventory" data-view="listings">公开挂牌 <span>${groups.listings.length}</span></button><button type="button" data-route="#check-inventory" data-view="checks">送核编号 <span>${groups.checks.length}</span></button></nav>
    <a class="pi-download" href="./ops/assets/verified-listings-20261120.xlsx" download="北京房源编号核验_20261120.xlsx">下载编号核验表</a></div>
    <div class="pi-tools"><label class="pi-search">搜索<input type="search" placeholder="房源编号、挂牌号、小区或商圈"></label><div class="pi-filters"></div></div>
    <div class="pi-results"><div class="pi-results-heading"><h3 tabindex="-1">查询结果</h3><span role="status"></span></div><div class="pi-list"></div><div class="pi-pager" aria-label="分页"></div></div></section>`;
  const $ = selector => container.querySelector(selector);
  const search = $(".pi-search input");
  const filters = $(".pi-filters");
  function select(name, label, options) {
    return `<label>${label}<select data-filter="${name}">${options}</select></label>`;
  }
  function choices(name,items) {
    return items.map(([key,text])=>`<option value="${key}"${state[name]===key?" selected":""}>${text}</option>`).join("");
  }
  function updateControls() {
    const source = groups[state.view];
    const branch = source.filter(r=>valueMatches(r.business,state.business));
    filters.innerHTML = [
      select("business","商圈",optionList(source.map(r=>r.business),state.business,"全部商圈","商圈待核验")),
      select("community","小区",optionList(branch.map(r=>r.community),state.community,"全部小区","小区待核验")),
      select("room","居室",optionList(source.map(r=>r.room),state.room,"全部居室","居室待核验")),
      select("tag","灵之标签",choices("tag",[["","全部标签范围"],["yes","明示灵之智能"],["no","未见公开标签"]])),
      state.view==="checks" ? select("status","编号状态",choices("status",[["","全部核验状态"],["verified","编号已核实"],["unmatched","官网未返回"]])) : "",
      '<button type="button" class="pi-inline" data-reset>重置筛选</button>'
    ].join("");
    search.value = state.query;
    container.querySelectorAll("[data-view]").forEach(item=>item.setAttribute("aria-pressed",String(item.dataset.view===state.view)));
  }
  function showRows() {
    const needle=state.query.trim().toLowerCase();
    const hits=groups[state.view].filter(r=>(!needle||r.search.includes(needle)) && valueMatches(r.business,state.business) &&
      valueMatches(r.community,state.community) && valueMatches(r.room,state.room) &&
      (!state.tag || (state.tag==="yes" ? r.explicit : !r.explicit && r.status !== "unmatched")) &&
      (!state.status || r.status===state.status));
    const pages=Math.max(1,Math.ceil(hits.length/pageSize));
    state.page=Math.min(state.page,pages);
    const start=(state.page-1)*pageSize;
    $(".pi-results-heading [role=status]").textContent=hits.length ? `${hits.length} 条结果，显示第 ${start+1}–${Math.min(start+pageSize,hits.length)} 条` : "0 条结果";
    $(".pi-list").innerHTML=hits.length ? hits.slice(start,start+pageSize).map(r=>record(r,state.view)).join("") :
      '<p class="pi-empty">当前条件没有匹配记录。 <button type="button" class="pi-inline" data-reset>清除筛选</button></p>';
    $(".pi-pager").innerHTML=pages > 1 ? `<button type="button" data-page="-1" ${state.page===1?"disabled":""}>上一页</button><span>第 ${state.page} / ${pages} 页</span><button type="button" data-page="1" ${state.page===pages?"disabled":""}>下一页</button>` : "";
  }
  function setRoute(hash,scroll=false) {
    if (!routes[hash]) return;
    loadRoute(hash);
    if(location.hash!==hash) history.pushState(null,"",hash);
    updateControls();
    showRows();
    if (scroll) container.scrollIntoView({block:"start"});
  }
  function onRoute() {
    if (location.hash && !routes[location.hash]) return;
    loadRoute(location.hash || "#public-inventory");updateControls();showRows();
    if (location.hash) container.scrollIntoView({block:"start"});
  }
  window.addEventListener("hashchange",onRoute,{signal});
  container.addEventListener("click",event=>{
    const button=event.target.closest("button");
    if(!button || !container.contains(button)) return;
    if(button.dataset.route) return setRoute(button.dataset.route);
    if(button.hasAttribute("data-reset")) return setRoute(state.view==="checks"?"#check-inventory":"#public-inventory");
    if(button.dataset.page) {
      state.page+=Number(button.dataset.page);
      showRows();
      $(".pi-results-heading h3").focus();
      $(".pi-results-heading").scrollIntoView({block:"start"});
    }
  },{signal});
  filters.addEventListener("change",event=>{
    const key=event.target.dataset.filter;
    if(!key) return;
    state[key]=event.target.value;state.page=1;
    if(key==="business") {state.community="";updateControls();filters.querySelector('[data-filter="business"]').focus();}
    showRows();
  },{signal});
  search.addEventListener("input",()=>{
    const query=search.value;
    if(state.view==="listings" && groups.checks.some(row=>row.codes.some(code=>code.toLowerCase()===query.trim().toLowerCase()))) {
      setRoute("#check-inventory");
      search.value=query;
    }
    state.query=query;state.page=1;showRows();
  },{signal});
  updateControls();
  showRows();
  if(routes[location.hash]) container.scrollIntoView({block:"start"});
}
