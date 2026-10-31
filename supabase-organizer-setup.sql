-- Run once after creating and confirming the dedicated organizer Auth user.
-- The public website never receives elevated database keys; organizer access is
-- granted only when Supabase verifies this exact account and its password.

grant update (title, notes, categories, approval_status) on public.stops to authenticated;

drop policy if exists "Organizer can edit Halloween stops" on public.stops;
create policy "Organizer can edit Halloween stops" on public.stops
for update to authenticated
using ((select auth.jwt() ->> 'email') = 'organizer@arrowbrooke-map.invalid')
with check ((select auth.jwt() ->> 'email') = 'organizer@arrowbrooke-map.invalid');

drop policy if exists "Organizer can remove Halloween stops" on public.stops;
create policy "Organizer can remove Halloween stops" on public.stops
for delete to authenticated
using ((select auth.jwt() ->> 'email') = 'organizer@arrowbrooke-map.invalid');
