import { displayCategory } from './display-category.js?v=20261028-category-colors';
import { distanceToHome, findHome, homeKey, homeCenter } from './home-shapes.js';
import { pickStopName } from './stop-names.js?v=20261028-many-names';
import { lookupAddress } from './address-lookup.js';
import { applyAddressCorrections } from './address-corrections.js?v=20261028-address-precision-v4';

const $ = (selector) => document.querySelector(selector);
const config = window.HALLOWEEN_CONFIG;
const demo = new URLSearchParams(location.search).get('demo') === '1';
const categories = {
  candy: { label: 'Candy', icon: '🍬' },
  nonfood: { label: 'Candy & Goodies', icon: '🎁' },
  adult: { label: 'Adult Treats', icon: '🥤' }
};
const displayCategories = {
  candy: { label: 'Candy Only', icon: '🍬', color: '#e97632' },
  nonfood: { label: 'Candy & Goodies', icon: '🎁', color: '#e7bd3c' },
  adult: { label: 'Adult Treats', icon: '🥤', color: '#a275df' },
  allthree: { label: 'All Three', icon: '🎃', color: '#43ae87' }
};
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

const demoStops = [
  { id: 'demo-1', title: 'The Pumpkin Porch', address: 'Sample stop · Gold Mine Trail', lat: 33.2473, lng: -96.9017, categories: ['candy'], notes: 'Sample home with candy for trick-or-treaters.' },
  { id: 'demo-2', title: 'Boo & Brews', address: 'Sample stop · Tomahawk Trail', lat: 33.2474, lng: -96.8973, categories: ['adult', 'candy'], notes: 'Sample home with treats for kids and grown-ups.' },
  { id: 'demo-3', title: 'The Teal Pumpkin Porch', address: 'Sample stop · Pleasant Knoll Trail', lat: 33.2491, lng: -96.9027, categories: ['nonfood'], notes: 'Sample home with non-food treats.' },
  { id: 'demo-4', title: 'Candy & Trinkets', address: 'Sample stop · Starlight Avenue', lat: 33.246, lng: -96.9078, categories: ['candy', 'nonfood'], notes: 'Sample home with candy and non-food treats.' },
  { id: 'demo-5', title: 'The Witching Hour', address: 'Sample stop · Berry Ridge Trail', lat: 33.2502, lng: -96.9005, categories: ['candy', 'nonfood', 'adult'], notes: 'Sample home offering all three.' }
];

let stops = [];
let selectedId = null;
let filter = new Set();
let db = null;
let publicDb = null;
let adminDb = null;
let isOrganizer = false;
let currentUserId = null;
let chosenLocation = null;
let chosenAddressKey = '';
let userMarker = null;
let userLocationWatchId = null;
let lastUserLatLng = null;
let selectedLocationIcon = localStorage.getItem('arrowbrooke-location-icon') || '🎃';
if (selectedLocationIcon === '🦇') selectedLocationIcon = '👸';
let searchMarker = null;
let searchTimer = null;
let searchRequest = 0;
let fogAnimationFrame = null;
let neighborhoodAddressData = { type: 'FeatureCollection', features: [] };
let neighborhoodAddresses = [];
let addressDataLoaded = false;
let serviceWorkerRegistrationPromise = null;

const streetUppercaseWords = new Set(['FM']);

