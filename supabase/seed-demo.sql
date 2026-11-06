-- =====================================================================
-- DEVELOPMENT DEMO DATA — never run against production.
-- Adds sample contributions authored by the first active members so you
-- can see the dashboards populated. Every demo row uses a request id that
-- starts with de000000-, so supabase/reset-demo.sql removes exactly these.
-- Requires at least one active member (run after bootstrapping an admin).
-- Survey answers are NOT seeded, so aggregates stay real.
-- =====================================================================
do $$
declare
  people uuid[];
  a uuid; b uuid;
  i int := 0;
  cat_barrier uuid; cat_grow uuid; cat_exp uuid;
  r record;
begin
  select array_agg(user_id order by created_at) into people
    from public.workspace_memberships where status = 'active' and role in ('admin', 'participant');
  if people is null then raise exception 'Create and approve at least one member first.'; end if;
  a := people[1]; b := coalesce(people[2], people[1]);

  for r in select * from (values
    ('honest_working', 'We show up for clients when it matters most', '', null::text, false),
    ('honest_working', 'People cover for each other without being asked', '', null, false),
    ('honest_unsaid',  'We say yes to work we are not staffed for', 'It burns people out and we rarely talk about it.', null, true),
    ('barriers', 'Approvals take weeks for routine decisions', 'Small purchases wait on three sign-offs.', 'leadership_decisions', false),
    ('barriers', 'Too many disconnected tools', 'We re-enter the same data in four places.', 'process_systems', false),
    ('barriers', 'Hiring takes too long', '', 'people_staffing', true),
    ('known_for', 'The team clients call first in a crisis', '', null, false),
    ('grow', 'Recovery planning for mid-size cities', 'Strong fit with what we already do well.', 'new_markets', false),
    ('grow', 'Packaged training for existing clients', '', 'existing_clients', false),
    ('expectations', 'Share decisions and the reasons behind them within a week', '', 'from_leadership', false)
  ) as t(board, title, body, cat, anon) loop
    i := i + 1;
    insert into public.contributions (dashboard, board, title, body, category_id, is_anonymous, author_id, client_request_id, details)
    select bo.dashboard, r.board, r.title, r.body,
           (select id from public.categories c where c.board = r.board and c.key = r.cat),
           r.anon, case when r.anon then null when i % 2 = 0 then b else a end,
           ('de000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
           case when r.board = 'grow' and i = 8 then jsonb_build_object(
             'interesting', 'Few competitors serve this size of city.',
             'going_for_us', 'We have done this work informally for years.') else '{}'::jsonb end
    from public.boards bo where bo.key = r.board;
  end loop;

  insert into public.roadmap_items (title, description, timeframe, status, target_outcome, created_by, client_request_id)
  values
    ('Set a 48-hour rule for routine approvals', '', 60, 'discussing', 'Routine decisions made within two days', a, 'de000000-0000-0000-0000-000000000101'),
    ('Choose one system of record for project data', '', 90, 'suggested', 'No double entry', b, 'de000000-0000-0000-0000-000000000102'),
    ('Pilot a city recovery-planning offer', '', 120, 'suggested', 'One signed pilot client', a, 'de000000-0000-0000-0000-000000000103');

  insert into public.contribution_links (from_contribution_id, to_roadmap_id, created_by)
  select c.id, ri.id, a from public.contributions c, public.roadmap_items ri
   where c.client_request_id = 'de000000-0000-0000-0000-000000000004'
     and ri.client_request_id = 'de000000-0000-0000-0000-000000000101'
  on conflict do nothing;

  update public.contributions set nominated_at = now()
   where client_request_id in ('de000000-0000-0000-0000-000000000004', 'de000000-0000-0000-0000-000000000008');
end $$;
