import { buildRoadGraph } from './road-trail.js?v=personal-cart-v1';

// Only public street geometry is cached here, never a person's GPS fixes.
// This reuses the map's existing tiles; it does not contact another provider.
export function createRoadCache(getMap, onChange = () => {}) {
  const storageKey = 'personal-halloween-street-geometry-v1';
  const features = new Map();
  let graph = null, saveTimer = null;
  const allowed = new Set(['minor', 'service', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway']);
  const near = ([lng, lat]) => lng >= -96.912 && lng <= -96.892 && lat >= 33.237 && lat <= 33.254;
  function add(feature) {
    const p = feature.properties || {};
    if (p.class && !allowed.has(p.class)) return false;
    if (['driveway', 'parking_aisle'].includes(p.subclass)) return false;
    const lines = feature.geometry?.type === 'LineString' ? [feature.geometry.coordinates]
      : feature.geometry?.type === 'MultiLineString' ? feature.geometry.coordinates : [];
    let changed = false;
    for (const line of lines) {
      if (line.length < 2 || !line.some(near)) continue;
      const key = line.map(c => c.map(n => n.toFixed(6)).join(',')).join(';');
      if (features.has(key)) continue;
      features.set(key, { type: 'Feature', properties: { class: p.class || 'minor', subclass: p.subclass }, geometry: { type: 'LineString', coordinates: line } });
      changed = true;
    }
    return changed;
  }
  try { for (const f of JSON.parse(localStorage.getItem(storageKey) || '[]')) add(f); } catch {}
  function collect() {
    const map = getMap();
    if (!map?.isStyleLoaded()) return;
    let changed = false;
    try { for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation' })) changed = add(f) || changed; } catch { return; }
    if (!changed) return;
    graph = null;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify([...features.values()].slice(-2000))); } catch {}
    }, 1000);
    onChange();
  }
  return {
    collect,
    graph() { return graph ||= buildRoadGraph([...features.values()]); },
    size() { return features.size; }
  };
}