function displayStreetName(value) {
  return String(value || '').toLowerCase().split(/\s+/).map((part) => {
    const upper = part.toUpperCase();
    return streetUppercaseWords.has(upper) ? upper : `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
  }).join(' ');
}

function normalizeAddressText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/\bavenue\b/g, 'ave').replace(/\bboulevard\b/g, 'blvd')
    .replace(/\bcourt\b/g, 'ct').replace(/\bdrive\b/g, 'dr')
    .replace(/\blane\b/g, 'ln').replace(/\bplace\b/g, 'pl')
    .replace(/\bparkway\b/g, 'pkwy').replace(/\broad\b/g, 'rd')
    .replace(/\bstreet\b/g, 'st').replace(/\btrail\b/g, 'trl');
}

async function loadNeighborhoodAddresses() {
  try {
    const response = await fetch('arrowbrooke-addresses.geojson?v=20261028-address-precision-v4', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Address file unavailable');
    neighborhoodAddressData = applyAddressCorrections(await response.json());
    for (const feature of neighborhoodAddressData.features || []) {
      feature.properties.address_key = normalizeAddressText(`${feature.properties.number} ${feature.properties.street}`);
      if (feature.properties?.building_match_m != null) continue;
      feature.properties.address_lng = feature.geometry.coordinates[0];
      feature.properties.address_lat = feature.geometry.coordinates[1];
    }
    neighborhoodAddresses = (neighborhoodAddressData.features || []).map((feature) => {
      const number = String(feature.properties?.number || '').trim();
      const street = displayStreetName(feature.properties?.street);
      const [lng, lat] = feature.geometry.coordinates;
      return { number, street, lat, lng, search: normalizeAddressText(`${number} ${street}`), streetSearch: normalizeAddressText(street) };
    });
    addressDataLoaded = true;
    streetMap?.getSource('arrowbrooke-addresses')?.setData(neighborhoodAddressData);
  } catch {
    addressDataLoaded = false;
  }
  return neighborhoodAddresses;
}

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { $('#toast').hidden = true; }, 5000);
}

function status(message, live = false) {
  $('#connection').textContent = message;
  $('#connection').classList.toggle('live', live);
}

const map = L.map('map', { zoomControl: false }).setView(config.center, config.zoom);
map.attributionControl.addAttribution('Addresses: <a href="https://openaddresses.io/">OpenAddresses</a> / Denton County');
map.attributionControl.addAttribution('Buildings: <a href="https://overturemaps.org/">Overture Maps</a> (ODbL) + estimated neighborhood footprints');
let tileWarning = false;
let streetMap = null;
const mapWarning = () => {
  if (tileWarning) return;
  tileWarning = true;
  toast('The street map could not load. Check your internet connection.');
};

try {
  const vectorTiles = L.maplibreGL({
    style: new URL('map-style.json', location.href).href,
    attribution: '<a href="https://openfreemap.org/">OpenFreeMap</a> · © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> · Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Addresses: <a href="https://openaddresses.io/">OpenAddresses</a> / Denton County'
  }).addTo(map);
  streetMap = vectorTiles.getMaplibreMap();
  streetMap.on('error', mapWarning);
  streetMap.on('load', ensureMapEnhancements);
} catch {
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'fallback-tiles',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Addresses: <a href="https://openaddresses.io/">OpenAddresses</a> / Denton County'
  }).addTo(map).on('tileerror', mapWarning);
}

const addressDataPromise = loadNeighborhoodAddresses();

function fogStructuralBoundary() {
  const roadOffset = config.fogRoadOffsetMeters || 18;
  const longitudeMeters = 111320 * Math.cos(config.center[0] * Math.PI / 180);
  const move = (points, northMeters, eastMeters) => points.map(([lat, lng]) => [lat + northMeters / 111320, lng + eastMeters / longitudeMeters]);
  const cornerArc = ([lat, lng], startDegrees, endDegrees) => {
    const points = [];
    for (let step = 1; step < 5; step += 1) {
      const angle = (startDegrees + (endDegrees - startDegrees) * step / 5) * Math.PI / 180;
      points.push([lat + Math.sin(angle) * roadOffset / 111320, lng + Math.cos(angle) * roadOffset / longitudeMeters]);
    }
    return points;
  };
  const north = move(config.frontierAlignment || config.focusBoundary.slice(0, 2), roadOffset, 0);
  const east = move(config.fm1385Alignment || config.focusBoundary.slice(1, 3), 0, roadOffset);
  const south = move(config.southernAlignment || config.focusBoundary.slice(2, 4), -roadOffset, 0);
  const west = move(config.winnRidgeAlignment || [config.focusBoundary[3], config.focusBoundary[0]], 0, -roadOffset);
  return [
    ...north,
    ...cornerArc(config.frontierAlignment.at(-1), 90, 0),
    ...east,
    ...cornerArc(config.fm1385Alignment.at(-1), 0, -90),
    ...south,
    ...cornerArc(config.southernAlignment.at(-1), -90, -180),
    ...west,
    ...cornerArc(config.winnRidgeAlignment.at(-1), 180, 90)
  ];
}

function organicFogBoundary() {
  const structuralBoundary = fogStructuralBoundary();
  const organic = [];
  const wander = config.fogEdgeWanderMeters || 4;
  const segments = structuralBoundary.map((start, edge) => {
    const end = structuralBoundary[(edge + 1) % structuralBoundary.length];
    const meanLat = (start[0] + end[0]) / 2;
    const northMeters = (end[0] - start[0]) * 111320;
    const eastMeters = (end[1] - start[1]) * 111320 * Math.cos(meanLat * Math.PI / 180);
    const length = Math.hypot(northMeters, eastMeters);
    return { start, end, meanLat, northMeters, eastMeters, length };
  });
  const perimeter = segments.reduce((total, segment) => total + segment.length, 0);
  const cycles = Math.max(8, Math.round(perimeter / 95));
  let traveled = 0;
  for (const segment of segments) {
    const { start, end, meanLat, northMeters, eastMeters, length } = segment;
    const pieces = Math.max(2, Math.ceil(length / 22));
    const normalNorth = -eastMeters / length;
    const normalEast = northMeters / length;
    for (let piece = 0; piece < pieces; piece += 1) {
      const ratio = piece / pieces;
      const phase = Math.PI * 2 * cycles * (traveled + ratio * length) / perimeter;
      const offset = (Math.sin(phase) * 0.58 + Math.sin(phase * 3 + 0.8) * 0.28 + Math.sin(phase * 7) * 0.14) * wander;
      organic.push([
        start[0] + (end[0] - start[0]) * ratio + normalNorth * offset / 111320,
        start[1] + (end[1] - start[1]) * ratio + normalEast * offset / (111320 * Math.cos(meanLat * Math.PI / 180))
      ]);
    }
    traveled += length;
  }
  return organic;
}

function ensureMapEnhancements() {
  if (!streetMap || !streetMap.isStyleLoaded() || streetMap.getLayer('arrowbrooke-address-labels')) return;
  streetMap.addSource('arrowbrooke-buildings', {
    type: 'geojson',
    data: 'arrowbrooke-buildings.geojson?v=20261028-no-overlaps'
  });
  streetMap.addLayer({
    id: 'arrowbrooke-building-supplement',
    type: 'fill',
    source: 'arrowbrooke-buildings',
    minzoom: 13,
    paint: {
      'fill-color': '#85899e',
      'fill-opacity': 0.24,
      'fill-antialias': false
    }
  }, streetMap.getLayer('building-3d') ? 'building-3d' : undefined);

  streetMap.addSource('arrowbrooke-participating-homes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  streetMap.addLayer({ id: 'arrowbrooke-home-colors', type: 'fill', source: 'arrowbrooke-participating-homes', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.78 } });
  streetMap.addLayer({ id: 'arrowbrooke-home-outlines', type: 'line', source: 'arrowbrooke-participating-homes', paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 2.5, 1.3], 'line-opacity': 0.9 } });
  streetMap.addSource('arrowbrooke-addresses', { type: 'geojson', data: neighborhoodAddressData });
  streetMap.addLayer({
    id: 'arrowbrooke-address-labels',
    type: 'symbol',
    source: 'arrowbrooke-addresses',
    minzoom: 16.6,
    layout: {
      'text-field': ['to-string', ['get', 'number']],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 16.6, 7, 17.5, 9, 19, 12],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-padding': 0
    },
    paint: {
      'text-color': '#fff4d8',
      'text-halo-color': '#181020',
      'text-halo-width': 1.4,
      'text-halo-blur': 0.2
    }
  });

  for (const layer of streetMap.getStyle().layers || []) {
    if (layer.type !== 'symbol' || layer['source-layer'] !== 'poi') continue;
    const nameFilter = ['all',
      ['!=', ['coalesce', ['get', 'name'], ''], 'Community Center'],
      ['!=', ['coalesce', ['get', 'name:en'], ''], 'Community Center']
    ];
    try { streetMap.setFilter(layer.id, layer.filter ? ['all', layer.filter, nameFilter] : nameFilter); } catch { /* custom labels still work */ }
  }
  streetMap.addSource('arrowbrooke-gp-labels', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  const pumpkinCanvas = document.createElement('canvas');
  pumpkinCanvas.width = 48;
  pumpkinCanvas.height = 48;
  const pumpkin = pumpkinCanvas.getContext('2d');
  pumpkin.lineCap = 'round';
  pumpkin.strokeStyle = '#4f8a45';
  pumpkin.lineWidth = 4;
  pumpkin.beginPath();
  pumpkin.moveTo(25, 12);
  pumpkin.quadraticCurveTo(24, 5, 31, 5);
  pumpkin.stroke();
  pumpkin.fillStyle = '#f08a32';
  pumpkin.beginPath();
  pumpkin.ellipse(24, 28, 19, 15, 0, 0, Math.PI * 2);
  pumpkin.fill();
  pumpkin.fillStyle = '#ffad43';
  pumpkin.beginPath();
  pumpkin.ellipse(24, 28, 10, 15, 0, 0, Math.PI * 2);
  pumpkin.fill();
  pumpkin.fillStyle = '#3a2631';
  pumpkin.beginPath();
  pumpkin.moveTo(12, 25); pumpkin.lineTo(18, 20); pumpkin.lineTo(20, 27); pumpkin.closePath();
  pumpkin.moveTo(28, 27); pumpkin.lineTo(30, 20); pumpkin.lineTo(36, 25); pumpkin.closePath();
  pumpkin.fill();
  pumpkin.strokeStyle = '#3a2631';
  pumpkin.lineWidth = 3;
  pumpkin.beginPath();
  pumpkin.arc(24, 28, 12, 0.35, Math.PI - 0.35);
  pumpkin.stroke();
  streetMap.addImage('arrowbrooke-gp-pumpkin', pumpkin.getImageData(0, 0, 48, 48), { pixelRatio: 2 });
  streetMap.addLayer({
    id: 'arrowbrooke-gp-labels',
    type: 'symbol',
    source: 'arrowbrooke-gp-labels',
    minzoom: 14.5,
    layout: {
      'icon-image': 'arrowbrooke-gp-pumpkin',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 14.5, 0.8, 17, 1.1],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 14.5, 11, 17, 15],
      'text-offset': [1.5, 0],
      'text-anchor': 'left',
      'text-allow-overlap': true,
      'text-ignore-placement': true
    },
    paint: {
      'text-color': '#dff4c7',
      'text-halo-color': '#253528',
      'text-halo-width': 2
    }
  });

  if (Array.isArray(config.focusBoundary) && config.focusBoundary.length > 2) {
    const organicEdge = organicFogBoundary().map(([lat, lng]) => [lng, lat]);
    organicEdge.push(organicEdge[0]);
    streetMap.addSource('arrowbrooke-focus', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]],
            organicEdge
          ]
        }
      }
    });
    const fogSize = 512;
    const fogCanvas = document.createElement('canvas');
    fogCanvas.width = fogSize;
    fogCanvas.height = fogSize;
    const fogContext = fogCanvas.getContext('2d');
    let fogSeed = 24681357;
    const fogRandom = () => {
      fogSeed = (fogSeed * 1664525 + 1013904223) >>> 0;
      return fogSeed / 4294967296;
    };
    for (let cloud = 0; cloud < 42; cloud += 1) {
      const x = fogRandom() * fogSize;
      const y = fogRandom() * fogSize;
      const radius = 38 + fogRandom() * 82;
      for (const offsetX of [-fogSize, 0, fogSize]) for (const offsetY of [-fogSize, 0, fogSize]) {
        const gradient = fogContext.createRadialGradient(x + offsetX, y + offsetY, 0, x + offsetX, y + offsetY, radius);
        gradient.addColorStop(0, `rgba(248,252,255,${0.12 + fogRandom() * 0.14})`);
        gradient.addColorStop(0.5, 'rgba(241,248,252,0.09)');
        gradient.addColorStop(1, 'rgba(235,244,250,0)');
        fogContext.fillStyle = gradient;
        fogContext.fillRect(x + offsetX - radius, y + offsetY - radius, radius * 2, radius * 2);
      }
    }
    streetMap.addImage('arrowbrooke-fog-clouds', fogContext.getImageData(0, 0, fogSize, fogSize), { pixelRatio: 1 });
    streetMap.addLayer({
      id: 'outside-neighborhood-fog',
      type: 'fill',
      source: 'arrowbrooke-focus',
      paint: { 'fill-color': '#e6eef1', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.2, 15.5, 0.13] }
    });
    streetMap.addLayer({
      id: 'outside-neighborhood-fog-clouds',
      type: 'fill',
      source: 'arrowbrooke-focus',
      minzoom: 14.2,
      paint: {
        'fill-pattern': 'arrowbrooke-fog-clouds',
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14.2, 0.38, 15.2, 0.68, 16, 0.78, 18, 0.86],
        'fill-translate': [0, 0],
        'fill-translate-anchor': 'map'
      }
    });
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      let fogLastFrame = 0;
      const animateFog = (time) => {
        if (time - fogLastFrame > 80 && streetMap?.getLayer('outside-neighborhood-fog-clouds')) {
          fogLastFrame = time;
          streetMap.setPaintProperty('outside-neighborhood-fog-clouds', 'fill-translate', [
            Math.sin(time / 14000) * 12,
            Math.cos(time / 18000) * 8
          ]);
        }
        fogAnimationFrame = requestAnimationFrame(animateFog);
      };
      if (fogAnimationFrame) cancelAnimationFrame(fogAnimationFrame);
      fogAnimationFrame = requestAnimationFrame(animateFog);
    }
  }

  updateGreenbeltLabels();
  if (streetMap.getLayer('arrowbrooke-gp-labels')) streetMap.moveLayer('arrowbrooke-gp-labels');
}

const markers = L.layerGroup().addTo(map);
const houseLayers = L.layerGroup().addTo(map);
const houseCache = new Map();
let homeNumberFilterKey = '';
let paintedHomeDataKey = '';
let buildingDataRevision = 0;
let buildingSnapshotKey = '';
let buildingSnapshot = [];
let matchedHomesKey = '';
let renderedHomesKey = '';
let mapViewChanging = false;
const homeRenderer = L.svg({ padding: 0.5 });
let shapeRefreshTimer;
let pinSequence = 0;
let gp1Coordinates = null;
let gpLabelsRenderedKey = '';

function mapBuildingFeatures() {
  if (!streetMap) return [];
  const snapshotKey = `${buildingDataRevision}|${map.getZoom()}|${map.getBounds().toBBoxString()}`;
  if (snapshotKey === buildingSnapshotKey) return buildingSnapshot;
  try {
    const candidates = [
      ...streetMap.queryRenderedFeatures({ layers: ['building', 'arrowbrooke-building-supplement'].filter(id => streetMap.getLayer(id)) }),
      ...streetMap.querySourceFeatures('openmaptiles', { sourceLayer: 'building' }),
      ...streetMap.querySourceFeatures('arrowbrooke-buildings')
    ];
    const uniqueBuildings = new Map();
    for (const feature of candidates) {
      const geometry = feature?.geometry;
      if (geometry) uniqueBuildings.set(homeKey(geometry), feature);
    }
    buildingSnapshot = [...uniqueBuildings.values()];
    buildingSnapshotKey = snapshotKey;
    return buildingSnapshot;
  } catch { return []; }
}

function snapVisibleAddressLabels() {
  if (!streetMap || !addressDataLoaded || map.getZoom() < 16 || !neighborhoodAddressData.features?.length) return;
  const buildings = mapBuildingFeatures();
  if (!buildings.length) return;
  const bounds = map.getBounds().pad(0.2);
  const parts = [];
  for (const feature of buildings) {
    const geometry = feature.geometry;
    if (geometry?.type === 'Polygon') parts.push(geometry);
    if (geometry?.type === 'MultiPolygon') {
      for (const coordinates of geometry.coordinates) parts.push({ type: 'Polygon', coordinates });
    }
  }
  const visibleAddresses = [];
  const pairs = [];
  neighborhoodAddressData.features.forEach((feature, index) => {
    if (feature.properties?.building_match_m != null) return;
    const lng = feature.properties.address_lng ?? feature.geometry.coordinates[0];
    const lat = feature.properties.address_lat ?? feature.geometry.coordinates[1];
    if (!bounds.contains([lat, lng])) return;
    visibleAddresses.push({ feature, index, lng, lat });
    for (let buildingIndex = 0; buildingIndex < parts.length; buildingIndex += 1) {
      const distance = distanceToHome(parts[buildingIndex], lng, lat);
      if (distance <= 45) pairs.push({ addressIndex: index, buildingIndex, distance });
    }
  });
  pairs.sort((a, b) => a.distance - b.distance);
  const assignments = new Map();
  const usedBuildings = new Set();
  for (const pair of pairs) {
    if (assignments.has(pair.addressIndex) || usedBuildings.has(pair.buildingIndex)) continue;
    assignments.set(pair.addressIndex, parts[pair.buildingIndex]);
    usedBuildings.add(pair.buildingIndex);
  }
  let changed = false;
  for (const { feature, index, lng, lat } of visibleAddresses) {
    const home = assignments.get(index);
    const [nextLat, nextLng] = home ? homeCenter(home) : [lat, lng];
    const [currentLng, currentLat] = feature.geometry.coordinates;
    if (Math.abs(currentLng - nextLng) > 1e-9 || Math.abs(currentLat - nextLat) > 1e-9) {
      feature.geometry.coordinates = [nextLng, nextLat];
      changed = true;
    }
    if (neighborhoodAddresses[index]) Object.assign(neighborhoodAddresses[index], { lat: nextLat, lng: nextLng });
  }
  if (changed) streetMap.getSource('arrowbrooke-addresses')?.setData(neighborhoodAddressData);
}

function updateGreenbeltLabels() {
  if (!streetMap?.getSource('arrowbrooke-gp-labels')) return;
  if (!gp1Coordinates) {
    try {
      const communityCenter = streetMap.querySourceFeatures('openmaptiles', { sourceLayer: 'poi' }).find((feature) =>
        [feature.properties?.name, feature.properties?.['name:en']].some((name) => String(name || '').toLowerCase() === 'community center')
      );
      if (communityCenter?.geometry?.type === 'Point') gp1Coordinates = communityCenter.geometry.coordinates;
    } catch { /* source may still be loading */ }
  }
  const gp2Location = config.gp2Location || [33.24955, -96.90445];
  const gp3Location = config.gp3Location || [33.2414618, -96.9063994];
  const features = [
    ...(gp1Coordinates ? [{ type: 'Feature', properties: { label: 'GP1' }, geometry: { type: 'Point', coordinates: gp1Coordinates } }] : []),
    { type: 'Feature', properties: { label: 'GP2' }, geometry: { type: 'Point', coordinates: [gp2Location[1], gp2Location[0]] } },
    { type: 'Feature', properties: { label: 'GP3' }, geometry: { type: 'Point', coordinates: [gp3Location[1], gp3Location[0]] } }
  ];
  const renderedKey = JSON.stringify(features.map((feature) => feature.geometry.coordinates));
  if (renderedKey === gpLabelsRenderedKey) return;
  gpLabelsRenderedKey = renderedKey;
  streetMap.getSource('arrowbrooke-gp-labels').setData({ type: 'FeatureCollection', features });
}

function scheduleHomes() {
  clearTimeout(shapeRefreshTimer);
  shapeRefreshTimer = setTimeout(drawMapStops, 100);
}
if (streetMap) {
  streetMap.on('idle', () => {
    scheduleHomes();
    try { snapVisibleAddressLabels(); } catch { /* labels retry after the next tile update */ }
    try {
      updateGreenbeltLabels();
    } catch { /* GP labels retry after the next tile update */ }
  });
  streetMap.on('sourcedata', (event) => {
    if (event.sourceId === 'openmaptiles' || event.sourceId === 'arrowbrooke-buildings') {
      buildingDataRevision += 1;
      scheduleHomes();
    }
  });
}
map.on('movestart', () => { mapViewChanging = true; });
map.on('moveend', () => { mapViewChanging = false; scheduleHomes(); });

function showWholeNeighborhood(animate = false) {
  if (innerWidth > 700 || !Array.isArray(config.focusBoundary)) {
    map.setView(config.center, config.zoom, { animate });
    return;
  }
  requestAnimationFrame(() => {
    const sheetHeight = document.querySelector('.explore')?.getBoundingClientRect().height || innerHeight * 0.34;
    const navigationHeight = document.querySelector('.bottom-nav')?.getBoundingClientRect().height || 64;
    const searchBottom = document.querySelector('.search-panel')?.getBoundingClientRect().bottom || 145;
    map.invalidateSize(false);
    map.fitBounds(L.latLngBounds(config.focusBoundary), {
      paddingTopLeft: [16, Math.ceil(searchBottom + 12)],
      paddingBottomRight: [16, Math.ceil(sheetHeight + navigationHeight + 14)],
      maxZoom: 16,
      animate
    });
  });
}

function mapDot(stop) {
  const color = displayCategories[displayCategory(stop)].color;
  return L.divIcon({
    className: 'pin-shell', iconSize: [28, 28], iconAnchor: [14, 14],
    html: `<span class="overview-dot" style="background:${color}"></span>`
  });
}

function houseNumber(address) {
  const match = String(address ?? '').trim().match(/^(\d+[A-Za-z]?)(?:\s|$)/);
  return match ? match[1] : '';
}

function addHouseNumber(stop, position, abovePin = false) {
  const number = houseNumber(stop.address);
  if (!number || map.getZoom() < 17) return;
  const icon = L.divIcon({
    className: 'house-number-shell',
    iconSize: [46, 22],
    iconAnchor: [23, abovePin ? 58 : 11],
    html: `<span class="house-number">${escapeHtml(number)}</span>`
  });
  L.marker(position, { icon, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(markers);
}

function hideSearchResults() {
  $('#search-results').hidden = true;
  $('#search').setAttribute('aria-expanded', 'false');
}

function searchResultLabel(properties) {
  const street = properties.street || (properties.osm_key === 'highway' ? properties.name : '');
  const title = [properties.housenumber, street].filter(Boolean).join(' ') || properties.name || street;
  if (!title) return null;
  const place = [properties.city || properties.locality || properties.district, properties.state].filter(Boolean).join(', ');
  return { title, subtitle: place || (properties.housenumber ? 'Address' : 'Street') };
}

function insideFocusBoundary(lat, lng) {
  const polygon = config.focusBoundary;
  if (!Array.isArray(polygon) || polygon.length < 3) return inNeighborhood(lat, lng);
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const [currentLat, currentLng] = polygon[current];
    const [previousLat, previousLng] = polygon[previous];
    if (((currentLng > lng) !== (previousLng > lng)) &&
      (lat < (previousLat - currentLat) * (lng - currentLng) / (previousLng - currentLng) + currentLat)) inside = !inside;
  }
  return inside;
}

function showSearchResults(results, message = '') {
  const panel = $('#search-results');
  if (message) panel.innerHTML = `<div class="search-result-status">${escapeHtml(message)}</div>`;
  else panel.innerHTML = results.map((result, index) => `<button class="search-result" role="option" data-result="${index}"><strong>${escapeHtml(result.title)}</strong><small>${escapeHtml(result.subtitle)}</small></button>`).join('');
  panel.hidden = false;
  $('#search').setAttribute('aria-expanded', 'true');
  panel._results = results;
}

function localSearchResults(query, limit = 8) {
  const normalized = normalizeAddressText(query);
  if (!normalized) return [];
  if (/\d/.test(normalized)) {
    return neighborhoodAddresses.filter((address) => address.search.includes(normalized))
      .sort((a, b) => Number(!a.search.startsWith(normalized)) - Number(!b.search.startsWith(normalized)) || a.search.localeCompare(b.search))
      .slice(0, limit)
      .map((address) => ({ title: `${address.number} ${address.street}`, subtitle: 'ArrowBrooke address', lat: address.lat, lng: address.lng, isHouse: true, addressKey: address.search }));
  }
  const streets = new Map();
  for (const address of neighborhoodAddresses) {
    if (!address.streetSearch.includes(normalized)) continue;
    const existing = streets.get(address.streetSearch) || { title: address.street, lat: 0, lng: 0, count: 0, starts: address.streetSearch.startsWith(normalized) };
    existing.lat += address.lat;
    existing.lng += address.lng;
    existing.count += 1;
    streets.set(address.streetSearch, existing);
  }
  return [...streets.values()].sort((a, b) => Number(!a.starts) - Number(!b.starts) || a.title.localeCompare(b.title)).slice(0, limit)
    .map((street) => ({ title: street.title, subtitle: 'ArrowBrooke street', lat: street.lat / street.count, lng: street.lng / street.count, isHouse: false }));
}

function nearestNeighborhoodAddress(lat, lng, maximumDistance = 70) {
  const xScale = 111320 * Math.cos(lat * Math.PI / 180);
  let nearest = null;
  let distance = maximumDistance;
  for (const address of neighborhoodAddresses) {
    const currentDistance = Math.hypot((address.lng - lng) * xScale, (address.lat - lat) * 111320);
    if (currentDistance < distance) { nearest = address; distance = currentDistance; }
  }
  return nearest ? { ...nearest, distance } : null;
}

async function searchAddresses(query) {
  const request = ++searchRequest;
  showSearchResults([], 'Searching ArrowBrooke addressesâ€¦');
  await addressDataPromise;
  if (request !== searchRequest || $('#search').value.trim() !== query) return;
  if (addressDataLoaded) {
    const results = localSearchResults(query);
    showSearchResults(results, results.length ? '' : 'No matching ArrowBrooke address or street was found.');
    return;
  }
  try {
    const url = new URL(config.addressSearchUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('lat', config.center[0]);
    url.searchParams.set('lon', config.center[1]);
    url.searchParams.set('bbox', '-96.909,33.240,-96.891,33.254');
    url.searchParams.set('limit', '12');
    url.searchParams.set('lang', 'en');
    const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin' });
    if (!response.ok) throw new Error('Search unavailable');
    const data = await response.json();
    if (request !== searchRequest || $('#search').value.trim() !== query) return;
    const seen = new Set();
    const results = (data.features || []).map((feature) => {
      const coordinates = feature.geometry?.coordinates;
      const label = searchResultLabel(feature.properties || {});
      if (!label || !coordinates || !insideFocusBoundary(coordinates[1], coordinates[0])) return null;
      const key = label.title.toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
      return { ...label, lat: coordinates[1], lng: coordinates[0], isHouse: Boolean(feature.properties?.housenumber) };
    }).filter(Boolean).slice(0, 8);
    showSearchResults(results, results.length ? '' : 'No matching ArrowBrooke address or street was found.');
  } catch {
    if (request === searchRequest) showSearchResults([], 'Address search is temporarily unavailable.');
  }
}

function selectSearchResult(result) {
  $('#search').value = result.title;
  hideSearchResults();
  closeDetail();
  render();
  if (searchMarker) searchMarker.remove();
  searchMarker = L.marker([result.lat, result.lng], {
    icon: L.divIcon({ className: 'search-location', iconSize: [20, 20], iconAnchor: [10, 10], html: '<span></span>' }),
    interactive: false,
    keyboard: false,
    zIndexOffset: 1200
  }).addTo(map);
  map.setView([result.lat, result.lng], result.isHouse ? 19 : 17);
  if (result.isHouse) {
    chosenLocation = [result.lat, result.lng];
    chosenAddressKey = result.addressKey || normalizeAddressText(result.title);
    const addressInput = document.querySelector('[name="address"]');
    addressInput.value = result.title;
    lastSuggestedAddress = result.title;
    $('#location-label').textContent = '✓ Address selected. Open the map to confirm the exact home.';
    $('#address-help').textContent = 'This address came from the ArrowBrooke address list. Please confirm it on the map.';
    $('#pick-location').textContent = '⌖ Show selected address on map';
  }
  toast(result.isHouse ? 'Address found. Use Add my house to submit this location.' : 'Street found. Zoom in to choose a home.');
}

function pinIcon(stop) {
  const zoom = map.getZoom();
  const [width, height] = zoom <= 14 ? [11, 20] : zoom <= 15 ? [15, 27] : zoom <= 16 ? [20, 36] : [24, 43];
  const color = displayCategories[displayCategory(stop)].color;
  const clipId = `coffin-pin-${++pinSequence}`;
  const outline = 'M7 1H19L25 11L20 33L13 43L6 33L1 11Z';
  const face = zoom >= 16 ? '<path d="m6 10 5 1-4 4zm14 0-5 1 4 4zM7 19l3 1 3-2 3 2 3-1-2 5H9Z" fill="#29182e"/>' : '';
  const svg = `<svg viewBox="0 0 26 44" aria-hidden="true"><defs><clipPath id="${clipId}"><path d="${outline}"/></clipPath></defs><rect width="26" height="44" fill="${color}" clip-path="url(#${clipId})"/><path d="${outline}" fill="none" stroke="#f5d5ae" stroke-opacity=".8" stroke-width="1.1"/>${face}</svg>`;
  return L.divIcon({
    className: 'pin-shell', iconSize: [36, 46], iconAnchor: [18, 46],
    html: `<div class="haunt-pin ${selectedId === stop.id ? 'selected' : ''}" style="--marker-width:${width}px;--marker-height:${height}px">${svg}</div>`
  });
}

function visibleStops() {
  const query = $('#search').value.trim().toLowerCase();
  return stops.filter((stop) =>
    (!filter.size || filter.has(displayCategory(stop))) &&
    `${stop.title} ${stop.address} ${stop.notes}`.toLowerCase().includes(query)
  );
}

function syncHomeNumberLabels(visible) {
  if (!streetMap?.getLayer('arrowbrooke-address-labels')) return;
  const keys = map.getZoom() >= 17
    ? [...new Set(visible.map(stop => normalizeAddressText(stop.address)))].sort() : [];
  const key = JSON.stringify(keys);
  if (key === homeNumberFilterKey) return;
  streetMap.setFilter('arrowbrooke-address-labels', keys.length
    ? ['!', ['in', ['get', 'address_key'], ['literal', keys]]] : null);
  homeNumberFilterKey = key;
}

function drawMapStops() {
  if (mapViewChanging) return;
  const visible = visibleStops();
  syncHomeNumberLabels(visible);
  const paintedHomes = [];
  const used = new Set();
  let buildings = [];
  if (streetMap && map.getZoom() >= 16) {
    buildings = mapBuildingFeatures();
  }

  const matchKey = `${buildingSnapshotKey}|${visible.map(stop => `${stop.id}:${stop.lng}:${stop.lat}`).join('|')}`;
  const rematchHomes = matchKey !== matchedHomesKey;
  const plannedHomes = visible.map(stop => {
    let home = houseCache.get(stop.id);
    if ((rematchHomes || !home) && buildings.length) {
      const detailedHome = findHome(buildings, stop.lng, stop.lat, demo ? 65 : 18, used);
      if (detailedHome) {
        home = detailedHome;
        houseCache.set(stop.id, home);
      }
    }
    if (home) used.add(homeKey(home));
    return { stop, home };
  });
  if (buildings.length) matchedHomesKey = matchKey;
  const renderKey = JSON.stringify([map.getZoom(), Boolean(streetMap?.getSource('arrowbrooke-participating-homes')), selectedId,
    plannedHomes.map(({stop,home}) => [stop.id,stop.title,stop.address,displayCategory(stop),stop.lat,stop.lng,home ? homeKey(home) : null])]);
  if (renderKey === renderedHomesKey) return;
  markers.clearLayers();
  houseLayers.clearLayers();
  for (const { stop, home } of plannedHomes) {

    if (map.getZoom() < 17) {
      const position = home ? homeCenter(home) : [stop.lat, stop.lng];
      L.marker(position, { icon: mapDot(stop), title: stop.title, alt: stop.title }).addTo(markers).on('click', () => showDetail(stop.id));
      continue;
    }
    if (!home) {
      L.marker([stop.lat, stop.lng], { icon: pinIcon(stop), title: stop.title, alt: stop.title }).addTo(markers).on('click', () => showDetail(stop.id));
      addHouseNumber(stop, [stop.lat, stop.lng], true);
      continue;
    }

    const color = displayCategories[displayCategory(stop)].color;
    const feature = { type: 'Feature', properties: {}, geometry: home };
    if (streetMap?.getSource('arrowbrooke-participating-homes')) {
      paintedHomes.push({ ...feature, properties: { color, selected: selectedId === stop.id } });
      L.geoJSON(feature, { renderer: homeRenderer, bubblingMouseEvents: false, style: { weight: 14, opacity: 0, fillOpacity: 0, className: 'house-hit-area' } }).addTo(houseLayers).on('click', () => showDetail(stop.id));
      addHouseNumber(stop, homeCenter(home));
      continue;
    }
    L.geoJSON(feature, { renderer: homeRenderer, interactive: false, style: { fill: false, color, weight: 7, opacity: 0.18, lineJoin: 'round' } }).addTo(houseLayers);
    const layer = L.geoJSON(feature, {
      renderer: homeRenderer,
      bubblingMouseEvents: false,
      style: { color, weight: selectedId === stop.id ? 2.5 : 1.3, opacity: 0.9, fillColor: color, fillOpacity: 0.78, className: 'haunted-home' }
    }).addTo(houseLayers);
    layer.eachLayer((shape) => {
      const path = shape.getElement();
      if (!path) return;
      path.setAttribute('data-stop-id', stop.id);
      path.setAttribute('role', 'button');
      path.setAttribute('tabindex', '0');
      path.setAttribute('aria-label', stop.title);
      path.style.filter = `drop-shadow(0 0 3px ${color}88)`;
      path.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showDetail(stop.id); }
      });
      shape.on('click', () => showDetail(stop.id));
    });
    L.geoJSON(feature, { renderer: homeRenderer, bubblingMouseEvents: false, style: { color, weight: 14, opacity: 0, fillOpacity: 0, className: 'house-hit-area' } }).addTo(houseLayers).on('click', () => showDetail(stop.id));
    layer.bringToFront();
    addHouseNumber(stop, homeCenter(home));
  }
  const paintedKey = JSON.stringify(paintedHomes);
  const paintedSource = streetMap?.getSource('arrowbrooke-participating-homes');
  if (paintedSource && paintedKey !== paintedHomeDataKey) {
    paintedSource.setData({ type: 'FeatureCollection', features: paintedHomes });
    paintedHomeDataKey = paintedKey;
  }
  renderedHomesKey = renderKey;
}

function render() {
  const visible = visibleStops();
  drawMapStops();
  $('#count').textContent = `${visible.length} stop${visible.length === 1 ? '' : 's'}`;
  $('#stop-list').innerHTML = visible.length ? visible.map((stop) => {
    const category = displayCategory(stop);
    const categoryInfo = displayCategories[category];
    return `<button class="stop-row" data-stop="${escapeHtml(stop.id)}"><span class="stop-icon ${category}">${categoryInfo.icon}</span><span class="stop-text"><span class="stop-title">${escapeHtml(stop.title)}</span><span class="stop-address">${escapeHtml(stop.address)}</span><span class="stop-badge">${stop.categories.map((key) => categories[key].label).join(' · ')}</span></span></button>`;
  }).join('') : `<div class="empty"><span class="empty-icon">🎃</span><strong>${stops.length ? 'No matching stops' : 'Be the first on the block'}</strong>${stops.length ? 'Try another filter or search.' : 'Add your house to the neighborhood Halloween map.'}</div>`;
  $('#stop-list').querySelectorAll('[data-stop]').forEach((button) => { button.onclick = () => showDetail(button.dataset.stop); });
  if (selectedId && !visible.some((stop) => stop.id === selectedId)) closeDetail();
}

function closeDetail() {
  selectedId = null;
  $('#detail').hidden = true;
}

function showDetail(id, pan = true) {
  if (document.body.classList.contains('picking')) return;
  const stop = stops.find((item) => item.id === id);
  if (!stop) return;
  selectedId = id;
  drawMapStops();
  if (innerWidth <= 700) setSheet(false);
  const organizerEditor = isOrganizer ? `<form id="organizer-edit" class="organizer-edit">
    <div class="organizer-heading"><strong>Organizer controls</strong><span>Changes publish immediately</span></div>
    <label>Display name<input name="title" maxlength="80" value="${escapeHtml(stop.title)}" required></label>
    <fieldset><legend>What’s here?</legend><div class="category-options">
      ${Object.entries(categories).map(([key, item]) => `<label><input name="categories" type="checkbox" value="${key}" ${stop.categories.includes(key) ? 'checked' : ''}><span>${item.icon} ${item.label}</span></label>`).join('')}
    </div></fieldset>
    <label>Good to know<textarea name="notes" maxlength="400" rows="2">${escapeHtml(stop.notes || '')}</textarea></label>
    <p class="error organizer-edit-error" role="alert"></p>
    <div class="organizer-actions"><button class="primary" type="submit">Save changes</button><button class="danger" id="organizer-remove" type="button">Remove from map</button></div>
  </form>` : '';
  $('#detail').innerHTML = `<button class="icon-button close-detail" aria-label="Close details">×</button><div class="eyebrow">${isOrganizer ? 'ORGANIZER MODE · ' : ''}${demo ? 'SAMPLE STOP · ' : ''}HALLOWEEN NIGHT</div><h2>${escapeHtml(stop.title)}</h2><div class="detail-tags">${stop.categories.map((key) => `<span class="tag">${categories[key].icon} ${categories[key].label}</span>`).join('')}</div><p>⌖ ${escapeHtml(stop.address)}</p>${stop.notes ? `<p>${escapeHtml(stop.notes)}</p>` : ''}${organizerEditor}<div class="detail-actions"><button class="secondary" id="directions-stop">↗ Directions</button><button class="primary" id="share-stop">Share stop</button></div>${!isOrganizer && db && stop.created_by === currentUserId ? '<button class="secondary" id="remove-stop" style="width:100%;margin-top:10px">Remove my house</button>' : ''}`;
  $('#detail').hidden = false;
  $('.close-detail').onclick = () => { closeDetail(); render(); };
  $('#directions-stop').onclick = () => openDirections(stop);
  $('#share-stop').onclick = () => share(id);
  if ($('#organizer-edit')) $('#organizer-edit').onsubmit = async (event) => {
    event.preventDefault();
    const editForm = new FormData(event.target);
    const selectedCategories = [...new Set(editForm.getAll('categories'))];
    const errorElement = $('.organizer-edit-error');
    if (!selectedCategories.length) { errorElement.textContent = 'Choose at least one offering, or remove the home from the map.'; return; }
    const saveButton = event.target.querySelector('[type="submit"]');
    saveButton.disabled = true;
    const updates = { title: editForm.get('title').trim(), notes: editForm.get('notes').trim(), categories: selectedCategories };
    const { data, error } = await adminDb.from('stops').update(updates).eq('id', id).select().single();
    if (error) { errorElement.textContent = 'Could not save the changes. Please sign in again and retry.'; saveButton.disabled = false; return; }
    stops = stops.map((item) => item.id === id ? data : item);
    houseCache.delete(id);
    render();
    showDetail(id, false);
    toast('Home updated on the public map.');
  };
  if ($('#organizer-remove')) $('#organizer-remove').onclick = async () => {
    if (!confirm(`Remove ${stop.address} from the Halloween map?`)) return;
    $('#organizer-remove').disabled = true;
    const { error } = await adminDb.from('stops').delete().eq('id', id);
    if (error) { toast('Could not remove the home. Please sign in again and retry.'); $('#organizer-remove').disabled = false; return; }
    stops = stops.filter((item) => item.id !== id);
    houseCache.delete(id);
    closeDetail();
    render();
    toast('Home removed from the public map.');
  };
  if ($('#remove-stop')) $('#remove-stop').onclick = async () => {
    if (!confirm('Remove your house from the neighborhood map?')) return;
    $('#remove-stop').disabled = true;
    const { error } = await db.from('stops').delete().eq('id', id);
    if (error) { toast('Could not remove the house. Please try again.'); $('#remove-stop').disabled = false; return; }
    closeDetail();
    await loadStops();
    toast('Your house was removed.');
  };
  if (pan) {
    map.setView(houseCache.has(id) ? homeCenter(houseCache.get(id)) : [stop.lat, stop.lng], Math.max(map.getZoom(), 17), { animate: false });
    map.panBy(innerWidth > 700 ? [-175, 0] : [0, 100], { animate: false });
  }
}

async function share(id) {
  const url = new URL(location.href);
  url.hash = '';
  url.search = '';
  if (demo) url.searchParams.set('demo', '1');
  if (id) url.searchParams.set('stop', id);
  try {
    if (navigator.share) await navigator.share({ title: 'ArrowBrooke After Dark', url: url.href });
    else { await navigator.clipboard.writeText(url.href); toast('Map link copied.'); }
  } catch (error) {
    if (error.name !== 'AbortError') toast('Copy the map link from your browser’s address bar to share it.');
  }
}

async function ensureVisitorSession() {
  const { data, error } = await db.auth.getSession();
  if (error) throw error;
  let session = data.session;
  if (!session) {
    const result = await db.auth.signInAnonymously();
    if (result.error) throw result.error;
    session = result.data.session;
  }
  currentUserId = session.user.id;
}

function streetNearPin(lat, lng) {
  if (!streetMap) return null;
  try {
    const xScale = 111320 * Math.cos(lat * Math.PI / 180);
    const yScale = 111320;
    let best = null;
    let distance = 80;
    for (const feature of streetMap.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation_name' })) {
      const name = feature.properties?.['name:en'] || feature.properties?.name;
      if (!name) continue;
      const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : [];
      for (const line of lines) for (let index = 1; index < line.length; index += 1) {
        const a = [(line[index - 1][0] - lng) * xScale, (line[index - 1][1] - lat) * yScale];
        const b = [(line[index][0] - lng) * xScale, (line[index][1] - lat) * yScale];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const denominator = dx * dx + dy * dy;
        const ratio = denominator ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / denominator)) : 0;
        const currentDistance = Math.hypot(a[0] + ratio * dx, a[1] + ratio * dy);
        if (currentDistance < distance) { distance = currentDistance; best = { text: name, hasNumber: false }; }
      }
    }
    return best;
  } catch { return null; }
}

let addressRequest = 0;
let lastSuggestedAddress = '';
async function fillAddressFromPin(lat, lng) {
  const request = ++addressRequest;
  const input = document.querySelector('[name="address"]');
  const startingValue = input.value;
  if (startingValue.trim() && startingValue !== lastSuggestedAddress) { $('#address-help').textContent = 'Your entered address was kept. Check that it matches the new pin.'; return; }
  $('#address-help').textContent = 'Looking up this spot’s address…';
  try {
    await addressDataPromise;
    const localAddress = nearestNeighborhoodAddress(lat, lng);
    let result = localAddress ? { text: `${localAddress.number} ${localAddress.street}`, hasNumber: true } : null;
    if (!result) try { result = await lookupAddress(lat, lng, config.reverseGeocodeUrl); } catch { /* street fallback below */ }
    result = result || streetNearPin(lat, lng);
    if (request !== addressRequest || input.value !== startingValue) return;
    if (!result) { $('#address-help').textContent = 'No address found here. Please type the house number and street.'; return; }
    input.value = result.text;
    lastSuggestedAddress = result.text;
    chosenAddressKey = localAddress?.search || '';
    $('#address-help').textContent = result.hasNumber ? 'Address found—please confirm this is the correct home before saving.' : 'Street found—please add the house number before saving.';
    if (result.hasNumber) $('#pick-location').textContent = '⌖ Adjust or confirm on map';
  } catch {
    if (request === addressRequest) $('#address-help').textContent = 'Address lookup is unavailable. You can still type the address.';
  }
}

const dialog = $('#add-dialog');
const directionsDialog = $('#directions-dialog');
const formAddressInput = document.querySelector('[name="address"]');
const formAddressOptions = $('#address-options');

let directionsAddress = '';
function openDirections(stop) {
  directionsAddress = stop.address;
  $('#directions-address').textContent = stop.address;
  const destination = `${stop.lat},${stop.lng}`;
  $('#apple-directions').href = `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}&dirflg=w`;
  $('#google-directions').href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=walking`;
  $('#waze-directions').href = `https://www.waze.com/ul?ll=${encodeURIComponent(destination)}&navigate=yes`;
  directionsDialog.showModal();
}
$('.close-directions').onclick = () => directionsDialog.close();
$('#copy-destination').onclick = async () => {
  try {
    await navigator.clipboard.writeText(directionsAddress);
    directionsDialog.close();
    toast('Address copied.');
  } catch {
    toast('Select and copy the address shown above.');
  }
};

function chooseFormAddress(address) {
  const text = `${address.number} ${address.street}`;
  chosenLocation = [address.lat, address.lng];
  chosenAddressKey = address.search;
  formAddressInput.value = text;
  lastSuggestedAddress = text;
  formAddressOptions.hidden = true;
  $('#location-label').textContent = '✓ Address selected. Open the map to confirm the exact home.';
  $('#address-help').textContent = 'Please confirm that the marker is on your home before submitting.';
  $('#pick-location').textContent = '⌖ Show selected address on map';
  if (searchMarker) searchMarker.remove();
  searchMarker = L.marker(chosenLocation, {
    icon: L.divIcon({ className: 'search-location', iconSize: [20, 20], iconAnchor: [10, 10], html: '<span></span>' }),
    interactive: false,
    keyboard: false,
    zIndexOffset: 1200
  }).addTo(map);
  map.setView(chosenLocation, 19);
}

formAddressInput.oninput = async () => {
  await addressDataPromise;
  const query = normalizeAddressText(formAddressInput.value);
  if (formAddressInput.value !== lastSuggestedAddress) {
    chosenLocation = null;
    chosenAddressKey = '';
    $('#location-label').textContent = 'Choose a matching address below, or pick the home on the map.';
    $('#pick-location').textContent = '⌖ Choose location on map';
  }
  if (query.length < 2 || !addressDataLoaded) { formAddressOptions.hidden = true; return; }
  const matches = neighborhoodAddresses.filter((address) => address.search.includes(query))
    .sort((a, b) => Number(!a.search.startsWith(query)) - Number(!b.search.startsWith(query)) || a.search.localeCompare(b.search)).slice(0, 8);
  formAddressOptions.innerHTML = matches.map((address, index) => `<button type="button" class="form-address-option" role="option" data-address-option="${index}">${escapeHtml(address.number)} ${escapeHtml(address.street)}</button>`).join('');
  formAddressOptions._matches = matches;
  formAddressOptions.hidden = !matches.length;
  $('#address-help').textContent = matches.length ? 'Choose your exact address from the matching homes.' : 'No exact match yet. Keep typing or choose the home on the map.';
};

formAddressOptions.onclick = (event) => {
  const option = event.target.closest('[data-address-option]');
  if (option) chooseFormAddress(formAddressOptions._matches[Number(option.dataset.addressOption)]);
};

function centralDateString() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function submissionsClosed() {
  return centralDateString() > config.eventDate;
}

function updateSubmissionAvailability() {
  const closed = submissionsClosed();
  const addButton = $('#add');
  const addTab = $('#add-tab');
  addButton.disabled = closed;
  addTab.disabled = closed;
  if (closed) {
    addButton.innerHTML = '<span>✓</span> Submissions closed';
    addButton.title = 'Halloween home submissions closed on November 1.';
    addTab.innerHTML = '<span>✓</span>Submissions closed';
  }
}

function openAdd() {
  if (submissionsClosed()) {
    toast('Halloween home submissions closed on November 1.');
    return;
  }
  closeDetail();
  $('#form-error').textContent = '';
  dialog.showModal();
}
$('#add').onclick = openAdd;
$('#add-tab').onclick = openAdd;
$('.close-dialog').onclick = () => dialog.close();
$('#pick-location').onclick = () => {
  dialog.close();
  document.body.classList.add('picking');
  for (const id of ['place-hint', 'crosshair', 'confirm-location']) $(`#${id}`).hidden = false;
  if (chosenLocation) map.setView(chosenLocation, 18);
};
function endPicking() {
  document.body.classList.remove('picking');
  for (const id of ['place-hint', 'crosshair', 'confirm-location']) $(`#${id}`).hidden = true;
  dialog.showModal();
}
$('#confirm-location').onclick = () => {
  const point = map.getCenter();
  if (!insideFocusBoundary(point.lat, point.lng)) { toast('Please choose a spot inside ArrowBrooke.'); return; }
  chosenLocation = [point.lat, point.lng];
  chosenAddressKey = '';
  $('#location-label').textContent = '✓ Location selected. Tap above to adjust it.';
  endPicking();
  fillAddressFromPin(point.lat, point.lng);
};
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && document.body.classList.contains('picking')) endPicking(); });
function inNeighborhood(lat, lng) { return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 33.23 && lat <= 33.27 && lng >= -96.925 && lng <= -96.88; }

