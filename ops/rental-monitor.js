const collator = new Intl.Collator('zh-CN', { numeric: true });
const levels = ['district', 'business', 'community', 'listing'];
const labels = ['区域', '片区', '小区', '挂牌'];
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
      [id, id]
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
  root.setAttribute('aria-label', '待租房源监控');
  root.innerHTML = `<header class="rental-monitor-head">
    <h2>当前监控待租房源 <span><strong data-rental-total>—</strong> 套</span></h2>
    <dl class="rental-monitor-metrics">${levels.slice(0, 3).map((level, i) =>
      `<div><dt>${labels[i]}</dt><dd data-rental-metric="${level}">—</dd></div>`).join('')}</dl>
    <span class="rental-monitor-date"></span>
  </header>
  <div class="rental-monitor-drill">
    <nav aria-label="待租房源分级路径"></nav>
    <div class="rental-monitor-rail">
      <div class="rental-monitor-choices"></div>
      <button type="button" class="rental-monitor-expand" aria-expanded="false" hidden>展开</button>
    </div>
  </div>
  <p class="rental-monitor-source"></p>`;

  const total = root.querySelector('[data-rental-total]');
  const metrics = [...root.querySelectorAll('[data-rental-metric]')];
  const date = root.querySelector('.rental-monitor-date');
  const crumbs = root.querySelector('nav');
  const choices = root.querySelector('.rental-monitor-choices');
  const source = root.querySelector('.rental-monitor-source');
  const expand = root.querySelector('.rental-monitor-expand');
  choices.id = (root.id || 'rental-monitor') + '-groups';
  expand.setAttribute('aria-controls', choices.id);
  function updateExpandButton() {
    const first = choices.firstElementChild;
    const last = choices.lastElementChild;
    const wrapped = !!first && last.offsetTop > first.offsetTop;
    expand.hidden = !wrapped;
    const opened = wrapped && root.dataset.expanded === 'true';
    expand.setAttribute('aria-expanded', String(opened));
    expand.textContent = opened ? '收起' : '展开';
    if (!wrapped) delete root.dataset.expanded;
  }
  new ResizeObserver(updateExpandButton).observe(choices);

  function render({ focus = false } = {}) {
    const nodes = pathNodes(tree, path);
    path = nodes.slice(1).map(node => node.key);
    const active = nodes.at(-1);
    const rowCount = active.rows.length;
    const hasData = Number.isInteger(metadata.verifiedCount) && (metadata.verifiedCount > 0 || metadata.currentCount === 0);
    const counts = coverage(active.rows);
    total.textContent = hasData ? rowCount : '—';
    metrics.forEach((metric, index) => { metric.textContent = hasData ? counts[index] : '—'; });
    const day = clean(metadata.date).slice(0, 10);
    date.textContent = day ? '官网快照 ' + day.replaceAll('-', '.') : '';
    const partial = hasData && metadata.verifiedCount < metadata.currentCount;
    const note = partial ? `本期 ${metadata.currentCount} 套挂牌中已核验 ${metadata.verifiedCount} 套。` : '';
    source.textContent = hasData
      ? note + '按本期官网标注「随时入住」的挂牌统计，排除已预订等受限房源。片区取自官网商圈。'
      : '待租统计所需的官网入住信息尚待核验。片区取自官网商圈。';

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
      ? `<span aria-hidden="true">›</span><span aria-current="location">挂牌 ${esc(nodes[4].key)}</span>` : '');
    choices.setAttribute('aria-label', '按' + labels[depth] + '查看待租房源');
    const groups = [...group.children.values()].sort((a, b) => b.rows.length - a.rows.length || collator.compare(a.name, b.name));
    choices.innerHTML = groups.map(node => {
      const listing = level === 'listing';
      const property = node.rows[0].property;
      const detail = listing ? [property.roomLabel, property.layout].filter(Boolean).join(' · ') : '';
      const selected = listing && nodes[4]?.key === node.key;
      const description = listing ? `在地图查看挂牌 ${node.name}` : `${node.name}，${node.rows.length} 套待租，查看${labels[depth+1]}`;
      return `<button type="button" data-rental-${level}="${esc(node.key)}" aria-label="${esc(description)}"${listing ? ` aria-pressed="${selected}"` : ''}>
        <span>${esc(listing ? '挂牌 ' + node.name : node.name)}</span>${listing
          ? detail ? `<small>${esc(detail)}</small>` : ''
          : `<strong data-rental-count>${node.rows.length}</strong>`}</button>`;
    }).join('');
    if (!groups.length) choices.textContent = hasData ? '本范围暂无符合条件的待租挂牌。' : '暂无已核验的待租清单。';
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
        if (selection.business) next.push(clean(selection.business));
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
