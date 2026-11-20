const REFERENCE_PATH = /^assets\/reference\/[A-Za-z0-9_-]+\.webp$/;
const ROOM_ORDER = ['户型图', '卧室', '餐厅 / 起居厅', '厨房', '卫生间', '玄关', '阳台', '其他空间'];
let gallerySequence = 0;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function referenceRoom(asset) {
  if (asset.kind === 'floorplan') return '户型图';
  const heading = String(asset.content || '').split(/[：:；;]/)[0];
  if (/卧室/.test(heading)) return '卧室';
  if (/餐厅|起居厅|客厅/.test(heading)) return '餐厅 / 起居厅';
  if (/厨房/.test(heading)) return '厨房';
  if (/卫生间|洗漱/.test(heading)) return '卫生间';
  if (/玄关/.test(heading)) return '玄关';
  if (/阳台/.test(heading)) return '阳台';
  return '其他空间';
}

function confirmedSource(record) {
  try {
    const url = new URL(record?.confirmedDetailUrl);
    if (url.protocol !== 'https:' || !['www.ziroom.com', 'ziroom.com'].includes(url.hostname)
        || url.username || url.password || url.port || !/^\/x\/[0-9]+\.html$/.test(url.pathname)) return null;
    return `${url.origin}${url.pathname}`;
  } catch { return null; }
}