$('#stop-form').onsubmit = async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const errorElement = $('#form-error');
  errorElement.textContent = '';
  if (submissionsClosed()) { errorElement.textContent = 'Halloween home submissions are closed for this event.'; return; }
  const selectedCategories = [...new Set(form.getAll('categories'))];
  if (!selectedCategories.length) { errorElement.textContent = 'Choose at least one kind of treat.'; return; }
  if (!chosenLocation) { errorElement.textContent = 'Choose your house location on the map first.'; return; }
  const title = form.get('title').trim() || pickStopName(stops.map((stop) => stop.title));
  const address = form.get('address').trim();
  if (!address) { errorElement.textContent = 'Enter the house number and street address.'; return; }
  if (!chosenAddressKey || normalizeAddressText(address) !== chosenAddressKey) { errorElement.textContent = 'Choose your exact home from the verified ArrowBrooke address list.'; return; }
  if (!db && !demo) { errorElement.textContent = 'The public map is not connected yet. The organizer needs to finish the one-time setup.'; return; }
  const stop = { title, address, address_key: chosenAddressKey, categories: selectedCategories, notes: form.get('notes').trim(), lat: chosenLocation[0], lng: chosenLocation[1], event_date: config.eventDate };
  $('#save-stop').disabled = true;
  try {
    let id;
    if (demo) { id = crypto.randomUUID(); stops.push({ ...stop, id }); }
    else {
      await ensureVisitorSession();
      const { data, error } = await db.from('stops').insert(stop).select().single();
      if (error) throw error;
      id = data.id;
      await loadStops();
    }
    dialog.close();
    event.target.reset();
    chosenLocation = null;
    chosenAddressKey = '';
    if (searchMarker) {
      searchMarker.remove();
      searchMarker = null;
    }
    addressRequest += 1;
    lastSuggestedAddress = '';
    $('#address-help').textContent = 'Choose a spot on the map, or type the address yourself.';
    $('#location-label').textContent = 'Pick your house first; we’ll suggest its address.';
    $('#pick-location').textContent = '⌖ Choose location on map';
    formAddressOptions.hidden = true;
    filter.clear();
    $('#search').value = '';
    hideSearchResults();
    syncFilters();
    render();
    if (demo) showDetail(id);
    toast(demo ? 'Sample house added for this preview session.' : 'Your house is now on the ArrowBrooke map!');
  } catch (error) {
    if (error?.code === '23505') errorElement.textContent = 'That home is already listed for this event.';
    else if (error?.code === '23514') errorElement.textContent = 'Choose your exact home from the verified ArrowBrooke address list.';
    else if (error?.code === '22023') errorElement.textContent = 'Halloween home submissions are closed for this event.';
    else errorElement.textContent = 'Could not save your house. Check your connection and try again.';
  } finally { $('#save-stop').disabled = false; }
};

