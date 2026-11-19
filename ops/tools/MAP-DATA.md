# 公共地图、地形与 Three.js 接入说明

## 已安装静态依赖

- **MapLibre GL JS 6.19.0**：2026-11-19 从 npm 官方 registry 的 `latest` 元数据确认，固定版本下载，已校验 tarball SHA-512。保存本地 ESM、同版本 worker、CSS、原始 LICENSE 与包元数据。
- **Leaflet 1.9.4**：按兼容需求固定此版本，保存 JS、CSS、images 与原始 LICENSE；已校验 npm tarball SHA-512。
- 未运行 npm 安装脚本或安装浏览器；没有请求自如，没有修改房源台账、页面代码或发布网站。

清单见 `assets/vendor/maplibre/distribution-manifest.json`、`assets/vendor/leaflet/distribution-manifest.json`。来源与两种模式见 `assets/map-sources.json`。

## 两种模式与显示口径

| 模式 | 能力 | 界面标识 |
| --- | --- | --- |
| MapLibre + Three.js | WebGL2 公共底图、DEM 地形、共享上下文的三维业务图层 | 三维地形地图 |
| Leaflet | OSM 二维底图、已核验经纬度标记、点击和缩放 | 二维兼容模式 |

WebGL2 不可用或三维初始化失败时使用 Leaflet。兼容模式没有三维地形、Three.js 材质或阴影，不以三维效果的名称标记。此依赖子任务只做源文件与单张瓦片核验，**没有进行浏览器三维渲染验收**。主应用需分别验证正常 GPU 与二维兼容环境。

OSM 栅格图加 DEM 表示道路底图和裸地高程，不提供建筑轮廓、立面或室内几何；房源模型仍需有独立照片、户型或建筑数据。不得把地形接入描述为已完成全北京房源高保真重建。

## ESM、CSS 与 worker 的确切写法

以下路径假设调用模块位于 `ops/` 根目录；如果模块位置变化，应相应调整相对路径。使用 HTTP(S) 静态服务，正确提供 `.mjs` 的 JavaScript MIME 类型。

```html
<link rel="stylesheet" href="./assets/vendor/maplibre/maplibre-gl.css">
```

```js
import * as maplibregl from './assets/vendor/maplibre/maplibre-gl.mjs';

maplibregl.setWorkerUrl(new URL(
  './assets/vendor/maplibre/maplibre-gl-worker.mjs?v=6.19.0',
  import.meta.url
).href);

// setWorkerUrl 必须在创建 Map / 预热 worker 之前执行。
const map = new maplibregl.Map({
  container: 'map',
  style,
  center: [116.4, 39.9],
  zoom: 10,
  pitch: 50,
  maxPitch: 75,
  renderWorldCopies: false,
  canvasContextAttributes: {antialias: true}
});
```

MapLibre v6 只提供 ESM，不是 `window.maplibregl` 的 UMD 脚本。worker 默认也能从模块 URL 推导；显式指定同源 worker 使静态发布更容易核验，版本查询参数避免主文件与缓存 worker 版本错配。不要把 v5 的 `.js` 路径混入 v6。

