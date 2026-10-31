-- PERSONAL PROJECT zskwzqzmmymhdwfcmugw ONLY. Arrowbrooke is a read-only source.
begin;
create extension if not exists http with schema extensions;
create schema if not exists personal_private;
revoke all on schema personal_private from public,anon,authenticated;
create table if not exists personal_private.sync_state (
 id boolean primary key default true check(id),
 last_attempt timestamptz, last_success timestamptz, last_error text, home_count integer not null default 0
);
alter table personal_private.sync_state enable row level security;
insert into personal_private.sync_state(id) values(true) on conflict do nothing;
create table if not exists public.neighborhood_homes (
 id uuid primary key,
 record jsonb not null,
 synced_at timestamptz not null default now()
);
alter table public.neighborhood_homes enable row level security;
revoke all on public.neighborhood_homes from public,anon,authenticated;
grant select on public.neighborhood_homes to anon,authenticated;
create policy "Read mirrored approved homes" on public.neighborhood_homes for select to anon,authenticated using(true);
alter table public.stops add column if not exists neighborhood_source_id uuid;
update public.stops s set neighborhood_source_id=s.id
where exists(select 1 from personal_legacy_20261031.source_home_owners o where o.stop_id=s.id);
insert into public.neighborhood_homes(id,record)
select id,to_jsonb(s)-'neighborhood_source_id'-'created_by' from public.stops s where neighborhood_source_id is not null
on conflict(id) do nothing;
create or replace function public.refresh_neighborhood_homes() returns jsonb
language plpgsql security definer set search_path='' as $$
declare response extensions.http_response; batch jsonb; all_rows jsonb:='[]'; offset_count integer:=0; n integer; old_n integer; stamp timestamptz; range_header text; total_count integer;
begin
 if not pg_try_advisory_xact_lock(31842,20261031) then
  return jsonb_build_object('status','busy');
 end if;
 select last_attempt into stamp from personal_private.sync_state where id=true;
 if stamp is not null and stamp>clock_timestamp()-interval '30 seconds' then
  return (select jsonb_build_object('status','cached','last_success',last_success,'count',home_count,'error',last_error) from personal_private.sync_state where id=true);
 end if;
 update personal_private.sync_state set last_attempt=clock_timestamp() where id=true;
 begin
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','3000');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','10000');
  loop
   select * into response from extensions.http((
    'GET',
    'https://kbiyuhxugkuofftmrkdc.supabase.co/rest/v1/stops?select=*&event_date=eq.2026-10-31&approval_status=eq.approved&order=id&limit=1000&offset='||offset_count,
    array[extensions.http_header('apikey','sb_publishable_Z-gH4ovBmap5sbCSyJ04hg_TxVBC4r9'),extensions.http_header('Prefer','count=exact')],null,null
   )::extensions.http_request);
   if response.status<>200 and response.status<>206 then raise exception 'Source unavailable'; end if;
   batch:=response.content::jsonb;
   if jsonb_typeof(batch)<>'array' then raise exception 'Unexpected source response'; end if;
   select h.value into range_header from unnest(response.headers) h where lower(h.field)='content-range';
   if range_header is null or split_part(range_header,'/',2) !~ '^[0-9]+$' then raise exception 'Source completeness could not be verified'; end if;
   total_count:=split_part(range_header,'/',2)::integer;
   all_rows:=all_rows||batch;
   n:=jsonb_array_length(batch);
   offset_count:=offset_count+n;
   exit when offset_count>=total_count;
   if n=0 or offset_count>=5000 then raise exception 'Incomplete source snapshot'; end if;
  end loop;
  if jsonb_array_length(all_rows)<>total_count then raise exception 'Incomplete source snapshot'; end if;
  select count(*) into old_n from public.neighborhood_homes;
  if total_count=0 or (old_n>20 and total_count<old_n/2) then raise exception 'Unusually small snapshot held for safety'; end if;
  if exists(select 1 from jsonb_array_elements(all_rows) r where
   r->>'event_date'<>'2026-10-31' or r->>'approval_status'<>'approved' or
   (r->>'lat')::float8 not between 33.23 and 33.27 or (r->>'lng')::float8 not between -96.925 and -96.88 or
   jsonb_typeof(r->'categories')<>'array' or not (r->'categories'<@'["candy","nonfood","adult"]'::jsonb)
  ) then raise exception 'Invalid source snapshot'; end if;
  insert into public.neighborhood_homes(id,record,synced_at)
   select (r->>'id')::uuid,r-'created_by',clock_timestamp() from jsonb_array_elements(all_rows) r
   on conflict(id) do update set record=excluded.record,synced_at=excluded.synced_at;
  delete from public.neighborhood_homes where id not in(select (r->>'id')::uuid from jsonb_array_elements(all_rows) r);
  update personal_private.sync_state set last_success=clock_timestamp(),last_error=null,home_count=total_count where id=true;
  return (select jsonb_build_object('status','updated','last_success',last_success,'count',home_count) from personal_private.sync_state where id=true);
 exception when others then
  update personal_private.sync_state set last_error='Neighborhood refresh unavailable; saved homes retained.' where id=true;
  return jsonb_build_object('status','error','error','Neighborhood refresh unavailable; saved homes retained.');
 end;
end; $$;
revoke all on function public.refresh_neighborhood_homes() from public;
grant execute on function public.refresh_neighborhood_homes() to anon,authenticated;
commit;
select public.refresh_neighborhood_homes();