function syncFilters() {
  document.querySelectorAll('[data-category]').forEach((button) => {
    const active = button.dataset.category === 'all' ? !filter.size : filter.has(button.dataset.category);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
$('.filters').onclick = (event) => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  const category = button.dataset.category;
  if (category === 'all') filter.clear();
  else if (filter.has(category)) filter.delete(category);
  else filter.add(category);
  syncFilters();
  closeDetail();
  render();
};
$('#search').oninput = () => {
  closeDetail();
  render();
  clearTimeout(searchTimer);
  const query = $('#search').value.trim();
  if (!query && searchMarker) {
    searchMarker.remove();
    searchMarker = null;
  }
  if (query.length < 2) { searchRequest += 1; hideSearchResults(); return; }
  searchTimer = setTimeout(() => searchAddresses(query), 300);
};
$('#search').onkeydown = (event) => {
  if (event.key === 'Escape') hideSearchResults();
  if (event.key === 'ArrowDown' && !$('#search-results').hidden) { event.preventDefault(); $('#search-results').querySelector('button')?.focus(); }
  if (event.key === 'Enter' && !$('#search-results').hidden) {
    const first = $('#search-results')._results?.[0];
    if (first) { event.preventDefault(); selectSearchResult(first); }
  }
};
$('#search-results').onclick = (event) => {
  const button = event.target.closest('[data-result]');
  if (button) selectSearchResult($('#search-results')._results[Number(button.dataset.result)]);
};
document.addEventListener('click', (event) => { if (!event.target.closest('.search-panel')) hideSearchResults(); });
$('#explore-tab').onclick = () => setSheet(true);
$('#home').onclick = () => showWholeNeighborhood(true);
$('#zoom-in').onclick = () => map.zoomIn();
$('#zoom-out').onclick = () => map.zoomOut();
$('#share').onclick = () => share();
const locationDialog = $('#location-dialog');

function locationIconMarkup(icon) {
  const option = [...document.querySelectorAll('[data-location-icon]')]
    .find((button) => button.dataset.locationIcon === icon);
  return option?.querySelector('span')?.innerHTML || '🎃';
}

function locationMarkerIcon(icon = selectedLocationIcon) {
  return L.divIcon({
    className: 'halloween-location-shell',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    html: `<span class="halloween-location-icon" aria-hidden="true">${locationIconMarkup(icon)}</span>`
  });
}

function refreshLocationControls() {
  document.querySelectorAll('[data-location-icon]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.locationIcon === selectedLocationIcon));
  });
  const active = userLocationWatchId !== null;
  $('#start-location').hidden = active;
  $('#stop-location').hidden = !active;
  $('#locate').classList.toggle('location-live', active);
  $('#locate').innerHTML = active ? locationIconMarkup(selectedLocationIcon) : '◎';
  $('#location-status').textContent = active
    ? 'Live location is on. Your marker will keep moving while this map is open.'
    : 'Choose an icon, then allow location access.';
}

function updateUserLocation(position) {
  const latlng = [position.coords.latitude, position.coords.longitude];
  const firstFix = !lastUserLatLng;
  lastUserLatLng = latlng;
  if (!userMarker) {
    userMarker = L.marker(latlng, { icon: locationMarkerIcon(), zIndexOffset: 1400 })
      .addTo(map)
      .bindTooltip('Your live location');
  } else {
    userMarker.setLatLng(latlng).setIcon(locationMarkerIcon());
  }
  if (firstFix) map.setView(latlng, Math.max(map.getZoom(), 17));
  refreshLocationControls();
}

function stopLocationSharing() {
  if (userLocationWatchId !== null) navigator.geolocation.clearWatch(userLocationWatchId);
  userLocationWatchId = null;
  lastUserLatLng = null;
  if (userMarker) userMarker.remove();
  userMarker = null;
  refreshLocationControls();
}

function startLocationSharing() {
  if (!navigator.geolocation) { toast('Your browser does not support location.'); return; }
  $('#start-location').disabled = true;
  $('#location-status').textContent = 'Waiting for your phone’s location…';
  userLocationWatchId = navigator.geolocation.watchPosition((position) => {
    $('#start-location').disabled = false;
    updateUserLocation(position);
    locationDialog.close();
  }, (error) => {
    stopLocationSharing();
    $('#start-location').disabled = false;
    $('#location-status').textContent = error.code === 1
      ? 'Location permission is off. Enable it for this app or browser in your phone settings.'
      : 'Location is unavailable right now. Try again outdoors or near a window.';
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
}

$('#locate').onclick = () => {
  refreshLocationControls();
  locationDialog.showModal();
};
$('.close-location').onclick = () => locationDialog.close();
$('#start-location').onclick = startLocationSharing;
$('#stop-location').onclick = () => {
  stopLocationSharing();
  locationDialog.close();
  toast('Live location stopped.');
};
$('.location-icon-options').onclick = (event) => {
  const button = event.target.closest('[data-location-icon]');
  if (!button) return;
  selectedLocationIcon = button.dataset.locationIcon;
  localStorage.setItem('arrowbrooke-location-icon', selectedLocationIcon);
  if (userMarker) userMarker.setIcon(locationMarkerIcon());
  refreshLocationControls();
};
window.addEventListener('pagehide', () => {
  if (userLocationWatchId !== null) navigator.geolocation.clearWatch(userLocationWatchId);
});
refreshLocationControls();

let stopsRefreshPromise = null;
let stopsRealtimeRevision = 0;
let stopsRefreshTimer;
let organizerLiveChannel = null;

function syncOrganizerLiveUpdates() {
  if (!adminDb || demo) return;
  if (!isOrganizer) {
    const oldChannel = organizerLiveChannel;
    organizerLiveChannel = null;
    if (oldChannel) {
      adminDb.removeChannel(oldChannel).catch(() => {});
      status('● Map ready · Homes refresh automatically.', true);
    }
    return;
  }
  if (organizerLiveChannel) return;
  const channel = adminDb.channel('organizer-halloween-stops');
  organizerLiveChannel = channel;
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'stops' }, payload => {
    if (isOrganizer && organizerLiveChannel === channel) applyStopChange(payload);
  }).subscribe(state => {
    if (!isOrganizer || organizerLiveChannel !== channel) return;
    if (state === 'SUBSCRIBED') {
      status('● Organizer live updates connected.', true);
      queueStopsRefresh();
    } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(state)) {
      status('Live updates reconnecting · Homes still refresh periodically.');
    }
  });
}

