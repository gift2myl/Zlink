import * as THREE from 'three';

const ORIGIN_LNG = 116.4;
const ORIGIN_LAT = 39.9;
const UNITS_PER_DEGREE = 100;
const LONGITUDE_SCALE = Math.cos(THREE.MathUtils.degToRad(ORIGIN_LAT));
const SURFACE_Y = 1.4;

/** Local equirectangular display projection: +X east, -Z north, +Y up. */
export function projectGeo(lng, lat) {
  if (!Number.isFinite(Number(lng)) || !Number.isFinite(Number(lat))) {
    throw new TypeError('projectGeo requires finite longitude and latitude.');
  }
  return new THREE.Vector3(
    (Number(lng) - ORIGIN_LNG) * UNITS_PER_DEGREE * LONGITUDE_SCALE,
    0,
    -(Number(lat) - ORIGIN_LAT) * UNITS_PER_DEGREE,
  );
}

function cleanName(name = '') {
  return String(name).replace(/北京市|区$|县$/g, '');
}

function polygonShape(rings) {
  const paths = rings.map((ring, index) => {
    const path = index === 0 ? new THREE.Shape() : new THREE.Path();
    ring.forEach(([lng, lat], pointIndex) => {
      const p = projectGeo(lng, lat);
      if (pointIndex === 0) path.moveTo(p.x, -p.z);
      else path.lineTo(p.x, -p.z);
    });
    path.closePath();
    return path;
  });
  paths[0].holes.push(...paths.slice(1));
  return paths[0];
}

function boundaryLine(ring, y, color, opacity) {
  const points = ring.map(([lng, lat]) => {
    const point = projectGeo(lng, lat);
    point.y = y;
    return point;
  });
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const line = new THREE.LineLoop(geometry, material);
  line.renderOrder = 2;
  return line;
}

function makeGeographicGrid(bounds) {
  const group = new THREE.Group();
  group.name = 'Geographic display grid';
  const xMin = Math.floor((bounds.min.x - 8) / 10) * 10;
  const xMax = Math.ceil((bounds.max.x + 8) / 10) * 10;
  const zMin = Math.floor((bounds.min.z - 8) / 10) * 10;
  const zMax = Math.ceil((bounds.max.z + 8) / 10) * 10;
  const points = [];
  for (let x = xMin; x <= xMax; x += 10) points.push(x, -0.6, zMin, x, -0.6, zMax);
  for (let z = zMin; z <= zMax; z += 10) points.push(xMin, -0.6, z, xMax, -0.6, z);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({
    color: 0x22617a, transparent: true, opacity: 0.23, depthWrite: false,
  });
  group.add(new THREE.LineSegments(geometry, material));
  return group;
}

function makeMarker(district) {
  const group = new THREE.Group();
  group.name = `District marker: ${district.name}`;
  group.userData = { districtId: district.id };
  group.position.copy(projectGeo(district.labelLng, district.labelLat));
  group.position.y = SURFACE_Y + 0.15;
  const count = Math.max(0, Number(district.count) || 0);
  const radius = THREE.MathUtils.clamp(0.8 + Math.log10(count + 1) * 0.12, 0.8, 1.3);
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.52, radius * 0.52, 1.45, 20),
    new THREE.MeshStandardMaterial({
      color: 0xa0f8f1, emissive: 0x37dacf, emissiveIntensity: 0.8,
      roughness: 0.25, metalness: 0.3,
    }),
  );
  core.position.y = 0.8;
  core.name = 'District aggregate beacon';
  core.userData = { districtId: district.id };
  group.add(core);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 1.25, radius * 1.48, 48),
    new THREE.MeshBasicMaterial({ color: 0x67e8ed, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.16;
  ring.name = 'District marker ring';
  ring.userData = { districtId: district.id };
  group.add(ring);
  const outerRing = new THREE.Mesh(
    new THREE.RingGeometry(radius * 1.9, radius * 1.96, 48),
    new THREE.MeshBasicMaterial({ color: 0x58c9e5, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
  );
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.y = 0.12;
  outerRing.name = 'District marker perimeter';
  outerRing.userData = { districtId: district.id };
  group.add(outerRing);
  return group;
}

/**
 * Build a geographic operations overview from sourced administrative boundaries.
 * `districts`: [{ id, name, count, labelLng, labelLat }]. Coordinates must be supplied,
 * never inferred from a count. Markers are district aggregates, not home locations.
 * Returns Group, raycastable marker groups, DOM-label anchors, Box3, and an id-keyed
 * object of Vector3 focus positions. The app owns lights, camera, labels and disposal.
 */
export function createCityMap(geojson, districts = []) {
  if (geojson?.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    throw new TypeError('createCityMap requires a GeoJSON FeatureCollection.');
  }
  const group = new THREE.Group();
  group.name = 'Beijing administrative operations map';
  const markers = [];
  const labels = [];
  const focusPositions = Object.create(null);
  const bounds = new THREE.Box3();
  const topMaterial = new THREE.MeshStandardMaterial({
    color: 0x164d73, roughness: 0.55, metalness: 0.28,
    emissive: 0x082c48, emissiveIntensity: 0.45,
  });
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: 0x082e49, roughness: 0.68, metalness: 0.18,
    emissive: 0x03131f, emissiveIntensity: 0.35,
  });
  for (const feature of geojson.features) {
    if (!feature.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) continue;
    const properties = feature.properties || {};
    const district = districts.find(d =>
      String(d.id) === String(properties.adcode) || cleanName(d.name) === cleanName(properties.name),
    );
    const region = new THREE.Group();
    region.name = properties.name || `Administrative region ${properties.adcode}`;
    if (district) region.userData = { districtId: district.id };
    const polygons = feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const rings of polygons) {
      if (!rings.length || rings[0].length < 3) continue;
      const shape = polygonShape(rings);
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: SURFACE_Y,
        steps: 1,
        bevelEnabled: true,
        bevelThickness: 0.09,
        bevelSize: 0.07,
        bevelSegments: 2,
        curveSegments: 1,
      });
      geometry.rotateX(-Math.PI / 2);
      geometry.computeBoundingBox();
      bounds.union(geometry.boundingBox);
      const mesh = new THREE.Mesh(geometry, [topMaterial, sideMaterial]);
      mesh.name = `${region.name} boundary extrusion`;
      mesh.receiveShadow = true;
      if (district) mesh.userData = { districtId: district.id };
      region.add(mesh);
      for (const ring of rings) {
        region.add(boundaryLine(ring, SURFACE_Y + 0.13, 0x76dff4, 0.82));
        region.add(boundaryLine(ring, -0.07, 0x177fae, 0.5));
      }
    }
    group.add(region);
  }
  if (bounds.isEmpty()) throw new Error('GeoJSON contains no usable polygon geometry.');
  group.add(makeGeographicGrid(bounds));
  for (const district of districts) {
    if (district.id == null || !Number.isFinite(Number(district.labelLng)) || !Number.isFinite(Number(district.labelLat))) continue;
    const marker = makeMarker(district);
    markers.push(marker);
    group.add(marker);
    const anchor = marker.position.clone();
    anchor.y += 3.1;
    labels.push({ position: anchor, text: String(district.name), districtId: district.id });
    focusPositions[district.id] = marker.position.clone();
  }
  group.userData = {
    modelType: 'administrative-boundary-extrusion',
    source: 'https://geo.datav.aliyun.com/areas_v3/bound/110000_full.json',
    heightMeaning: 'display-only; not building or terrain height',
    projection: 'local-equirectangular',
  };
  return { group, markers, labels, bounds, focusPositions };
}
