-- Private crew trails. Run after supabase-setup.sql.
-- Stops remain shareable; precise route data is restricted to joined crew members.
create table if not exists public.trail_crews (
 id uuid primary key default gen_random_uuid(),
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(),
 invite_hash text not null unique,
 ended_at timestamptz
);
create table if not exists public.trail_members (
 crew_id uuid not null references public.trail_crews(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(crew_id,user_id)
);
create table if not exists public.trail_points (
 id uuid primary key,
 crew_id uuid not null references public.trail_crews(id) on delete cascade,
 created_by uuid not null default auth.uid() references auth.users(id),
 run_id uuid not null,
 captured_at timestamptz not null,
 lat double precision not null check(lat between 33.23 and 33.27),
 lng double precision not null check(lng between -96.925 and -96.88),
 accuracy double precision not null check(accuracy between 0 and 40),
 unique(crew_id,created_by,run_id,captured_at)
);
create index if not exists trail_points_crew_time on public.trail_points(crew_id,captured_at,id);
alter table public.trail_crews enable row level security;
alter table public.trail_members enable row level security;
alter table public.trail_points enable row level security;
revoke all on public.trail_crews,public.trail_members,public.trail_points from anon,authenticated;
grant select on public.trail_crews,public.trail_members,public.trail_points to authenticated;
grant update(ended_at) on public.trail_crews to authenticated;
grant insert(id,crew_id,run_id,captured_at,lat,lng,accuracy) on public.trail_points to authenticated;
drop policy if exists "Read own trail membership" on public.trail_members;
create policy "Read own trail membership" on public.trail_members for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists "Crew can read their night" on public.trail_crews;
create policy "Crew can read their night" on public.trail_crews for select to authenticated using(exists(select 1 from public.trail_members m where m.crew_id=trail_crews.id and m.user_id=(select auth.uid())));
drop policy if exists "Owner can finish night" on public.trail_crews;
create policy "Owner can finish night" on public.trail_crews for update to authenticated using(created_by=(select auth.uid())) with check(created_by=(select auth.uid()));
drop policy if exists "Crew can read trail" on public.trail_points;
create policy "Crew can read trail" on public.trail_points for select to authenticated using(exists(select 1 from public.trail_members m where m.crew_id=trail_points.crew_id and m.user_id=(select auth.uid())));
drop policy if exists "Crew can contribute own locations" on public.trail_points;
create policy "Crew can contribute own locations" on public.trail_points for insert to authenticated with check(
 created_by=(select auth.uid()) and captured_at between now()-interval '48 hours' and now()+interval '5 minutes'
 and exists(select 1 from public.trail_members m join public.trail_crews c on c.id=m.crew_id
 where m.crew_id=trail_points.crew_id and m.user_id=(select auth.uid()) and (c.ended_at is null or trail_points.captured_at<=c.ended_at))
);
create or replace function public.create_trail_crew() returns table(crew_id uuid,invite_code text)
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_code text; v_user uuid:=auth.uid();
begin
 if v_user is null then raise exception 'Sign in first'; end if;
 if (select count(*) from public.trail_crews c where c.created_by=v_user and c.created_at>now()-interval '24 hours')>=5 then raise exception 'Daily limit reached'; end if;
 v_code:=substr(replace(gen_random_uuid()::text,'-',''),1,18);
 insert into public.trail_crews(created_by,invite_hash) values(v_user,encode(sha256(convert_to(v_code,'UTF8')),'hex')) returning id into v_id;
 insert into public.trail_members(crew_id,user_id) values(v_id,v_user);
 return query select v_id,v_code;
end; $$;
create or replace function public.join_trail_crew(p_code text) returns table(crew_id uuid,ended_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_end timestamptz; v_user uuid:=auth.uid();
begin
 if v_user is null then raise exception 'Sign in first'; end if;
 if p_code !~ '^[0-9a-f]{18}$' then raise exception 'Invalid crew code'; end if;
 select c.id,c.ended_at into v_id,v_end from public.trail_crews c where c.invite_hash=encode(sha256(convert_to(p_code,'UTF8')),'hex');
 if v_id is null then raise exception 'Invalid crew code'; end if;
 insert into public.trail_members(crew_id,user_id) values(v_id,v_user) on conflict do nothing;
 return query select v_id,v_end;
end; $$;
revoke all on function public.create_trail_crew() from public,anon;
revoke all on function public.join_trail_crew(text) from public,anon;
grant execute on function public.create_trail_crew() to authenticated;
grant execute on function public.join_trail_crew(text) to authenticated;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trail_points') then alter publication supabase_realtime add table public.trail_points; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trail_crews') then alter publication supabase_realtime add table public.trail_crews; end if;
end $$;