function validPublicStop(stop) {
  return stop?.event_date === config.eventDate && stop.approval_status === 'approved'
    && Array.isArray(stop.categories) && stop.categories.length
    && stop.categories.every(key => categories[key]) && inNeighborhood(stop.lat, stop.lng);
}

function queueStopsRefresh() {
  clearTimeout(stopsRefreshTimer);
  stopsRefreshTimer = setTimeout(() => loadStops().catch(() => status('Reconnecting · New homes may be delayed.')), 300);
}

function applyStopChange(payload) {
  const id = payload.eventType === 'DELETE' ? payload.old?.id : payload.new?.id;
  if (!id || (payload.eventType !== 'DELETE' && !payload.new?.event_date)) { queueStopsRefresh(); return; }
  stopsRealtimeRevision += 1;
  stops = stops.filter(stop => stop.id !== id);
  if (payload.eventType !== 'DELETE' && validPublicStop(payload.new)) stops.push(payload.new);
  else houseCache.delete(id);
  stops.sort((a,b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)));
  if (document.hidden) return;
  render();
  if (selectedId === id && stops.some(stop => stop.id === id)) showDetail(id, false);
}

function loadStops() {
  if (stopsRefreshPromise) return stopsRefreshPromise;
  stopsRefreshPromise = (async () => {
    // If a live event arrives during the snapshot request, read again so an
    // older response cannot overwrite a newly added, edited, or removed home.
    let revision;
    let data;
    do {
      revision = stopsRealtimeRevision;
      const result = await (publicDb || db).from('stops').select('*').eq('event_date', config.eventDate).eq('approval_status', 'approved').order('created_at');
      if (result.error) throw result.error;
      data = result.data || [];
    } while (revision !== stopsRealtimeRevision);
    stops = data.filter(validPublicStop);
    render();
    if (!isOrganizer) status('● Map ready · Homes refresh automatically.', true);
    if (selectedId && stops.some(stop => stop.id === selectedId)) showDetail(selectedId, false);
  })().finally(() => { stopsRefreshPromise = null; });
  return stopsRefreshPromise;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && db && !demo) loadStops().catch(() => status('Offline · Showing the last loaded homes.'));
});

