import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { applyAddressCorrections } from '../address-corrections.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(projectRoot, 'arrowbrooke-addresses.geojson');
const outputPath = path.join(projectRoot, 'supabase-address-validation.sql');
const source = applyAddressCorrections(JSON.parse(await readFile(sourcePath, 'utf8')));

const uppercaseWords = new Set(['FM']);
const displayStreetName = (value) => String(value || '').toLowerCase().split(/\s+/).map((part) => {
  const upper = part.toUpperCase();
  return uppercaseWords.has(upper) ? upper : `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
}).join(' ');

const normalizeAddress = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  .replace(/\bavenue\b/g, 'ave').replace(/\bboulevard\b/g, 'blvd')
  .replace(/\bcourt\b/g, 'ct').replace(/\bdrive\b/g, 'dr')
  .replace(/\blane\b/g, 'ln').replace(/\bplace\b/g, 'pl')
  .replace(/\bparkway\b/g, 'pkwy').replace(/\broad\b/g, 'rd')
  .replace(/\bstreet\b/g, 'st').replace(/\btrail\b/g, 'trl');

const sqlText = (value) => `'${String(value).replace(/'/g, "''")}'`;
const addresses = source.features.map((feature) => {
  const number = String(feature.properties?.number || '').trim();
  const street = displayStreetName(feature.properties?.street);
  const displayAddress = `${number} ${street}`;
  const [lng, lat] = feature.geometry.coordinates;
  return { addressKey: normalizeAddress(displayAddress), displayAddress, lat, lng };
}).sort((left, right) => left.addressKey.localeCompare(right.addressKey));

const duplicateKeys = addresses.filter((address, index) => index && address.addressKey === addresses[index - 1].addressKey);
if (duplicateKeys.length) throw new Error(`Duplicate address keys: ${duplicateKeys.map((address) => address.addressKey).join(', ')}`);

const values = addresses.map((address) =>
  `  (${sqlText(address.addressKey)}, ${sqlText(address.displayAddress)}, ${address.lat}, ${address.lng})`
).join(',\n');

const sql = `-- Generated from arrowbrooke-addresses.geojson by scripts/generate-verified-addresses-sql.mjs.
-- Re-run the generator whenever the neighborhood address file changes.
begin;

create table if not exists public.verified_addresses (
  address_key text primary key,
  display_address text not null,
  lat double precision not null,
  lng double precision not null
);
alter table public.verified_addresses enable row level security;
revoke all on public.verified_addresses from public, anon, authenticated;
truncate table public.verified_addresses;
insert into public.verified_addresses (address_key, display_address, lat, lng) values
${values};

create table if not exists public.map_events (
  event_date date primary key,
  submissions_close_at timestamptz not null
);
alter table public.map_events enable row level security;
revoke all on public.map_events from public, anon, authenticated;
insert into public.map_events (event_date, submissions_close_at)
values ('2026-10-31', '2026-11-01 00:00:00 America/Chicago'::timestamptz)
on conflict (event_date) do update set submissions_close_at = excluded.submissions_close_at;

create or replace function public.validate_halloween_stop()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical public.verified_addresses%rowtype;
begin
  if not exists (
    select 1 from public.map_events
    where event_date = new.event_date and current_timestamp < submissions_close_at
  ) then
    raise exception 'Halloween home submissions are closed for this event.' using errcode = '22023';
  end if;

  select * into canonical
  from public.verified_addresses
  where address_key = lower(trim(new.address_key));

  if canonical.address_key is null then
    raise exception 'Choose an address from the verified ArrowBrooke home list.' using errcode = '23514';
  end if;

  new.address_key := canonical.address_key;
  new.address := canonical.display_address;
  new.lat := canonical.lat;
  new.lng := canonical.lng;
  return new;
end;
$$;

revoke all on function public.validate_halloween_stop() from public, anon, authenticated;
drop trigger if exists validate_halloween_stop on public.stops;
create trigger validate_halloween_stop
before insert on public.stops
for each row execute function public.validate_halloween_stop();

commit;
`;

await writeFile(outputPath, sql, 'utf8');
console.log(`Wrote ${addresses.length} verified addresses to ${outputPath}`);