/** Show only the local references explicitly associated with this coverage record. */
export function mountReferenceGallery(container, {record, onViewModel} = {}) {
  if (!container || typeof container.replaceChildren !== 'function') {
    throw new TypeError('A reference gallery container is required.');
  }
  const abort = new AbortController();
  const listen = (node, event, handler) => node.addEventListener(event, handler, {signal: abort.signal});
  const seen = new Set();
  const assets = (Array.isArray(record?.assets) ? record.assets : []).filter(asset => {
    if (!asset || typeof asset.file !== 'string' || !REFERENCE_PATH.test(asset.file) || seen.has(asset.file)) return false;
    seen.add(asset.file);
    return true;
  }).map(asset => ({...asset, room: referenceRoom(asset)}));
  const name = typeof record?.name === 'string' && record.name.trim() ? record.name.trim() : '当前房源';
  const root = element('section', 'refg');
  const titleId = `refg-title-${++gallerySequence}`;
  root.setAttribute('aria-labelledby', titleId);
  const header = element('div', 'refg-header');
  const heading = element('div', 'refg-heading');
  const title = element('h3', 'refg-title', `${name} · 来源图片`);
  title.id = titleId;
  heading.append(title);
  const floorplans = assets.filter(asset => asset.kind === 'floorplan').length;
  const summary = assets.length ? `${floorplans} 张户型图 · ${assets.length - floorplans} 张实景照片` : '对应素材待补充';
  heading.append(element('p', 'refg-summary', summary));
  header.append(heading);
  const source = confirmedSource(record);
  if (source) {
    const link = element('a', 'refg-source', '查看房源原页');
    link.href = source;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `在新标签页查看${name}的自如原页`);
    header.append(link);
  }
  root.append(header);
  if (!assets.length) {
    const empty = element('div', 'refg-empty');
    empty.append(element('h4', '', '这套房源的图片资料还未齐备'));
    empty.append(element('p', '', '尚未取得与本套房源对应的户型图或室内照片。补齐来源资料后，可在这里逐张对照。'));
    root.append(empty);
    container.replaceChildren(root);
    return {destroy() {abort.abort(); root.remove();}};
  }

  let activeRoom = '全部';
  let selected = assets[0];
  const categories = element('div', 'refg-categories');
  categories.setAttribute('role', 'group');
  categories.setAttribute('aria-label', '按房间筛选参考图片');
  const categoryButtons = new Map();
  const rooms = ['全部', ...ROOM_ORDER.filter(room => assets.some(asset => asset.room === room))];
  for (const room of rooms) {
    const count = room === '全部' ? assets.length : assets.filter(asset => asset.room === room).length;
    const button = element('button', 'refg-category', `${room} ${count}`);
    button.type = 'button';
    listen(button, 'click', () => {
      activeRoom = room;
      if (!visibleAssets().includes(selected)) selected = visibleAssets()[0];
      update();
    });
    categoryButtons.set(room, button);
    categories.append(button);
  }
  root.append(categories);

  const figure = element('figure', 'refg-figure');
  const stage = element('div', 'refg-stage');
  stage.tabIndex = 0;
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-label', '参考图片，使用左右方向键切换');
  const image = element('img', 'refg-image');
  image.decoding = 'async';
  const unavailable = element('p', 'refg-unavailable', '这张参考图暂时无法读取，可切换其他图片。');
  unavailable.hidden = true;
  listen(image, 'error', () => {image.hidden = true; unavailable.hidden = false;});
  listen(image, 'load', () => {image.hidden = false; unavailable.hidden = true;});
  stage.append(image, unavailable);
  const caption = element('figcaption', 'refg-caption');
  const description = element('p', 'refg-description');
  const counter = element('span', 'refg-counter');
  counter.setAttribute('role', 'status');
  counter.setAttribute('aria-live', 'polite');
  counter.setAttribute('aria-atomic', 'true');
  caption.append(description, counter);
  figure.append(stage, caption);
  root.append(figure);

  const navigation = element('div', 'refg-navigation');
  const previous = element('button', 'refg-nav-button', '上一张');
  const next = element('button', 'refg-nav-button', '下一张');
  previous.type = next.type = 'button';
  previous.setAttribute('aria-label', '查看上一张参考图片');
  next.setAttribute('aria-label', '查看下一张参考图片');
  listen(previous, 'click', () => move(-1));
  listen(next, 'click', () => move(1));
  navigation.append(previous, next);
  root.append(navigation);

  const thumbnails = element('div', 'refg-thumbnails');
  thumbnails.setAttribute('role', 'group');
  thumbnails.setAttribute('aria-label', '选择参考图片');
  const thumbButtons = new Map();
  for (const [index, asset] of assets.entries()) {
    const shortTitle = asset.kind === 'floorplan' ? '户型图' : String(asset.content || asset.room).split(/[：:；;]/)[0];
    const button = element('button', 'refg-thumb');
    button.type = 'button';
    button.setAttribute('aria-label', `${shortTitle}，原始图片第 ${index + 1} 张`);
    const thumb = element('img', 'refg-thumb-image');
    thumb.src = `./ops/${asset.file}`;
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.decoding = 'async';
    button.append(thumb, element('span', 'refg-thumb-label', shortTitle));
    listen(button, 'click', () => {selected = asset; update();});
    thumbButtons.set(asset, button);
    thumbnails.append(button);
  }
  root.append(thumbnails);

  const footer = element('div', 'refg-footer');
  const note = element('div', 'refg-note');
  note.append(element('p', '', '参考图用于空间结构与材质对照，设备实装及尺寸以现场资料为准。'));
  const observed = String(record?.sourceObservedAt || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (observed) note.append(element('p', 'refg-date', `资料观察日期 ${observed.replaceAll('-', '.')}`));
  footer.append(note);
  if (typeof onViewModel === 'function') {
    const model = element('button', 'refg-model-button', '查看三维对照');
    model.type = 'button';
    listen(model, 'click', () => onViewModel());
    footer.append(model);
  }
  root.append(footer);

  function visibleAssets() {return activeRoom === '全部' ? assets : assets.filter(asset => asset.room === activeRoom);}
  function move(step) {
    const visible = visibleAssets();
    selected = visible[(visible.indexOf(selected) + step + visible.length) % visible.length];
    update();
  }
  function update() {
    const visible = visibleAssets();
    const position = visible.indexOf(selected);
    for (const [room, button] of categoryButtons) button.setAttribute('aria-pressed', String(room === activeRoom));
    for (const [asset, button] of thumbButtons) {
      button.hidden = activeRoom !== '全部' && asset.room !== activeRoom;
      button.setAttribute('aria-pressed', String(asset === selected));
    }
    const path = `./ops/${selected.file}`;
    if (image.getAttribute('src') !== path) {
      image.hidden = false;
      unavailable.hidden = true;
      image.src = path;
    }
    image.alt = selected.content || `${name}的${selected.room}参考图`;
    description.textContent = selected.content || `${selected.room}参考图`;
    counter.textContent = `${activeRoom} · ${position + 1} / ${visible.length}`;
    previous.disabled = next.disabled = visible.length < 2;
    stage.setAttribute('aria-label', `${image.alt}，第 ${position + 1} 张，共 ${visible.length} 张，使用左右方向键切换`);
  }
  listen(stage, 'keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') move(event.key === 'ArrowLeft' ? -1 : 1);
    else {const visible = visibleAssets(); selected = event.key === 'Home' ? visible[0] : visible[visible.length - 1]; update();}
  });
  container.replaceChildren(root);
  update();
  return {destroy() {abort.abort(); root.remove();}};
}
