// Map display priority. The stop retains every selected offering in its details.
export function displayCategory(stop) {
  if(stop.categories.includes('adult'))return 'adult';
  if(stop.categories.includes('decor'))return 'decor';
  return 'candy';
}