async function initialize() {
  if (demo) { stops = demoStops; status('Preview · Sample participating homes', true); render(); return; }
  if (!config.supabaseUrl || !config.supabaseKey) { status('Map setup in progress · Open the demo preview to explore the design.'); render(); return; }
  try {
    db = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
    // Viewing uses the public read policy, independent of visitor sign-in.
    publicDb = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'arrowbrooke-public-reader' }
    });
    db.auth.onAuthStateChange((event, session) => {
      currentUserId = session?.user?.id || null;
    });
    setInterval(() => {
      if (!document.hidden) loadStops().catch(() => status('Offline · Showing the last loaded homes.'));
    }, 120000 + Math.floor(Math.random() * 30000));
    await loadStops();
    const requested = new URLSearchParams(location.search).get('stop');
    if (requested) showDetail(requested);
  } catch { status('Could not connect to the neighborhood map. Please try reloading.'); render(); }
}

map.on('zoomend', render);
updateSubmissionAvailability();
setInterval(updateSubmissionAvailability, 60000);
initialize();

function setSheet(expanded) {
  setSheetState(expanded ? 'expanded' : 'minimized');
}

function setSheetState(state) {
  document.documentElement.style.removeProperty('--sheet-height');
  document.body.classList.toggle('sheet-expanded', state === 'expanded');
  document.body.classList.toggle('sheet-minimized', state === 'minimized');
  const expanded = state === 'expanded';
  $('#sheet-toggle').setAttribute('aria-expanded', String(expanded));
  $('#sheet-toggle').setAttribute('aria-label', state === 'minimized' ? 'Open stop list' : expanded ? 'Minimize stop list' : 'Expand stop list');
  document.querySelector('.explore').scrollTop = 0;
}