官方依据：[ESM 与 worker 安装](https://maplibre.org/maplibre-gl-js/docs/)、[setWorkerUrl](https://maplibre.org/maplibre-gl-js/docs/API/functions/setWorkerUrl/)。

## OSM + Terrarium DEM

```js
const osmAttribution = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
const terrainAttribution = 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen / AWS</a> · <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">USGS, NOAA and other contributors</a>';
const dem = {
  type: 'raster-dem',
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  tileSize: 256,
  encoding: 'terrarium',
  maxzoom: 14, // 本 Demo 的请求上限，不是对全源所有层级的可用性保证
  attribution: terrainAttribution
};
const style = {
  version: 8,
  projection: {type: 'mercator'},
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: osmAttribution
    },
    terrain: dem
  },
  layers: [{id: 'osm-basemap', type: 'raster', source: 'osm'}],
  terrain: {source: 'terrain', exaggeration: 1.2}
};
```

定义 `style` 后再创建 Map。地形夸张系数 1.2 是可调演示设置，应在需要时显示说明。Terrarium 必须显式设 `encoding: 'terrarium'`，不能使用默认 Mapbox RGB 解码。解码公式为 `R * 256 + G + B / 256 - 32768` 米。

若加 hillshade，MapLibre 官方建议地形与 hillshade 分别使用 source，以改善渲染质量；不要为了展示批量预取瓦片。当前只确认一个北京瓦片，不宣称全市每层级都已验证。

官方依据：[MapLibre 地形示例](https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/)、[raster-dem 规范](https://maplibre.org/maplibre-style-spec/sources/#raster-dem)、[Terrarium 格式](https://github.com/tilezen/joerd/blob/master/docs/formats.md)。

## Three.js 共享 WebGL 接口（v6.19.0）

采用 `type: 'custom'`、`renderingMode: '3d'`。`onAdd(map, gl)` 中创建 Three.js renderer，共用 `map.getCanvas()` 和 `gl`；`renderer.autoClear = false`，避免清除地图内容。渲染入口为：

```js
render(gl, args) {
  const mapProjection = new THREE.Matrix4()
    .fromArray(args.defaultProjectionData.mainMatrix);
  // modelTransform: 已核验经纬度 + 米制模型坐标 -> Mercator 世界坐标
  this.camera.projectionMatrix.copy(mapProjection).multiply(this.modelTransform);
  this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  this.renderer.resetState();
  this.renderer.render(this.scene, this.camera);
}
```

**第二参数是输入对象，不是旧接口的裸矩阵数组。** 此方式限定 Mercator；不能直接搬到 globe 投影。`MercatorCoordinate.fromLngLat([lng, lat], altitude)` 与 `meterInMercatorCoordinateUnits()` 用于锚点和米制缩放，模型轴向需显式处理。存在地形时可以 `map.queryTerrainElevation([lng, lat])` 取当前已加载地形的高程；返回 `null` 不能当作高程已核验。地形加载后重新计算贴地位置，不凭房源序号或随机值生成地理坐标。

只在业务动画或数据变化时触发 `map.triggerRepaint()`。`onRemove` 释放本层 geometry/material/renderer 资源，但不主动销毁共享地图 WebGL context。标记和行政区只能表达其实际精度；区域参考点不能当房源精确地址。

官方依据：[CustomRenderMethodInput](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/CustomRenderMethodInput/)、[CustomLayerInterface](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/)、[v6.19.0 源码](https://github.com/maplibre/maplibre-gl-js/blob/v6.19.0/src/style/style_layer/custom_style_layer.ts)。已直接核对下载包内对应类型。官方另提供 [maplibre-gl-three 示例](https://maplibre.org/maplibre-gl-js/docs/examples/add-3d-tiles-3d-objects-and-models-using-threejs/)，本次未额外安装该桥接包。

## Leaflet 二维兼容

```html
<link rel="stylesheet" href="./assets/vendor/leaflet/leaflet.css">
<script src="./assets/vendor/leaflet/leaflet.js"></script>
```

```js
const map2d = L.map('map', {attributionControl: true}).setView([39.9, 116.4], 10);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
}).addTo(map2d);
// Leaflet 顺序是 [lat, lng]；MapLibre / GeoJSON 是 [lng, lat]。
```

`images/` 与 CSS 保持相对目录。地图容器应有非零尺寸，切换模式或显示隐藏容器后调用对应的 resize / invalidateSize。不要同时向同一容器初始化两种 renderer。

## 单张北京地形核验

- URL：`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/843/388.png`
- 北京坐标 `[116.4, 39.9]` 对应该 XYZ 瓦片；HTTP **200**、`image/png`、**256×256**、**25,900 字节**。
- SHA-256：`69d8bd89f2a0d7e6ef606bc47e635f1c8184481cdb6080cf61379acc993c2bdf`。
- 中心像素按 Terrarium 解码为 28 米；这是该瓦片中心像素，不是输入坐标的精确插值高程。
- 同一对象做一次内容 GET、一次 HEAD 和一次带 Origin 的 GET。HEAD 没有 CORS 头；带 Origin 的 **GET 返回 `Access-Control-Allow-Origin: *`**，内容哈希一致。仅验证一个唯一瓦片，不批量下载，瓦片图像未保存到发布包。
- 完整机器可读证据：`assets/vendor/maplibre/terrain-verification.json`。CORS 响应头验证不等同于浏览器三维渲染验收。

## 许可与使用范围

MapLibre 为 BSD-3-Clause，Leaflet 为 BSD-2-Clause，发布包保留原 LICENSE。OSM 数据使用 ODbL，地图上持续显示可点击的 OpenStreetMap contributors 署名；遵循公共瓦片服务的缓存与 Referer 要求，不设置默认禁缓存、不隐藏署名、不提供批量下载或预取功能。公共瓦片服务为尽力提供，没有 SLA，正式运营应配置符合容量要求的服务。

Mapzen/AWS 地形汇集多个原始数据源，**不能把全部地形数据简单声明为同一 BSD 或 CC 许可**。按原始提供方条款和署名要求使用；界面保留 Mapzen / AWS 与完整贡献方说明链接。全球数据源涉及 USGS、NOAA 等，本次未逐像素核实北京样本的原始数据源组成。

来源：[OSM 许可](https://www.openstreetmap.org/copyright)、[OSM 瓦片使用政策](https://operations.osmfoundation.org/policies/tiles/)、[AWS 数据目录](https://registry.opendata.aws/terrain-tiles/)、[地形提供方署名与条款](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)。

业务坐标应注明 WGS84 / GCJ-02 / BD-09 等来源坐标系与精度。接入 OSM 前只接受已核验的经纬度；对于坐标系不明的既有行政区边界或采集房源，不自动假定为 WGS84，也不靠视觉对齐改动坐标。
