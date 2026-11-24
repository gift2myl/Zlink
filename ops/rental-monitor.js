import { listingBasics } from './listing-basics.js';

const collator = new Intl.Collator('zh-CN', { numeric: true });
const levels = ['district', 'business', 'community', 'listing'];
const labels = ['区域', '片区', '小区', '房源'];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);
const clean = value => String(value ?? '').trim();

function communityKey(id, name) {
  return clean(id) || clean(name);
}

function buildTree(properties) {
  const root = { key: '', name: '北京', rows: [], children: new Map() };
  const seen = new Set();
  for (const property of properties) {
    const id = clean(property.realListingId || property.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const district = clean(property.district);
    const business = clean(property.businessArea);
    const name = clean(property.name);
    const key = communityKey(property.communityId, name);
    const row = { property, id, district, business, communityKey: key };
    const groups = [
      [district, district || '区域待核验'],
      [business, business || '片区待核验'],
      [key, name || '小区名待核验'],
      [id, listingBasics(property).title]
    ];
    let node = root;
    node.rows.push(row);
    for (const [key, name] of groups) {
      if (!node.children.has(key)) node.children.set(key, { key, name, rows: [], children: new Map() });
      node = node.children.get(key);
      node.rows.push(row);
    }
  }
  return root;
}

function pathNodes(tree, path) {
  const nodes = [tree];
  for (const key of path) {
    const next = nodes.at(-1).children.get(key);
    if (!next) break;
    nodes.push(next);
  }
  return nodes;
}

function coverage(rows) {
  const districts = new Set(), businesses = new Set(), communities = new Set();
  for (const row of rows) {
    if (row.district) districts.add(row.district);
    if (row.business) businesses.add(JSON.stringify([row.district, row.business]));
    if (row.communityKey) communities.add(JSON.stringify([row.district, row.communityKey]));
  }
  return [districts.size, businesses.size, communities.size];
}

function asSelection(nodes) {
  const community = nodes[3]?.rows[0]?.property;
  return {
    district: nodes[1]?.key, business: nodes[2]?.key,
    communityId: community?.communityId, communityName: community?.name,
    listingId: nodes[4]?.key
  };
}

export function mountRentalMonitor(root, { onSelect } = {}) {
  let tree = buildTree([]), path = [], metadata = {};
  root.classList.add('rental-monitor');
  root.setAttribute('aria-label', '地图房源范围');
  root.innerHTML = `<header class="rental-monitor-head">
    <h2>地图匹配范围</h2>
    <span class="rental-monitor-scope">北京</span>
  </header>
  <dl class="rental-monitor-metrics">
    <div><dt>匹配房源</dt><dd><strong data-rental-total>—</strong><span>套</span></dd></div>
    ${levels.slice(0, 3).map((level, i) =>
      `<div><dt>${labels[i]}</dt><dd><strong data-rental-metric="${level}">—</strong><span>个</span></dd></div>`).join('')}
  </dl>
  <div class="rental-monitor-drill">
    <nav aria-label="地图房源分级路径"></nav>
    <div class="rental-monitor-choices"></div>
    <div class="rental-monitor-actions">
      <details><summary>匹配明细</summary><p class="rental-monitor-source"></p></details>
      <button type="button" class="rental-monitor-expand" aria-expanded="false" hidden>展开全部</button>
    </div>
  </div>`;

  const total = root.querySelector('[data-rental-total]');
  const metrics = [...root.querySelectorAll('[data-rental-metric]')];
  const crumbs = root.querySelector('nav');
  const choices = root.querySelector('.rental-monitor-choices');
  const source = root.querySelector('.rental-monitor-source');
  const expand = root.querySelector('.rental-monitor-expand');
  choices.id = (root.id || 'rental-monitor') + '-groups';
  expand.setAttribute('aria-controls', choices.id);
  function updateExpandButton() {
    const more = choices.children.length > 3;
    const opened = more && root.dataset.expanded === 'true';
    expand.hidden = !more;
    expand.setAttribute('aria-expanded', String(opened));
    expand.textContent = opened ? '收起' : '展开全部（' + choices.children.length + '）';
    if (!more) delete root.dataset.expanded;
  }

  function render({ focus = false } = {}) {
    const nodes = pathNodes(tree, path);
    path = nodes.slice(1).map(node => node.key);
    const active = nodes.at(-1);
    const rowCount = active.rows.length;
    const hasData = metadata.available === true;
    const counts = coverage(active.rows);
    root.querySelector('.rental-monitor-scope').textContent = ['北京', metadata.label].filter(Boolean).join(' · ');
    total.textContent = hasData ? rowCount : '—';
    metrics.forEach((metric, index) => { metric.textContent = hasData ? counts[index] : '—'; });
    if (!hasData) source.textContent = '健康快照尚未加载。';
    else if (metadata.label === '待租') {
      const places = active.rows.filter(row=>row.property.rentalCommunity).length;
      source.textContent = `官网房源编号匹配 ${rowCount-places} 套 · 按小区匹配 ${places} 套。地图标记为小区参考位置。` + (!path.length && metadata.pending ? `另有 ${metadata.pending} 套待定位。` : '');
    } else source.textContent = '按房源编号关联地图，区域、片区与小区仅统计已匹配房源。';

    const depth = Math.min(path.length, 3);
    root.dataset.rentalDepth = String(depth);
    const level = levels[depth];
    const group = nodes[depth];
    crumbs.innerHTML = nodes.slice(0, 4).map((node, index) => {
      const name = index ? node.name : '北京全市';
      const current = index === path.length ? ' aria-current="location"' : '';
      const key = index === 0 ? 'city' : levels[index - 1];
      return `<button type="button" data-rental-level="${key}"${current}>${esc(name)}</button>`;
    }).join('<span aria-hidden="true">›</span>') + (nodes[4]
      ? `<span aria-hidden="true">›</span><span aria-current="location">${esc(nodes[4].name)}</span>` : '');
    choices.setAttribute('aria-label', '按' + labels[depth] + '查看地图房源');
    const groups = [...group.children.values()].sort((a, b) => b.rows.length - a.rows.length || collator.compare(a.name, b.name));
    const largest = groups[0]?.rows.length || 1;
    choices.innerHTML = groups.map(node => {
      const listing = level === 'listing';
      const property = node.rows[0].property;
      const detail = listing ? listingBasics(property).facts.filter(fact => fact.value).map(fact => fact.label === '楼层' ? fact.value + (fact.value.includes('/') ? '层' : '') : fact.value).join(' · ') : '';
      const selected = listing && nodes[4]?.key === node.key;
      const description = listing ? `在地图查看${node.name}${detail ? '，'+detail : ''}` : `${node.name}，${node.rows.length} 套房源，查看${labels[depth+1]}`;
      return `<button type="button" data-rental-${level}="${esc(node.key)}" aria-label="${esc(description)}"${listing ? ` aria-pressed="${selected}"` : ''}>
        <span>${esc(node.name)}</span>${listing
          ? (detail || property.healthLabel) ? `<small>${esc([property.healthLabel,detail].filter(Boolean).join(' · '))}</small>` : ''
          : `<span class="rental-monitor-bar" aria-hidden="true"><i style="width:${100 * node.rows.length / largest}%"></i></span><strong data-rental-count>${node.rows.length}</strong>`}</button>`;
    }).join('');
    if (!groups.length) choices.textContent = hasData ? '本范围暂无符合条件的匹配房源。' : '暂无已匹配的房源清单。';
    updateExpandButton();
    if (focus) {
      const target = nodes[4] ? choices.querySelector('[aria-pressed="true"]') : crumbs.querySelector('[aria-current]');
      target?.focus({ preventScroll: true });
    }
    return nodes;
  }

  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) return;
    if (button === expand) {
      root.dataset.expanded = String(root.dataset.expanded !== 'true');
      updateExpandButton();
      return;
    }
    delete root.dataset.expanded;
    choices.scrollTop = 0;
    if (button.hasAttribute('data-rental-level')) {
      const level = button.dataset.rentalLevel;
      path = path.slice(0, levels.indexOf(level) + 1);
    } else {
      const index = levels.findIndex(level => button.hasAttribute('data-rental-' + level));
      if (index < 0) return;
      path = [...path.slice(0, index), button.getAttribute('data-rental-' + levels[index])];
    }
    const nodes = render({ focus: true });
    onSelect?.(asSelection(nodes));
  });

  return {
    update(properties, meta) {
      tree = buildTree(Array.isArray(properties) ? properties : []);
      metadata = meta || {};
      render();
    },
    selectFromMap(selection = {}) {
      let next = [];
      if (selection.listingId) {
        const row = tree.rows.find(row => row.id === clean(selection.listingId));
        if (row) next = [row.district, row.business, row.communityKey, row.id];
      } else if (selection.district) {
        next.push(clean(selection.district));
        if (selection.business || selection.communityId || selection.communityName) next.push(clean(selection.business));
        if (next.length === 2 && (selection.communityId || selection.communityName)) {
          next.push(communityKey(selection.communityId, selection.communityName));
        }
      }
      if (next.length === path.length && next.every((key, index) => key === path[index])) return;
      path = next;
      delete root.dataset.expanded;
      choices.scrollTop = 0;
      render();
    }
  };
}
