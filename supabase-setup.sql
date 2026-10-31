-- Run once in the Supabase SQL Editor for a new project.
create table if not exists public.stops (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_date date not null,
  title text not null check (char_length(trim(title)) between 1 and 80),
  address text not null check (char_length(trim(address)) between 1 and 140),
  address_key text not null check (char_length(trim(address_key)) between 3 and 140),
  notes text not null default '' check (char_length(notes) <= 400),
  approval_status text not null default 'approved' check (approval_status in ('approved','rejected')),
  categories text[] not null check (
    cardinality(categories) between 1 and 3 and
    categories <@ array['candy','nonfood','adult']::text[] and
    array_position(categories, null) is null
  ),
  lat double precision not null check (lat between 33.23 and 33.27),
  lng double precision not null check (lng between -96.925 and -96.88),
  starts time not null default '00:00'::time,
  ends time not null default '23:59:59'::time,
  check (ends > starts)
);
alter table public.stops add column if not exists address_key text;
alter table public.stops alter column approval_status set default 'approved';
create index if not exists stops_event_date_idx on public.stops(event_date);
create unique index if not exists one_listing_per_home_per_event on public.stops(event_date, address_key);
alter table public.stops enable row level security;
revoke all on public.stops from anon, authenticated;
grant select on public.stops to anon, authenticated;
grant insert (event_date, title, address, address_key, notes, categories, lat, lng, starts, ends) on public.stops to authenticated;
grant delete on public.stops to authenticated;
drop policy if exists "Anyone can read Halloween stops" on public.stops;
drop policy if exists "Approved homes are public and owners can review submissions" on public.stops;
create policy "Approved homes are public and owners can review submissions" on public.stops
for select to anon, authenticated
using (approval_status = 'approved' or created_by = (select auth.uid()));
drop policy if exists "Visitors can add their own stops" on public.stops;
create policy "Visitors can add their own stops" on public.stops for insert to authenticated with check (created_by = (select auth.uid()));
drop policy if exists "Visitors can remove their own stops" on public.stops;
create policy "Visitors can remove their own stops" on public.stops for delete to authenticated using (created_by = (select auth.uid()));
-- Modest per-visitor cap; anonymous sign-in rate limits also apply.
create or replace function public.limit_halloween_stops() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.created_by::text));
  if (select count(*) from public.stops where created_by = new.created_by and event_date = new.event_date) >= 12 then
    raise exception 'You can add up to 12 stops per Halloween.';
  end if;
  return new;
end;
$$;
revoke execute on function public.limit_halloween_stops() from public, anon, authenticated;
drop trigger if exists limit_halloween_stops on public.stops;
create trigger limit_halloween_stops before insert on public.stops for each row execute function public.limit_halloween_stops();
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stops') then
    alter publication supabase_realtime add table public.stops;
  end if;
end $$;

-- Legacy time columns remain compatible, but no times are required in the UI.
alter table public.stops alter column starts set default '00:00'::time;
alter table public.stops alter column ends set default '23:59:59'::time;