const sheetHandle = $('#sheet-toggle');
const sheetPanel = document.querySelector('.explore');
const sheetDragSurfaces = [sheetHandle, sheetPanel.querySelector('.eyebrow'), sheetPanel.querySelector('.title-row')];
let sheetDrag = null;
let suppressSheetClick = false;
const usesMobileSheet = () => innerWidth <= 700 || (innerHeight <= 500 && matchMedia('(pointer: coarse)').matches);
const isPhoneLandscapeSheet = () => innerWidth > 700 && innerHeight <= 500 && matchMedia('(pointer: coarse)').matches;

function beginSheetDrag(event) {
  if (!usesMobileSheet() || event.button > 0) return;
  sheetDrag = { startY: event.clientY, startHeight: sheetPanel.getBoundingClientRect().height, pointerId: event.pointerId, moved: false, startedOnHandle: event.currentTarget === sheetHandle };
  sheetHandle.setPointerCapture(event.pointerId);
  document.body.classList.add('sheet-dragging');
  document.body.classList.remove('sheet-expanded', 'sheet-minimized');
  document.documentElement.style.setProperty('--sheet-height', `${sheetDrag.startHeight}px`);
}

function moveSheetDrag(event) {
  if (!sheetDrag || event.pointerId !== sheetDrag.pointerId) return;
  const distance = sheetDrag.startY - event.clientY;
  if (Math.abs(distance) > 5) sheetDrag.moved = true;
  const maximumHeight = isPhoneLandscapeSheet() ? Math.max(56, innerHeight - 92) : innerHeight * 0.72;
  const height = Math.max(isPhoneLandscapeSheet() ? 56 : 64, Math.min(maximumHeight, sheetDrag.startHeight + distance));
  document.documentElement.style.setProperty('--sheet-height', `${height}px`);
}

