-- Run once in the Supabase SQL Editor after supabase-setup.sql and
-- supabase-organizer-setup.sql. This table stores only the organizer's Web
-- Push delivery information; residents and anonymous visitors cannot read it.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default ''
);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, delete on public.push_subscriptions to service_role;

drop policy if exists "Organizer manages notification subscriptions" on public.push_subscriptions;
create policy "Organizer manages notification subscriptions" on public.push_subscriptions
for all to authenticated
using ((select auth.jwt() ->> 'email') = 'organizer@arrowbrooke-map.invalid')
with check (
  (select auth.jwt() ->> 'email') = 'organizer@arrowbrooke-map.invalid'
  and created_by = (select auth.uid())
);

-- Edge Functions use this RPC to remove delivery endpoints that Apple reports
-- as expired. It is unavailable to browsers and runs only with an elevated
-- server credential.
create or replace function public.remove_expired_push_subscription(target_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = target_endpoint;
$$;
revoke all on function public.remove_expired_push_subscription(text) from public, anon, authenticated;
grant execute on function public.remove_expired_push_subscription(text) to service_role;
