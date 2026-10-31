import { readFile, writeFile } from 'node:fs/promises';

const buildingPath = new URL('../arrowbrooke-buildings.geojson', import.meta.url);
const addressPath = new URL('../arrowbrooke-addresses.geojson', import.meta.url);
const buildings = JSON.parse(await readFile(buildingPath, 'utf8'));
const addresses = JSON.parse(await readFile(addressPath, 'utf8'));
const targetStreets = new Set([
  'AURORA LN', 'CLEAR FORK ST', 'CROSS TIMBER CT', 'EDGEMIRE LN', 'GREAT PLAINS DR',
  'HUTTON BRANCH CT', 'HUTTON BRANCH TRL', 'LAUREL AVE', 'MIDNIGHT LN',
  'MISSION ST', 'SOAPBERRY DR', 'SOAPBERRY ST'
]);

const candidates = (addresses.features || []).filter((feature) =>
  feature.properties?.building_match_m == null && targetStreets.has(feature.properties?.street)
);
const byStreet = new Map();
for (const feature of candidates) {
  const street = feature.properties.street;
  if (!byStreet.has(street)) byStreet.set(street, []);
  byStreet.get(street).push(feature);
}

function metersBetween(a, b) {
  const meanLat = (a[1] + b[1]) / 2;
  return Math.hypot(
    (a[0] - b[0]) * 111320 * Math.cos(meanLat * Math.PI / 180),
    (a[1] - b[1]) * 111320
  );
}

function estimatedFootprint(feature) {
  const center = feature.geometry.coordinates;
  const neighbors = (byStreet.get(feature.properties.street) || [])
    .filter((other) => other !== feature)
    .map((other) => ({ point: other.geometry.coordinates, distance: metersBetween(center, other.geometry.coordinates) }))
    .filter(({ distance }) => distance < 75)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 2);
  let east = 1;
  let north = 0;
  if (neighbors.length) {
    const first = neighbors[0].point;
    const second = neighbors[1]?.point;
    const start = second || center;
    const end = second ? first : first;
    const meanLat = (start[1] + end[1]) / 2;
    east = (end[0] - start[0]) * Math.cos(meanLat * Math.PI / 180);
    north = end[1] - start[1];
    const length = Math.hypot(east, north) || 1;
    east /= length;
    north /= length;
  }
  const normalEast = -north;
  const normalNorth = east;
  const halfWidth = 7.2;
  const halfDepth = 9.5;
  const longitudeMeters = 111320 * Math.cos(center[1] * Math.PI / 180);
  const corner = (along, across) => [
    center[0] + (east * along + normalEast * across) / longitudeMeters,
    center[1] + (north * along + normalNorth * across) / 111320
  ];
  const ring = [
    corner(-halfWidth, -halfDepth), corner(halfWidth, -halfDepth),
    corner(halfWidth, halfDepth), corner(-halfWidth, halfDepth)
  ];
  ring.push(ring[0]);
  return {
    type: 'Feature',
    properties: { estimated: true },
    geometry: { type: 'Polygon', coordinates: [ring] }
  };
}

function bounds(feature) {
  const points = feature.geometry.coordinates[0];
  return {
    west: Math.min(...points.map((point) => point[0])),
    east: Math.max(...points.map((point) => point[0])),
    south: Math.min(...points.map((point) => point[1])),
    north: Math.max(...points.map((point) => point[1]))
  };
}

function polygonsOverlap(first, second) {
  if (first.geometry.type !== 'Polygon' || second.geometry.type !== 'Polygon') return false;
  const aBounds = bounds(first);
  const bBounds = bounds(second);
  if (aBounds.east <= bBounds.west || bBounds.east <= aBounds.west || aBounds.north <= bBounds.south || bBounds.north <= aBounds.south) return false;
  const a = first.geometry.coordinates[0].slice(0, -1);
  const b = second.geometry.coordinates[0].slice(0, -1);
  for (const polygon of [a, b]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index];
      const end = polygon[(index + 1) % polygon.length];
      const axis = [-(end[1] - start[1]), end[0] - start[0]];
      const aProjection = a.map((point) => point[0] * axis[0] + point[1] * axis[1]);
      const bProjection = b.map((point) => point[0] * axis[0] + point[1] * axis[1]);
      if (Math.max(...aProjection) <= Math.min(...bProjection) || Math.max(...bProjection) <= Math.min(...aProjection)) return false;
    }
  }
  return true;
}

function shrink(feature, factor = 0.9) {
  const ring = feature.geometry.coordinates[0];
  const points = ring.slice(0, -1);
  const center = [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length
  ];
  const smaller = points.map((point) => [
    center[0] + (point[0] - center[0]) * factor,
    center[1] + (point[1] - center[1]) * factor
  ]);
  smaller.push(smaller[0]);
  feature.geometry.coordinates[0] = smaller;
}

function overlappingEstimateIndexes(estimates, fixed) {
  const overlaps = new Set();
  for (let first = 0; first < estimates.length; first += 1) {
    for (const building of fixed) if (polygonsOverlap(estimates[first], building)) overlaps.add(first);
    for (let second = first + 1; second < estimates.length; second += 1) {
      if (polygonsOverlap(estimates[first], estimates[second])) {
        overlaps.add(first);
        overlaps.add(second);
      }
    }
  }
  return overlaps;
}

buildings.features = buildings.features.filter((feature) => !feature.properties?.estimated);
const estimates = candidates.map(estimatedFootprint);
const initialOverlaps = overlappingEstimateIndexes(estimates, buildings.features);
for (let pass = 0; pass < 10; pass += 1) {
  const overlaps = overlappingEstimateIndexes(estimates, buildings.features);
  if (!overlaps.size) break;
  for (const index of overlaps) shrink(estimates[index]);
}
const remainingOverlaps = overlappingEstimateIndexes(estimates, buildings.features);
buildings.features.push(...estimates);
await writeFile(buildingPath, `${JSON.stringify(buildings)}\n`);
console.log(JSON.stringify({
  overtureFootprints: buildings.features.length - estimates.length,
  estimatedFootprints: estimates.length,
  estimatesWithInitialOverlap: initialOverlaps.size,
  estimatesWithRemainingOverlap: remainingOverlaps.size,
  total: buildings.features.length
}, null, 2));
