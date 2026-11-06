-- =====================================================================
-- DEVELOPMENT DEMO DATA — never run against production.
-- Adds sample contributions, roadmap actions and 2027 BD rows to
-- WOB Corporate Solutions and WOB Government Advisory so you can see the
-- dashboards and Executive View populated. Every demo row uses a request
-- id starting with de000000-, so supabase/reset-demo.sql removes exactly
-- these. Requires at least one active member (bootstrap an admin first).
-- Survey answers are NOT seeded, so ratings and rankings stay real.
-- =====================================================================
do $$
declare
  a uuid;
  u record;
  ui int := 0;
  i int;
  r record;
  rid uuid;
begin
  select user_id into a from public.workspace_memberships
   where status = 'active' and role in ('admin', 'participant') order by created_at limit 1;
  if a is null then raise exception 'Create and approve at least one member first.'; end if;

  for u in select * from public.business_units where slug in ('corporate-solutions', 'government-advisory') order by sort loop
    ui := ui + 1;
    i := 0;
    for r in select * from (values
      ('honest_working', 'We show up for clients when it matters most', '', null::text, false),
      ('honest_unsaid',  'We say yes to work we are not staffed for', 'It burns people out and we rarely talk about it.', null, true),
      ('barriers', 'Approvals take weeks for routine decisions', 'Small purchases wait on three sign-offs.', 'leadership_decisions', false),
      ('barriers', 'Too many disconnected tools', 'We re-enter the same data in four places.', 'process_systems', false),
      ('known_for', 'The team clients call first in a crisis', '', null, false),
      ('grow', 'Packaged training for existing clients', '', 'existing_clients', false),
      ('expectations', 'Share decisions and the reasons behind them within a week', '', 'from_leadership', false)
    ) as t(board, title, body, cat, anon) loop
      i := i + 1;
      insert into public.contributions (unit_id, dashboard, board, title, body, category_id, is_anonymous, author_id, client_request_id)
      select u.id, bo.dashboard, r.board, r.title, r.body,
             (select id from public.categories c where c.board = r.board and c.key = r.cat),
             r.anon, case when r.anon then null else a end,
             ('de000000-0000-0000-00' || lpad(ui::text, 2, '0') || '-' || lpad(i::text, 12, '0'))::uuid
      from public.boards bo where bo.key = r.board;
    end loop;

    insert into public.roadmap_items (unit_id, title, timeframe, status, target_outcome, created_by, client_request_id) values
      (u.id, 'Set a 48-hour rule for routine approvals', 60, 'agreed', 'Routine decisions made within two days', a,
       ('de000000-0000-0000-00' || lpad(ui::text, 2, '0') || '-000000000101')::uuid),
      (u.id, 'Choose one system of record for project data', 90, 'suggested', 'No double entry', a,
       ('de000000-0000-0000-00' || lpad(ui::text, 2, '0') || '-000000000102')::uuid);

    i := 200;
    for r in select * from (values
      ('client', 'grow', 'State Department of Emergency Services', 'high', 400000, 650000),
      ('client', 'retain', 'Gulf Coast Energy Partners', 'medium', 250000, 260000),
      ('client', 'surrender', 'Legacy facilities contract', 'low', 40000, null::numeric),
      ('association', 'member', 'International Association of Emergency Managers', 'medium', 6000, 6000),
      ('conference', 'booth', 'National Hurricane Conference', 'high', 18000, 22000)
    ) as t(kind, category, name, priority, v26, v27) loop
      i := i + 1;
      insert into public.bd_items (unit_id, kind, category, name, owner_id, priority, value_2026, value_2027, created_by, updated_by, client_request_id, details)
      values (u.id, r.kind, r.category, r.name, a, r.priority, r.v26, r.v27, a, a,
              ('de000000-0000-0000-00' || lpad(ui::text, 2, '0') || '-' || lpad(i::text, 12, '0'))::uuid,
              case when r.kind = 'client' then jsonb_build_object('rationale', 'Demo: strong fit with 2027 priorities.') else '{}'::jsonb end);
    end loop;

    update public.contributions set nominated_at = now()
     where unit_id = u.id and client_request_id::text like 'de000000-%' and board in ('barriers', 'grow');
  end loop;
end $$;
