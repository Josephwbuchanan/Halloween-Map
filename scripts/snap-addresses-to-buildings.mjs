import { readFile, writeFile } from 'node:fs/promises';
import { distanceToHome, homeCenter } from '../home-shapes.js';

const addressPath = new URL('../arrowbrooke-addresses.geojson', import.meta.url);
const buildingArgument = process.argv.indexOf('--buildings');
const buildingPath = buildingArgument >= 0 && process.argv[buildingArgument + 1]
  ? process.argv[buildingArgument + 1]
  : new URL('../arrowbrooke-buildings.geojson', import.meta.url);
const addresses = JSON.parse(await readFile(addressPath, 'utf8'));
const buildings = JSON.parse(await readFile(buildingPath, 'utf8'));
const writeChanges = process.argv.includes('--write');
const maxDistance = 34;
const cellSize = 0.00045;
const invalidAddressKeys = new Set([
  '1529 HUTTON BRANCH TRL', '2121 AURORA LN',
  '3329 EVENING VIEW', '1500 MILLICAN LN',
  '2801 FM 1385', '2881 FM 1385', '2965 FM 1385',
  '602 ARROW BROOKE AVE', '603 ARROW BROOKE AVE', '797 ARROW BROOKE AVE',
  '1200 SARATOGA RD', '1233 ARROW BROOKE AVE', '1368 MORNING RIDGE TRL',
  '1442 PLEASANT KNOLL TRL', '1769 BLAKELY PL', '1904 ARROW BROOKE AVE',
  '891 PLEASANT KNOLL TRL', '903 WHITE WATER WAY',
  '1100 SARATOGA RD', '1151 ARROWWOOD DR',
  '2618 CLYDE PARK', '2722 CLYDE PARK', '2818 CLYDE PARK',
  '902 ARROW BROOKE AVE', '1108 ARROW BROOKE AVE',
  '1334 ARROW BROOKE AVE', '1462 ARROW BROOKE AVE',
  '2104 WINN RIDGE BLVD', '1602 BERRY RIDGE TRL',
  '2408 WHEELER AVE', '2412 WHEELER AVE', '2416 WHEELER AVE',
  '2500 WHEELER AVE', '2504 WHEELER AVE', '2508 WHEELER AVE',
  '2512 WHEELER AVE', '2516 WHEELER AVE', '2520 WHEELER AVE',
  '2524 WHEELER AVE', '2530 WINN RIDGE BLVD'
]);
const frontierAlignment = [
  [33.25170, -96.90995], [33.25167, -96.90710], [33.25153, -96.90310],
  [33.25139, -96.89925], [33.25122, -96.89645], [33.25108, -96.89415]
];
const winnRidgeAlignment = [
  [33.24025, -96.90995], [33.24255, -96.90988], [33.24505, -96.90976],
  [33.24765, -96.90967], [33.25005, -96.90973], [33.25170, -96.90995]
];
const fm1385Alignment = [
  [33.25108, -96.89415], [33.24875, -96.89415], [33.24615, -96.89415],
  [33.24355, -96.89415], [33.24115, -96.89415], [33.23945, -96.89415]
];
const southernAlignment = [
  [33.23945, -96.89415], [33.23945, -96.89710], [33.23952, -96.89975],
  [33.23962, -96.90145], [33.23974, -96.90185], [33.24012, -96.90210],
  [33.24030, -96.90245], [33.24034, -96.90510], [33.24034, -96.90765],
  [33.24025, -96.90995]
];

function focusBoundary() {
  const offset = 18;
  const longitudeMeters = 111320 * Math.cos(33.2475 * Math.PI / 180);
  const move = (points, north, east) => points.map(([lat, lng]) => [lat + north / 111320, lng + east / longitudeMeters]);
  const corner = ([lat, lng], startDegrees, endDegrees) => Array.from({ length: 4 }, (_, index) => {
    const angle = (startDegrees + (endDegrees - startDegrees) * (index + 1) / 5) * Math.PI / 180;
    return [lat + Math.sin(angle) * offset / 111320, lng + Math.cos(angle) * offset / longitudeMeters];
  });
  return [
    ...move(frontierAlignment, offset, 0), ...corner(frontierAlignment.at(-1), 90, 0),
    ...move(fm1385Alignment, 0, offset), ...corner(fm1385Alignment.at(-1), 0, -90),
    ...move(southernAlignment, -offset, 0), ...corner(southernAlignment.at(-1), -90, -180),
    ...move(winnRidgeAlignment, 0, -offset), ...corner(winnRidgeAlignment.at(-1), 180, 90)
  ].map(([lat, lng]) => [lng, lat]);
}

