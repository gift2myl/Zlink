import * as THREE from 'three';

const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';
const TERRAIN_ATTRIBUTION = 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen / AWS</a> · <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Contributors</a>';
const BEIJING = [116.4, 39.91];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const hasPoint = entry => Array.isArray(entry.position) && entry.position.length === 2 && entry.position.every(Number.isFinite) && entry.position[0] >= 115 && entry.position[0] <= 118 && entry.position[1] >= 39 && entry.position[1] <= 42;
class InitializationPaused extends Error {}

let leafletLoader;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletLoader) leafletLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./assets/vendor/leaflet/leaflet.js', import.meta.url).href;
    script.onload = () => window.L ? resolve(window.L) : reject(new Error('二维地图组件未能初始化'));
    script.onerror = () => reject(new Error('二维地图组件加载失败'));
    document.head.append(script);
  });
  return leafletLoader;
}

function webgl2Available() {
  const canvas = document.createElement('canvas');
  try {
    const context = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}

// Positions are supplied only by the independently recorded geocoding result.
// A business marker is not a building model or a surveyed property location.
function createPropertyLayer(maplibre, entries) {
  const origin = maplibre.MercatorCoordinate.fromLngLat(BEIJING, 0);
  const metre = origin.meterInMercatorCoordinateUnits();
  const transform = new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, origin.z)
    .scale(new THREE.Vector3(metre, -metre, metre))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  return {
    id: 'lingzhi-three-properties',
    type: 'custom',
    renderingMode: '3d',
    entries,
    onAdd(map, gl) {
      this.disposed = false;
      this.map = map;
      this.camera = new THREE.Camera();
      this.scene = new THREE.Scene();
      this.group = new THREE.Group();
      this.scene.add(this.group);
      this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      this.renderer.autoClear = false;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.meshes = [];
      this.rebuild(this.entries);
    },
    clear() {
      for (const mesh of this.meshes || []) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      this.meshes = [];
      this.group?.clear();
    },
    rebuild(next) {
      this.entries = next;
      if (this.disposed || !this.group) return;
      this.clear();
      this.points = [];
      for (const entry of next.filter(hasPoint)) {
        const point = maplibre.MercatorCoordinate.fromLngLat(entry.position, 0);
        const placement = new THREE.Group();
        placement.position.set((point.x - origin.x) / metre, 0, (point.y - origin.y) / metre);
        const colour = entry.hasPending ? 0xc28b47 : entry.matchType === 'station_proxy' ? 0x687d8b : 0x242b32;
        const height = entry.hasPending ? 95 : 65;
        const stalk = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, height, 12), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: .8 }));
        stalk.position.y = height / 2;
        const cap = new THREE.Mesh(new THREE.SphereGeometry(25, 14, 8), new THREE.MeshBasicMaterial({ color: colour }));
        cap.position.y = height + 12;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(entry.matchType === 'station_proxy' ? 110 : 68, 6, 6, 28), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: .7, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 2;
        for (const mesh of [stalk, cap, ring]) {
          mesh.frustumCulled = false;
          this.meshes.push(mesh);
          placement.add(mesh);
        }
        this.group.add(placement);
        this.points.push({ entry, placement });
      }
      this.map.triggerRepaint();
    },
    render(gl, args) {
      if (this.disposed || !this.renderer || !args?.defaultProjectionData?.mainMatrix) return;
      // Elevation may be unavailable until the DEM is loaded; no inferred height
      // is recorded as an observed property elevation.
      for (const point of this.points) {
        const elevation = this.map.queryTerrainElevation(point.entry.position);
        point.placement.position.y = Number.isFinite(elevation) ? elevation : 0;
      }
      this.camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(transform);
      this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
      this.renderer.resetState();
      this.renderer.render(this.scene, this.camera);
      this.renderer.resetState();
    },
    onRemove() {
      if (this.disposed) return;
      this.disposed = true;
      this.clear();
      this.renderer?.dispose();
      this.renderer = null;
      this.group = null;
      this.scene = null;
      this.map = null;
      this.points = [];
      // Never forceContextLoss(): MapLibre owns the shared WebGL context.
    }
  };
}