function finishSheetDrag(event) {
  if (!sheetDrag || event.pointerId !== sheetDrag.pointerId) return;
  const landscape = isPhoneLandscapeSheet();
  const height = sheetPanel.getBoundingClientRect().height;
  const stops = [
    { state: 'minimized', height: landscape ? 56 : 64 },
    { state: 'medium', height: innerHeight * (landscape ? 0.46 : 0.34) },
    { state: 'expanded', height: landscape ? Math.max(56, innerHeight - 92) : innerHeight * 0.67 }
  ];
  const nearest = stops.reduce((best, stop) => Math.abs(stop.height - height) < Math.abs(best.height - height) ? stop : best);
  suppressSheetClick = sheetDrag.moved && sheetDrag.startedOnHandle;
  sheetDrag = null;
  document.body.classList.remove('sheet-dragging');
  setSheetState(nearest.state);
}

for (const surface of sheetDragSurfaces) {
  surface.addEventListener('pointerdown', beginSheetDrag);
  surface.addEventListener('pointermove', moveSheetDrag);
  surface.addEventListener('pointerup', finishSheetDrag);
  surface.addEventListener('pointercancel', finishSheetDrag);
}
sheetHandle.onclick = () => {
  if (suppressSheetClick) { suppressSheetClick = false; return; }
  const nextState = document.body.classList.contains('sheet-expanded') ? 'medium' : 'expanded';
  setSheetState(nextState);
};

window.addEventListener('load', () => {
  // Mobile Safari settles its visual viewport and safe-area measurements after
  // the document loads. Use the same settled calculation as the Home button.
  setTimeout(() => showWholeNeighborhood(false), innerWidth <= 700 ? 450 : 0);
}, { once: true });
window.addEventListener('orientationchange', () => setTimeout(() => showWholeNeighborhood(false), 250));