function insideBoundary([lng, lat], ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index];
    const b = ring[previous];
    if ((a[1] > lat) !== (b[1] > lat) && lng < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

const clearBoundary = focusBoundary();
addresses.features = addresses.features.filter((feature) =>
  !invalidAddressKeys.has(`${feature.properties?.number} ${feature.properties?.street}`) &&
  insideBoundary(feature.geometry.coordinates, clearBoundary)
);

const parts = [];
for (const feature of buildings.features || []) {
  const geometry = feature.geometry;
  if (geometry?.type === 'Polygon') parts.push(geometry);
  if (geometry?.type === 'MultiPolygon') {
    for (const coordinates of geometry.coordinates) parts.push({ type: 'Polygon', coordinates });
  }
}

const grid = new Map();
const cellKey = (lng, lat) => `${Math.floor(lng / cellSize)},${Math.floor(lat / cellSize)}`;
for (let index = 0; index < parts.length; index += 1) {
  const [lat, lng] = homeCenter(parts[index]);
  const key = cellKey(lng, lat);
  if (!grid.has(key)) grid.set(key, []);
  grid.get(key).push(index);
}

const pairs = [];
for (let addressIndex = 0; addressIndex < addresses.features.length; addressIndex += 1) {
  const feature = addresses.features[addressIndex];
  const [lng, lat] = feature.geometry.coordinates;
  const cellX = Math.floor(lng / cellSize);
  const cellY = Math.floor(lat / cellSize);
  const candidates = new Set();
  for (let x = cellX - 1; x <= cellX + 1; x += 1) {
    for (let y = cellY - 1; y <= cellY + 1; y += 1) {
      for (const buildingIndex of grid.get(`${x},${y}`) || []) candidates.add(buildingIndex);
    }
  }
  for (const buildingIndex of candidates) {
    const distance = distanceToHome(parts[buildingIndex], lng, lat);
    if (distance <= maxDistance) pairs.push({ addressIndex, buildingIndex, distance });
  }
}

pairs.sort((a, b) => a.distance - b.distance);
const usedAddresses = new Set();
const usedBuildings = new Set();
const matches = [];
for (const pair of pairs) {
  if (usedAddresses.has(pair.addressIndex) || usedBuildings.has(pair.buildingIndex)) continue;
  usedAddresses.add(pair.addressIndex);
  usedBuildings.add(pair.buildingIndex);
  matches.push(pair);
}

let moved = 0;
for (const { addressIndex, buildingIndex, distance } of matches) {
  const feature = addresses.features[addressIndex];
  const [lat, lng] = homeCenter(parts[buildingIndex]);
  const [oldLng, oldLat] = feature.geometry.coordinates;
  const movement = Math.hypot((lng - oldLng) * 111320 * Math.cos(lat * Math.PI / 180), (lat - oldLat) * 111320);
  if (movement > 0.75) moved += 1;
  feature.geometry.coordinates = [lng, lat];
  feature.properties.building_match_m = Math.round(distance * 10) / 10;
}

const unmatched = addresses.features
  .map((feature, index) => ({ feature, index }))
  .filter(({ index }) => !usedAddresses.has(index));
const report = {
  addresses: addresses.features.length,
  buildingShapes: parts.length,
  buildingCentersOutsideShape: parts.filter((geometry) => {
    const [lat, lng] = homeCenter(geometry);
    return distanceToHome(geometry, lng, lat) > 0.05;
  }).length,
  matched: matches.length,
  moved,
  unmatched: unmatched.length,
  maxMatchDistanceMeters: Math.max(0, ...matches.map(({ distance }) => distance)).toFixed(1),
  unmatchedExamples: unmatched.slice(0, 12).map(({ feature }) => `${feature.properties.number} ${feature.properties.street}`)
};

if (writeChanges) {
  await writeFile(addressPath, `${JSON.stringify(addresses)}\n`);
}
console.log(JSON.stringify(report, null, 2));