export class GeographicMap {
  constructor(container, { entries = [], sources = {}, onProperty, onStatus } = {}) {
    this.container = container;
    this.entries = entries;
    this.sources = sources;
    this.onProperty = onProperty;
    this.onStatus = onStatus;
    this.mode = 'pending';
    this.active = true;
    this.disposed = false;
    this.initializing = false;
    this.force2D = false;
    this.terrainEnabled = true;
    this.terrainState = 'waiting';
    this.markerRecords = [];
    this.selectedId = null;
    this.rotating = false;
    this.topView = false;
    this.element = document.createElement('div');
    this.element.id = 'geo-city-map';
    this.element.setAttribute('aria-label', '北京 OpenStreetMap 房源地图');
    this.container.prepend(this.element);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    // Only request public tiles when the map is actually visible.
    this.visibilityObserver = new IntersectionObserver(records => {
      this.inViewport = records.some(record => record.isIntersecting);
      if (this.inViewport && this.active) {
        this.resize();
        this.ensureReady();
      } else this.pauseForVisibility();
    });
    this.visibilityObserver.observe(container);
  }

  emitStatus(extra = {}) {
    const tileNote = this.tileError ? ' · 底图部分瓦片未返回' : '';
    const terrainLabel = this.terrainState === 'ready' ? 'Mapzen / AWS 地形 ×1.2' : this.terrainState === 'error' ? '地形暂不可用' : '地形加载中';
    const text = this.mode === 'webgl'
      ? 'Three.js · WebGL 地图' + (this.terrainEnabled ? ' · ' + terrainLabel : ' · 平面视图') + tileNote
      : this.mode === 'leaflet' ? '二维兼容地图 · OSM · 当前环境无三维地形' + tileNote
      : this.mode === 'failed' ? '地图加载失败，房源清单仍可使用'
      : '正在加载北京公共地图';
    this.onStatus?.({ mode: this.mode, text, terrainEnabled: this.mode === 'webgl' && this.terrainEnabled, terrainState: this.terrainState, ...extra });
  }

  async ensureReady() {
    if (!this.canInitialize() || this.mode === 'failed') return this;
    if (this.ready) {
      const result = await this.ready;
      // A visibility change may have requested a resume while cancellation was
      // still settling. Only that visible request can resume a paused attempt.
      if (!this.ready && this.mode === 'pending' && this.canInitialize()) return this.ensureReady();
      return result;
    }
    const pending = this.initialize();
    this.ready = pending;
    try { return await pending; }
    finally {
      if (this.ready === pending && (this.mode === 'pending' || this.disposed)) this.ready = null;
    }
  }

  canInitialize() {
    return !this.disposed && this.active && !!this.inViewport;
  }

  assertCanInitialize() {
    if (!this.canInitialize()) throw new InitializationPaused('Map is not visible or has been disposed');
  }

  pauseForVisibility() {
    this.setRotate(false);
    this.map?.stop?.();
    if (this.initializing) this.cancelInitialization?.(new InitializationPaused('Map initialization paused'));
  }

  releaseMap() {
    this.setRotate(false);
    const map = this.map;
    const layer = this.propertyLayer;
    this.map = null;
    this.propertyLayer = null;
    this.contextLossCleanup?.();
    this.contextLossCleanup = null;
    this.cancelInitialization?.(new InitializationPaused('Map initialization cancelled'));
    this.cancelInitialization = null;
    for (const record of this.markerRecords) record.marker.remove();
    this.markerRecords = [];
    try { map?.stop?.(); } catch {}
    try { map?.remove(); } catch {}
    // Context loss can remove the custom layer before Map.remove() sees it.
    layer?.onRemove();
    this.element.replaceChildren();
    this.element.className = '';
  }

