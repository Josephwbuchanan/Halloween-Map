import { readFile, writeFile } from 'node:fs/promises';

const input = process.argv[2];
if (!input) throw new Error('Provide the downloaded Overture building GeoJSON path.');

const source = JSON.parse(await readFile(input, 'utf8'));
const output = {
  type: 'FeatureCollection',
  features: (source.features || [])
    .filter((feature) => {
      if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') return false;
      const sources = feature.properties?.sources || [];
      return !sources.some((item) => item.dataset === 'OpenStreetMap' || item.provider === 'osm');
    })
    .map((feature) => ({ type: 'Feature', properties: {}, geometry: feature.geometry }))
};

await writeFile(new URL('../arrowbrooke-buildings.geojson', import.meta.url), `${JSON.stringify(output)}\n`);
console.log(JSON.stringify({
  sourceFeatures: source.features?.length || 0,
  supplementalNonOsmFootprints: output.features.length,
  removedBaseMapDuplicates: (source.features?.length || 0) - output.features.length
}, null, 2));
