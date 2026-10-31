begin;
create table if not exists public.map_messages (
 id uuid primary key default gen_random_uuid(),
 created_at timestamptz not null default now(),
 created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
 message text not null check (char_length(trim(message)) between 5 and 400)
);
alter table public.map_messages enable row level security;
revoke all on public.map_messages from public, anon, authenticated;
grant insert (message) on public.map_messages to authenticated;
grant select on public.map_messages to authenticated, service_role;
create policy "Visitors send map messages" on public.map_messages for insert to authenticated
 with check (created_by = (select auth.uid()));
create policy "Organizer reads map messages" on public.map_messages for select to authenticated
 using ((select auth.jwt()->>'email') = 'organizer@arrowbrooke-map.invalid');
create or replace function public.limit_map_messages() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtext('map-message-' || new.created_by::text));
 if (select count(*) from public.map_messages where created_by=new.created_by and created_at > now()-interval '1 hour') >= 3 then
  raise exception 'Please wait before sending another message.' using errcode='P0001';
 end if;
 new.message := trim(new.message);
 return new;
end;
$$;
revoke all on function public.limit_map_messages() from public, anon, authenticated;
create trigger limit_map_messages before insert on public.map_messages for each row execute function public.limit_map_messages();
-- Reuse the existing webhook configuration without exposing its secret.
do $$ declare hook text; begin
 select pg_get_triggerdef(oid) into hook from pg_trigger
 where tgrelid='public.stops'::regclass and tgname='notify_new_stop';
 if hook is null or position('ON public.stops' in hook)=0 then raise exception 'Existing notification webhook not found'; end if;
 hook := replace(replace(hook,'notify_new_stop','notify_map_message'),'ON public.stops','ON public.map_messages');
 execute hook;
end $$;
commit;