  fallbackToLeaflet(map) {
    if (this.disposed || this.map !== map || this.force2D) return;
    this.force2D = true;
    this.releaseMap();
    this.mode = 'pending';
    this.ready = null;
    this.emitStatus();
    if (this.canInitialize()) this.ensureReady();
  }

  async initialize() {
    this.initializing = true;
    this.emitStatus();
    try {
      this.assertCanInitialize();
      if (!this.force2D && webgl2Available()) {
        try {
          await this.initWebGL();
          return this;
        } catch (error) {
          if (error instanceof InitializationPaused || this.disposed) throw error;
          console.warn('WebGL map unavailable; using the labelled 2D map.', error);
          this.force2D = true;
          this.releaseMap();
        }
      }
      this.assertCanInitialize();
      await this.initLeaflet();
    } catch (error) {
      this.releaseMap();
      if (error instanceof InitializationPaused || this.disposed) {
        this.mode = 'pending';
        return this;
      }
      this.mode = 'failed';
      console.error(error);
      this.element.innerHTML = '<div class="geo-map-error"><strong>公共地图暂未加载</strong><p>可继续在右侧查看房源、匹配精度和来源。</p></div>';
      this.emitStatus();
    } finally {
      this.initializing = false;
    }
    return this;
  }

  async initWebGL() {
    const maplibre = await import('./assets/vendor/maplibre/maplibre-gl.mjs');
    this.assertCanInitialize();
    this.maplibre = maplibre;
    maplibre.setWorkerUrl(new URL('./assets/vendor/maplibre/maplibre-gl-worker.mjs?v=6.19.0', import.meta.url).href);
    maplibre.setWorkerCount(1);
    const tiles = this.sources.basemap?.tiles || ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];
    const terrainTiles = this.sources.terrain?.tiles || ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];
    this.terrainState = 'waiting';
    this.terrainHasLoadedTile = false;
    this.tileError = false;
    const map = this.map = new maplibre.Map({
      container: this.element,
      center: BEIJING,
      zoom: 10.4,
      pitch: 48,
      bearing: -12,
      minZoom: 8,
      maxZoom: 18,
      maxPitch: 70,
      maxBounds: [[115.25, 39.3], [117.7, 41.25]],
      renderWorldCopies: false,
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
      style: {
        version: 8,
        projection: { type: 'mercator' },
        sources: {
          osm: { type: 'raster', tiles, tileSize: 256, maxzoom: 19, attribution: OSM_ATTRIBUTION },
          'aws-terrain': { type: 'raster-dem', tiles: terrainTiles, tileSize: 256, encoding: 'terrarium', maxzoom: this.sources.terrain?.demoMaxZoom || 14, attribution: TERRAIN_ATTRIBUTION }
        },
        layers: [{ id: 'osm-basemap', type: 'raster', source: 'osm', paint: { 'raster-saturation': -.28, 'raster-contrast': .04 } }],
        terrain: { source: 'aws-terrain', exaggeration: 1.2 }
      }
    });
    this.mode = 'webgl';
    const onContextLost = () => {
      if (this.disposed || this.map !== map) return;
      if (this.cancelInitialization) this.cancelInitialization(new Error('WebGL context lost'));
      else this.fallbackToLeaflet(map);
    };
    map.on('webglcontextlost', onContextLost);
    this.contextLossCleanup = () => map.off('webglcontextlost', onContextLost);
    map.addControl(new maplibre.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibre.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');
    map.addControl(new maplibre.AttributionControl({ compact: false }), 'bottom-right');
    map.on('error', event => {
      if (this.disposed || this.map !== map) return;
      const source = event.sourceId || event.error?.sourceId;
      if (source === 'aws-terrain') this.terrainState = 'error';
      if (source === 'osm') this.tileError = true;
      this.emitStatus();
    });
    map.on('sourcedata', event => {
      if (this.disposed || this.map !== map || event.sourceId !== 'aws-terrain') return;
      if (event.tile?.state === 'loaded' && event.tile.dem) this.terrainHasLoadedTile = true;
      // isSourceLoaded means requests settled, including errored tiles. Require
      // actual DEM content and never overwrite an observed error in this map.
      if (event.isSourceLoaded && this.terrainHasLoadedTile && this.terrainState !== 'error') {
        this.terrainState = 'ready';
        this.emitStatus();
      }
    });
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        map.off('load', onLoad);
        if (this.cancelInitialization === cancel) this.cancelInitialization = null;
        if (error) reject(error); else resolve();
      };
      const onLoad = () => finish();
      const cancel = error => finish(error);
      const timer = setTimeout(() => finish(new Error('WebGL map initialization timed out')), 15000);
      this.cancelInitialization = cancel;
      map.once('load', onLoad);
    });
    this.assertCanInitialize();
    if (this.map !== map) throw new InitializationPaused('Map was replaced');
    this.propertyLayer = createPropertyLayer(maplibre, this.entries);
    map.addLayer(this.propertyLayer);
    this.refreshMarkers();
    this.fitAll(false);
    this.emitStatus();
  }

  async initLeaflet() {
    const L = await loadLeaflet();
    this.assertCanInitialize();
    this.leaflet = L;
    this.mode = 'leaflet';
    this.terrainState = 'unavailable';
    this.tileError = false;
    const map = this.map = L.map(this.element, { zoomControl: true, attributionControl: true, minZoom: 8, maxZoom: 18, zoomAnimation: true, maxBounds: [[39.3, 115.25], [41.25, 117.7]], maxBoundsViscosity: .8 }).setView([BEIJING[1], BEIJING[0]], 10);
    map.zoomControl.setPosition('topright');
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    L.control.scale({ maxWidth: 100, imperial: false }).addTo(map);
    const tiles = L.tileLayer(this.sources.basemap?.tiles?.[0] || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: OSM_ATTRIBUTION, minZoom: 8, maxZoom: 19, updateWhenIdle: true, keepBuffer: 0
    }).addTo(map);
    tiles.on('tileerror', () => { this.tileError = true; this.emitStatus(); });
    tiles.on('load', () => this.emitStatus());
    this.refreshMarkers();
    this.fitAll(false);
    this.emitStatus();
  }

  markerElement(entry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'geo-map-marker' + (entry.matchType === 'station_proxy' ? ' is-proxy' : '') + (entry.hasPending ? ' is-alert' : '') + (entry.id === this.selectedId ? ' is-selected' : '');
    button.dataset.propertyId = entry.id;
    button.innerHTML = '<span>' + escapeHtml(entry.mapIndex) + '</span>';
    const precision = entry.matchType === 'station_proxy' ? '地铁参考点，非房源位置' : '小区级参考位置';
    button.setAttribute('aria-label', entry.name + ' · ' + precision);
    button.title = entry.name + ' · ' + precision;
    button.addEventListener('click', event => { event.stopPropagation(); this.onProperty?.(entry.id); });
    return button;
  }

  refreshMarkers() {
    if (this.disposed || !this.map || !['webgl','leaflet'].includes(this.mode)) return;
    for (const record of this.markerRecords) record.marker.remove();
    this.markerRecords = [];
    for (const entry of this.entries.filter(hasPoint)) {
      const element = this.markerElement(entry);
      let marker;
      if (this.mode === 'webgl') {
        marker = new this.maplibre.Marker({ element, anchor: 'center', pitchAlignment: 'viewport', rotationAlignment: 'viewport' }).setLngLat(entry.position).addTo(this.map);
      } else {
        const icon = this.leaflet.divIcon({ html: element, className: 'geo-leaflet-marker', iconSize: [40,40], iconAnchor: [20,20] });
        marker = this.leaflet.marker([entry.position[1], entry.position[0]], { icon, keyboard: false, riseOnHover: true }).addTo(this.map);
      }
      this.markerRecords.push({ marker, element, entry });
    }
    if (this.mode === 'webgl') this.propertyLayer?.rebuild(this.entries);
  }

  setEntries(entries) {
    this.entries = entries;
    this.refreshMarkers();
  }

  select(id) {
    this.selectedId = id;
    for (const record of this.markerRecords) record.element.classList.toggle('is-selected', record.entry.id === id);
  }

  async focusProperty(id) {
    await this.ensureReady();
    const entry = this.entries.find(item => item.id === id);
    this.select(id);
    if (!this.canInitialize() || !entry || !hasPoint(entry) || !this.map) return false;
    this.setRotate(false);
    if (this.mode === 'webgl') this.map.flyTo({ center: entry.position, zoom: entry.matchType === 'station_proxy' ? 14 : 15, pitch: this.topView ? 0 : 52, duration: this.motionDuration() });
    else if (this.mode === 'leaflet') this.map.setView([entry.position[1], entry.position[0]], entry.matchType === 'station_proxy' ? 14 : 15, { animate: this.motionDuration() > 0 });
    return true;
  }

  fitAll(animate = true) {
    if (!this.canInitialize() || !this.map) return;
    this.setRotate(false);
    const points = this.entries.filter(hasPoint).map(entry => entry.position);
    if (!points.length) {
      if (this.mode === 'webgl') this.map.jumpTo({ center: BEIJING, zoom: 10 });
      else this.map.setView([BEIJING[1],BEIJING[0]],10);
      return;
    }
    const west = Math.min(...points.map(point => point[0])), east = Math.max(...points.map(point => point[0]));
    const south = Math.min(...points.map(point => point[1])), north = Math.max(...points.map(point => point[1]));
    if (this.mode === 'webgl') this.map.fitBounds([[west,south],[east,north]], { padding: {top:85,bottom:65,left:65,right:65}, maxZoom: 12.5, duration: animate ? this.motionDuration() : 0, pitch: this.topView ? 0 : 48, bearing: -12 });
    else if (this.mode === 'leaflet') this.map.fitBounds([[south,west],[north,east]], { paddingTopLeft: [55,65], paddingBottomRight: [55,55], maxZoom: 12, animate: animate && this.motionDuration() > 0 });
  }

  reset() { this.select(null); this.topView = false; this.fitAll(); }
  motionDuration() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650; }

  toggleTop() {
    if (!this.canInitialize() || this.mode !== 'webgl' || !this.map) return false;
    this.topView = !this.topView;
    this.map.easeTo({ pitch: this.topView ? 0 : 52, duration: this.motionDuration() });
    return this.topView;
  }

  toggleTerrain() {
    if (!this.canInitialize() || this.mode !== 'webgl' || !this.map) return false;
    this.terrainEnabled = !this.terrainEnabled;
    this.map.setTerrain(this.terrainEnabled ? { source: 'aws-terrain', exaggeration: 1.2 } : null);
    this.emitStatus();
    return this.terrainEnabled;
  }

  setRotate(active) {
    cancelAnimationFrame(this.rotationFrame);
    this.rotating = !!active && this.mode === 'webgl' && this.canInitialize();
    if (!this.rotating) return false;
    let previous;
    const rotate = now => {
      if (!this.rotating || !this.active || !this.inViewport || document.hidden) { this.rotating = false; return; }
      if (previous !== undefined) this.map.rotateTo(this.map.getBearing() + Math.min(now - previous, 100) * .004, { duration: 0 });
      previous = now;
      this.rotationFrame = requestAnimationFrame(rotate);
    };
    this.rotationFrame = requestAnimationFrame(rotate);
    return true;
  }

  setVisible(active) {
    if (this.disposed) return;
    this.active = active;
    this.element.hidden = !active;
    if (!active) this.pauseForVisibility();
    else {
      this.resize();
      if (this.inViewport) this.ensureReady();
    }
  }

  resize() {
    if (!this.canInitialize() || !this.map || this.container.getBoundingClientRect().width < 1) return;
    if (this.mode === 'webgl') this.map.resize();
    else if (this.mode === 'leaflet') this.map.invalidateSize({ pan: false });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.visibilityObserver.disconnect();
    this.resizeObserver.disconnect();
    this.releaseMap();
    this.element.remove();
  }
}
