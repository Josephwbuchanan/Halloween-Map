// Map display priority. The stop retains every selected offering in its details.
export function displayCategory(stop) {
  const selected = new Set(stop.categories || []);
  if (selected.has('candy') && selected.has('nonfood') && selected.has('adult')) return 'allthree';
  if (selected.has('adult')) return 'adult';
  if (selected.has('nonfood')) return 'nonfood';
  return 'candy';
}
