-- Run once to replace the former Decorations category with Non-Food Treats.
begin;

alter table public.stops drop constraint if exists stops_categories_check;

update public.stops
set categories = array_replace(categories, 'decor', 'nonfood')
where categories @> array['decor']::text[];

alter table public.stops add constraint stops_categories_check check (
  cardinality(categories) between 1 and 3 and
  categories <@ array['candy','nonfood','adult']::text[] and
  array_position(categories, null) is null
);

commit;
