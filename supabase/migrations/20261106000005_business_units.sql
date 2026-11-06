-- =====================================================================
-- 0005 — Business units, cross-cutting access, Executive View, and
--        2027 Business Development planning.
-- =====================================================================
-- Safe to run on an existing database: existing content is assigned to
-- WOB Corporate Solutions, and existing administrators become
-- cross-cutting. Run once, after 0001–0004.
--
-- Access model
--   * Every piece of content belongs to exactly one business unit.
--   * A member sees a unit only if assigned to it (unit_memberships), or
--     is cross-cutting (workspace_memberships.all_units) or an admin.
--   * Survey answers are given per unit, by people assigned to that unit.
--   * Segment roll-ups (Corporate vs Government) include only units that
--     meet the privacy threshold, so a suppressed unit can't be inferred
--     by subtraction.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Units and assignments
-- ---------------------------------------------------------------------
create table public.business_units (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null default public.default_workspace_id() references public.workspaces(id) on delete cascade,
  slug          text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  short_name    text not null check (char_length(btrim(short_name)) between 1 and 40),
  segment       text not null check (segment in ('corporate', 'government')),
  sort          smallint not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

insert into public.business_units (slug, name, short_name, segment, sort) values
  ('corporate-solutions',  'WOB Corporate Solutions',                       'Corporate Solutions',    'corporate',  1),
  ('government-advisory',  'WOB Government Advisory',                       'Government Advisory',    'government', 2),
  ('emergency-management', 'WOB Emergency Management & Disaster Recovery',  'EM & Disaster Recovery', 'government', 3),
  ('caribe',               'WOB Caribe (USVI/PR)',                          'Caribe (USVI/PR)',       'government', 4),
  ('wob-admin',            'WOB Admin',                                     'WOB Admin',              'government', 5);

create table public.unit_memberships (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  unit_id     uuid not null references public.business_units(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, unit_id)
);
create index unit_memberships_unit_idx on public.unit_memberships (unit_id);

alter table public.workspace_memberships add column all_units boolean not null default false;
update public.workspace_memberships set all_units = true where role = 'admin';

alter table public.registration_requests
  add column requested_unit_id uuid references public.business_units(id) on delete set null;
alter table public.invitations
  add column unit_ids uuid[] not null default '{}';

-- ---------------------------------------------------------------------
-- unit_id on all unit-scoped content (existing rows → Corporate Solutions)
-- ---------------------------------------------------------------------
do $$
declare v uuid; t text;
begin
  select id into v from public.business_units where slug = 'corporate-solutions';
  foreach t in array array['contributions', 'roadmap_items', 'contribution_comments', 'contribution_links',
                           'activity_events', 'health_ratings', 'priority_rankings', 'priority_experience_ratings'] loop
    execute format('alter table public.%I add column unit_id uuid references public.business_units(id) on delete cascade', t);
    execute format('update public.%I set unit_id = $1', t) using v;
    execute format('alter table public.%I alter column unit_id set not null', t);
  end loop;
  -- Existing members keep access to the content they already have.
  insert into public.unit_memberships (user_id, unit_id)
  select user_id, v from public.workspace_memberships where status in ('active', 'pending', 'suspended')
  on conflict do nothing;
end $$;

create index contributions_unit_board_idx on public.contributions (unit_id, board, created_at desc);
create index roadmap_items_unit_idx on public.roadmap_items (unit_id);
create index activity_events_unit_idx on public.activity_events (unit_id, created_at desc);
create index comments_unit_idx on public.contribution_comments (unit_id);

-- Survey answers are per person, per unit.
alter table public.health_ratings drop constraint health_ratings_pkey;
alter table public.health_ratings add primary key (user_id, unit_id, category_id);
alter table public.priority_rankings drop constraint one_factor_per_rank;
alter table public.priority_rankings drop constraint priority_rankings_pkey;
alter table public.priority_rankings add primary key (user_id, unit_id, factor_id);
alter table public.priority_rankings
  add constraint one_factor_per_rank unique (user_id, unit_id, rank) deferrable initially deferred;
alter table public.priority_experience_ratings drop constraint priority_experience_ratings_pkey;
alter table public.priority_experience_ratings add primary key (user_id, unit_id, factor_id);

-- ---------------------------------------------------------------------
-- 2027 Business Development planning
-- ---------------------------------------------------------------------
create table public.bd_items (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null default public.default_workspace_id() references public.workspaces(id) on delete cascade,
  unit_id            uuid not null references public.business_units(id) on delete cascade,
  kind               text not null check (kind in ('client', 'association', 'conference')),
  category           text not null,
  name               text not null check (char_length(btrim(name)) between 1 and 200),
  owner_id           uuid references public.profiles(id) on delete set null,
  status             text not null default 'proposed'
                       check (status in ('proposed', 'committed', 'in_progress', 'done', 'dropped')),
  priority           text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  value_2026         numeric(14, 2) check (value_2026 is null or value_2026 >= 0),
  value_2027         numeric(14, 2) check (value_2027 is null or value_2027 >= 0),
  key_date           date,
  details            jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_by         uuid references public.profiles(id) on delete set null,
  updated_by         uuid references public.profiles(id) on delete set null,
  client_request_id  uuid unique,
  comment_count      integer not null default 0,
  version            integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint bd_category_fits_kind check (
       (kind = 'client'      and category in ('retain', 'grow', 'surrender'))
    or (kind = 'association' and category in ('member', 'sponsor', 'partnership'))
    or (kind = 'conference'  and category in ('attend', 'booth', 'sponsor')))
);
create index bd_items_unit_idx on public.bd_items (unit_id, kind, created_at);

-- Comments can also belong to a BD item.
alter table public.contribution_comments
  add column bd_item_id uuid references public.bd_items(id) on delete cascade;
alter table public.contribution_comments drop constraint comment_has_one_parent;
alter table public.contribution_comments add constraint comment_has_one_parent
  check (num_nonnulls(contribution_id, roadmap_item_id, bd_item_id) = 1);
create index comments_bd_idx on public.contribution_comments (bd_item_id, created_at);

create or replace function public.tg_comment_counts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_delta int;
begin
  if tg_op = 'INSERT' then
    v_delta := case when new.hidden then 0 else 1 end;
  elsif tg_op = 'DELETE' then
    v_delta := case when old.hidden then 0 else -1 end;
  else
    v_delta := (case when new.hidden then 0 else 1 end) - (case when old.hidden then 0 else 1 end);
  end if;
  if v_delta = 0 and tg_op <> 'INSERT' then return null; end if;

  if coalesce(new.contribution_id, old.contribution_id) is not null then
    update public.contributions c set
      comment_count = c.comment_count + v_delta,
      last_activity_at = now(),
      status = case when tg_op = 'INSERT' and c.status = 'open' then 'discussing' else c.status end
    where c.id = coalesce(new.contribution_id, old.contribution_id);
  elsif coalesce(new.roadmap_item_id, old.roadmap_item_id) is not null then
    update public.roadmap_items r set comment_count = r.comment_count + v_delta, updated_at = now()
    where r.id = coalesce(new.roadmap_item_id, old.roadmap_item_id);
  else
    update public.bd_items b set comment_count = b.comment_count + v_delta
    where b.id = coalesce(new.bd_item_id, old.bd_item_id);
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------
create or replace function public.has_all_units()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select m.all_units or m.role = 'admin'
                     from public.workspace_memberships m
                    where m.user_id = auth.uid() and m.status = 'active'
                      and m.workspace_id = public.default_workspace_id()), false)
$$;

create or replace function public.can_see_unit(p_unit uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_member()
     and exists (select 1 from public.business_units b where b.id = p_unit)
     and (public.has_all_units()
          or exists (select 1 from public.unit_memberships um
                      where um.user_id = auth.uid() and um.unit_id = p_unit))
$$;

-- Assigned to the unit (survey answers are given only by assigned members).
create or replace function public.is_unit_member(p_unit uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_member()
     and exists (select 1 from public.unit_memberships um where um.user_id = auth.uid() and um.unit_id = p_unit)
$$;

create or replace function public.require_unit_contributor(p_unit uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid := public.require_contributor();
begin
  if p_unit is null or not public.can_see_unit(p_unit) then
    raise exception 'You don''t have access to that business unit.' using errcode = 'LC403';
  end if;
  return v;
end $$;

-- Readers of unit-scoped summaries: LC401 when not an active member (so the
-- app re-checks the session), LC403 when the unit isn't theirs.
create or replace function public.require_unit_viewer(p_unit uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_active_member() then
    raise exception 'Your account is not active in this workspace.' using errcode = 'LC401';
  end if;
  if p_unit is null or not public.can_see_unit(p_unit) then
    raise exception 'You don''t have access to that business unit.' using errcode = 'LC403';
  end if;
end $$;

-- Who may be shown to the caller: people who share a unit, cross-cutting
-- people, and everyone for cross-cutting viewers.
create or replace function public.profile_visible(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_member() and public.is_listed_member(p_user) and (
       p_user = auth.uid()
    or public.has_all_units()
    or exists (select 1 from public.workspace_memberships m
                where m.user_id = p_user and (m.all_units or m.role = 'admin'))
    or exists (select 1 from public.unit_memberships a
                 join public.unit_memberships b on b.unit_id = a.unit_id
                where a.user_id = auth.uid() and b.user_id = p_user))
$$;

-- Realtime topic 'unit:<uuid>' → caller must be able to see that unit.
create or replace function public.can_join_topic(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if p_topic !~ '^unit:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.can_see_unit(substr(p_topic, 6)::uuid);
end $$;

create or replace function public.log_activity(p_actor uuid, p_unit uuid, p_type text, p_dashboard smallint,
                                               p_entity_type text, p_entity_id uuid, p_summary text)
returns void language sql security definer set search_path = '' as $$
  insert into public.activity_events (actor_id, unit_id, event_type, dashboard, entity_type, entity_id, summary)
  values (p_actor, p_unit, p_type, p_dashboard, p_entity_type, p_entity_id, left(p_summary, 300))
$$;
drop function if exists public.log_activity(uuid, text, smallint, text, uuid, text);

create or replace function public.get_unit_members(p_unit uuid)
returns table (id uuid, username text, display_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_unit_viewer(p_unit);
  return query
  select p.id, p.username, p.display_name
    from public.profiles p join public.workspace_memberships m on m.user_id = p.id
   where m.status = 'active' and m.role in ('admin', 'participant')
     and (m.all_units or exists (select 1 from public.unit_memberships um where um.user_id = p.id and um.unit_id = p_unit))
   order by lower(p.username);
end $$;

-- ---------------------------------------------------------------------
-- Contributions (redefined with unit checks)
-- ---------------------------------------------------------------------
drop function if exists public.create_contribution(text, text, text, uuid, jsonb, boolean, uuid);
create function public.create_contribution(
  p_unit_id uuid,
  p_board text,
  p_title text,
  p_body text default '',
  p_category_id uuid default null,
  p_details jsonb default '{}'::jsonb,
  p_anonymous boolean default false,
  p_client_request_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_unit_contributor(p_unit_id);
  v_board public.boards;
  v_id uuid;
  v_anon boolean := coalesce(p_anonymous, false);
begin
  if p_client_request_id is not null then
    select id into v_id from public.contributions where client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  select * into v_board from public.boards where key = p_board;
  if not found then raise exception 'Unknown board.' using errcode = 'LC422'; end if;
  if v_anon and (not v_board.allows_anonymous or not coalesce(
       (select allow_anonymous from public.workspace_settings where workspace_id = public.default_workspace_id()), false)) then
    raise exception 'Anonymous sharing is not available here.' using errcode = 'LC403';
  end if;
  if p_category_id is not null and not exists (
       select 1 from public.categories c where c.id = p_category_id and c.board = p_board and c.active) then
    raise exception 'That category does not belong to this board.' using errcode = 'LC422';
  end if;

  insert into public.contributions (unit_id, dashboard, board, title, body, category_id, details,
                                    is_anonymous, author_id, client_request_id)
  values (p_unit_id, v_board.dashboard, p_board,
          public.clean_text(p_title, 200, true, 'Title'),
          public.clean_text(p_body, 4000, false, 'Details'),
          p_category_id, public.clean_details(p_details),
          v_anon, case when v_anon then null else v_uid end, p_client_request_id)
  returning id into v_id;

  perform public.log_activity(case when v_anon then null else v_uid end, p_unit_id, 'contribution_created',
          v_board.dashboard, 'contribution', v_id,
          case when v_anon then 'An anonymous thought was shared' else 'shared a new thought' end);
  return v_id;
end $$;

create or replace function public.update_contribution(
  p_id uuid, p_expected_version integer, p_title text, p_body text,
  p_category_id uuid default null, p_details jsonb default '{}'::jsonb
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_contributor();
  v_row public.contributions;
begin
  select * into v_row from public.contributions where id = p_id for update;
  if not found or not public.can_see_unit(v_row.unit_id) then raise exception 'Not found.' using errcode = 'LC404'; end if;
  if v_row.author_id is distinct from v_uid then
    raise exception 'You can only edit your own contributions.' using errcode = 'LC403';
  end if;
  if v_row.version <> p_expected_version then
    raise exception 'Someone else changed this while you were editing. Please review the latest version.'
      using errcode = 'LC409';
  end if;
  if p_category_id is not null and not exists (
       select 1 from public.categories c where c.id = p_category_id and c.board = v_row.board) then
    raise exception 'That category does not belong to this board.' using errcode = 'LC422';
  end if;
  update public.contributions set
    title = public.clean_text(p_title, 200, true, 'Title'),
    body = public.clean_text(p_body, 4000, false, 'Details'),
    category_id = p_category_id,
    details = public.clean_details(p_details),
    version = version + 1, updated_at = now(), last_activity_at = now()
  where id = p_id;
  return v_row.version + 1;
end $$;

create or replace function public.delete_contribution(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_row public.contributions;
begin
  select * into v_row from public.contributions where id = p_id;
  if not found or not public.can_see_unit(v_row.unit_id) then raise exception 'Not found.' using errcode = 'LC404'; end if;
  if v_row.author_id is distinct from v_uid and not public.is_admin() then
    raise exception 'You can only remove your own contributions.' using errcode = 'LC403';
  end if;
  delete from public.contributions where id = p_id;
  if public.is_admin() and v_row.author_id is distinct from v_uid then
    perform public.audit('content.delete', 'contribution', p_id::text, jsonb_build_object('board', v_row.board));
  end if;
end $$;

create or replace function public.set_contribution_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_row public.contributions;
begin
  select * into v_row from public.contributions where id = p_id;
  if not found or not public.can_see_unit(v_row.unit_id) or (v_row.hidden and not public.is_admin()) then
    raise exception 'Not found.' using errcode = 'LC404';
  end if;
  if p_status not in ('open', 'discussing', 'addressed', 'commitment') then
    raise exception 'Unknown status.' using errcode = 'LC422';
  end if;
  if p_status = 'commitment' then
    if not public.is_admin() then
      raise exception 'Only an administrator can confirm a shared commitment.' using errcode = 'LC403';
    end if;
  elsif v_row.author_id is distinct from v_uid and not public.is_admin() then
    raise exception 'Only the author or an administrator can change the status.' using errcode = 'LC403';
  end if;
  update public.contributions set status = p_status, last_activity_at = now() where id = p_id;
  if public.is_admin() then
    perform public.audit('content.status', 'contribution', p_id::text, jsonb_build_object('status', p_status));
  end if;
end $$;

create or replace function public.toggle_reaction(p_contribution_id uuid, p_kind text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_contributor();
  v_row public.contributions;
begin
  if p_kind not in ('resonates', 'support', 'top') then
    raise exception 'Unknown reaction.' using errcode = 'LC422';
  end if;
  select * into v_row from public.contributions where id = p_contribution_id;
  if not found or v_row.hidden or v_row.archived or not public.can_see_unit(v_row.unit_id) then
    raise exception 'Not found.' using errcode = 'LC404';
  end if;
  delete from public.contribution_reactions
   where contribution_id = p_contribution_id and user_id = v_uid and kind = p_kind;
  if found then return false; end if;
  if p_kind = 'top' and (
      select count(*) from public.contribution_reactions r
      join public.contributions c on c.id = r.contribution_id
      where r.user_id = v_uid and r.kind = 'top' and c.board = v_row.board and c.unit_id = v_row.unit_id) >= 3 then
    raise exception 'You can mark up to three issues as most significant. Unmark one first.' using errcode = 'LC429';
  end if;
  insert into public.contribution_reactions (contribution_id, user_id, kind)
  values (p_contribution_id, v_uid, p_kind) on conflict do nothing;
  return true;
end $$;

create or replace function public.set_focus_nomination(p_id uuid, p_nominated boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_row public.contributions;
begin
  select * into v_row from public.contributions where id = p_id;
  if not found or v_row.hidden or not public.can_see_unit(v_row.unit_id) then
    raise exception 'Not found.' using errcode = 'LC404';
  end if;
  if not p_nominated and not public.is_admin() then
    raise exception 'Only an administrator can remove an item from the focus list.' using errcode = 'LC403';
  end if;
  update public.contributions
     set nominated_at = case when p_nominated then coalesce(nominated_at, now()) else null end,
         last_activity_at = now()
   where id = p_id;
  if p_nominated and v_row.nominated_at is null then
    perform public.log_activity(v_uid, v_row.unit_id, 'focus_nominated', 5::smallint, 'contribution', p_id,
                                'suggested a focus: ' || v_row.title);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Comments (contribution, roadmap item, or BD item)
-- ---------------------------------------------------------------------
drop function if exists public.add_comment(uuid, uuid, text, text, uuid);
create function public.add_comment(
  p_contribution_id uuid, p_roadmap_item_id uuid, p_body text,
  p_kind text default 'comment', p_client_request_id uuid default null, p_bd_item_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_contributor();
  v_id uuid; v_dash smallint; v_title text; v_unit uuid; v_entity text;
begin
  if p_client_request_id is not null then
    select id into v_id from public.contribution_comments where client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  if num_nonnulls(p_contribution_id, p_roadmap_item_id, p_bd_item_id) <> 1 then
    raise exception 'A comment needs exactly one parent.' using errcode = 'LC422';
  end if;
  if p_kind not in ('comment', 'solution') then
    raise exception 'Unknown comment type.' using errcode = 'LC422';
  end if;
  if p_contribution_id is not null then
    select dashboard, title, unit_id into v_dash, v_title, v_unit from public.contributions
     where id = p_contribution_id and not hidden and not archived;
    v_entity := 'contribution';
  elsif p_roadmap_item_id is not null then
    select 5::smallint, title, unit_id into v_dash, v_title, v_unit from public.roadmap_items
     where id = p_roadmap_item_id and not hidden and not archived;
    v_entity := 'roadmap_item';
  else
    select null::smallint, name, unit_id into v_dash, v_title, v_unit from public.bd_items where id = p_bd_item_id;
    v_entity := 'bd_item';
  end if;
  if v_unit is null or not public.can_see_unit(v_unit) then raise exception 'Not found.' using errcode = 'LC404'; end if;

  insert into public.contribution_comments (unit_id, contribution_id, roadmap_item_id, bd_item_id, author_id, kind, body, client_request_id)
  values (v_unit, p_contribution_id, p_roadmap_item_id, p_bd_item_id, v_uid, p_kind,
          public.clean_text(p_body, 4000, true, 'Comment'), p_client_request_id)
  returning id into v_id;

  perform public.log_activity(v_uid, v_unit, 'comment_added', v_dash, v_entity,
          coalesce(p_contribution_id, p_roadmap_item_id, p_bd_item_id),
          case when p_kind = 'solution' then 'suggested a solution on: ' else 'commented on: ' end || v_title);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Links (both ends must be in the same unit)
-- ---------------------------------------------------------------------
create or replace function public.item_unit(p_kind text, p_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'contribution' then (select unit_id from public.contributions where id = p_id and not hidden)
    when 'roadmap'      then (select unit_id from public.roadmap_items where id = p_id and not hidden)
  end
$$;

create or replace function public.item_is_visible(p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.can_see_unit(public.item_unit(p_kind, p_id)), false)
$$;

create or replace function public.create_link(p_from_kind text, p_from_id uuid, p_to_kind text, p_to_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_id uuid; u1 uuid; u2 uuid;
begin
  u1 := public.item_unit(p_from_kind, p_from_id);
  u2 := public.item_unit(p_to_kind, p_to_id);
  if u1 is null or u2 is null or not public.can_see_unit(u1) or not public.can_see_unit(u2) then
    raise exception 'Not found.' using errcode = 'LC404';
  end if;
  if u1 <> u2 then
    raise exception 'Items can only be connected within the same business unit.' using errcode = 'LC422';
  end if;
  insert into public.contribution_links (unit_id, from_contribution_id, from_roadmap_id, to_contribution_id, to_roadmap_id, created_by)
  values (u1,
          case when p_from_kind = 'contribution' then p_from_id end,
          case when p_from_kind = 'roadmap' then p_from_id end,
          case when p_to_kind = 'contribution' then p_to_id end,
          case when p_to_kind = 'roadmap' then p_to_id end,
          v_uid)
  on conflict (pair_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.get_related(p_kind text, p_id uuid)
returns table (link_id uuid, kind text, id uuid, title text, dashboard smallint, board text, status text)
language sql stable security definer set search_path = '' as $$
  with me as (select case when p_kind = 'roadmap' then 'r:' else 'c:' end || p_id::text as k),
  l as (
    select cl.*,
      case when coalesce('c:' || cl.from_contribution_id::text, 'r:' || cl.from_roadmap_id::text) = (select k from me)
           then coalesce('c:' || cl.to_contribution_id::text, 'r:' || cl.to_roadmap_id::text)
           else coalesce('c:' || cl.from_contribution_id::text, 'r:' || cl.from_roadmap_id::text) end as other
    from public.contribution_links cl
    where public.can_see_unit(cl.unit_id)
      and (select k from me) in (coalesce('c:' || cl.from_contribution_id::text, 'r:' || cl.from_roadmap_id::text),
                                 coalesce('c:' || cl.to_contribution_id::text,   'r:' || cl.to_roadmap_id::text))
  )
  select l.id, 'contribution', c.id, c.title, c.dashboard, c.board, c.status
    from l join public.contributions c on 'c:' || c.id::text = l.other
   where not c.hidden
  union all
  select l.id, 'roadmap', r.id, r.title, 5::smallint, 'roadmap', r.status
    from l join public.roadmap_items r on 'r:' || r.id::text = l.other
   where not r.hidden
$$;

create or replace function public.delete_link(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor();
begin
  delete from public.contribution_links
   where id = p_id and public.can_see_unit(unit_id) and (created_by = v_uid or public.is_admin());
  if not found then raise exception 'You can only remove links you created.' using errcode = 'LC403'; end if;
end $$;

create or replace function public.report_content(p_contribution_id uuid, p_comment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_unit uuid;
begin
  if auth.uid() is null or not public.is_active_member() then
    raise exception 'Your account is not active in this workspace.' using errcode = 'LC401';
  end if;
  v_unit := coalesce((select unit_id from public.contributions where id = p_contribution_id),
                     (select unit_id from public.contribution_comments where id = p_comment_id));
  if v_unit is null or not public.can_see_unit(v_unit) then raise exception 'Not found.' using errcode = 'LC404'; end if;
  insert into public.content_reports (contribution_id, comment_id, reporter_id, reason)
  values (p_contribution_id, p_comment_id, auth.uid(), public.clean_text(p_reason, 1000, true, 'Reason'));
end $$;

-- ---------------------------------------------------------------------
-- Roadmap
-- ---------------------------------------------------------------------
drop function if exists public.create_roadmap_item(text, text, smallint, text, date, uuid, uuid);
create function public.create_roadmap_item(
  p_unit_id uuid, p_title text, p_description text, p_timeframe smallint, p_target_outcome text default '',
  p_target_date date default null, p_related_contribution_id uuid default null,
  p_client_request_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_unit_contributor(p_unit_id); v_id uuid;
begin
  if p_client_request_id is not null then
    select id into v_id from public.roadmap_items where client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  if p_timeframe not in (60, 90, 120) then
    raise exception 'Timeframe must be 60, 90, or 120 days.' using errcode = 'LC422';
  end if;
  if p_related_contribution_id is not null
     and public.item_unit('contribution', p_related_contribution_id) is distinct from p_unit_id then
    raise exception 'Related item not found in this business unit.' using errcode = 'LC404';
  end if;
  insert into public.roadmap_items (unit_id, title, description, timeframe, target_outcome, target_date, created_by, client_request_id)
  values (p_unit_id, public.clean_text(p_title, 200, true, 'Title'),
          public.clean_text(p_description, 4000, false, 'Description'),
          p_timeframe, public.clean_text(p_target_outcome, 1000, false, 'Target outcome'),
          p_target_date, v_uid, p_client_request_id)
  returning id into v_id;
  if p_related_contribution_id is not null then
    insert into public.contribution_links (unit_id, from_roadmap_id, to_contribution_id, created_by)
    values (p_unit_id, v_id, p_related_contribution_id, v_uid) on conflict (pair_key) do nothing;
  end if;
  perform public.log_activity(v_uid, p_unit_id, 'roadmap_created', 5::smallint, 'roadmap_item', v_id,
                              'suggested a next step: ' || p_title);
  return v_id;
end $$;

create or replace function public.update_roadmap_item(
  p_id uuid, p_expected_version integer, p_title text, p_description text,
  p_timeframe smallint, p_target_outcome text, p_target_date date
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_row public.roadmap_items;
begin
  select * into v_row from public.roadmap_items where id = p_id for update;
  if not found or not public.can_see_unit(v_row.unit_id) then raise exception 'Not found.' using errcode = 'LC404'; end if;
  if not (v_row.created_by = v_uid or public.can_manage_roadmap_item(v_row)) then
    raise exception 'Only the person who suggested this, its owner, or an administrator can edit it.' using errcode = 'LC403';
  end if;
  if v_row.version <> p_expected_version then
    raise exception 'Someone else changed this while you were editing. Please review the latest version.' using errcode = 'LC409';
  end if;
  if p_timeframe not in (60, 90, 120) then
    raise exception 'Timeframe must be 60, 90, or 120 days.' using errcode = 'LC422';
  end if;
  update public.roadmap_items set
    title = public.clean_text(p_title, 200, true, 'Title'),
    description = public.clean_text(p_description, 4000, false, 'Description'),
    timeframe = p_timeframe,
    target_outcome = public.clean_text(p_target_outcome, 1000, false, 'Target outcome'),
    target_date = p_target_date, version = version + 1, updated_at = now()
  where id = p_id;
  return v_row.version + 1;
end $$;

create or replace function public.set_roadmap_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_row public.roadmap_items;
begin
  select * into v_row from public.roadmap_items where id = p_id;
  if not found or v_row.hidden or not public.can_see_unit(v_row.unit_id) then
    raise exception 'Not found.' using errcode = 'LC404';
  end if;
  if p_status not in ('suggested', 'discussing', 'agreed', 'in_progress', 'completed') then
    raise exception 'Unknown status.' using errcode = 'LC422';
  end if;
  if p_status in ('agreed', 'in_progress', 'completed') and not public.can_manage_roadmap_item(v_row) then
    raise exception 'Only an administrator or the initiative owner can mark this %.', replace(p_status, '_', ' ') using errcode = 'LC403';
  end if;
  if p_status in ('suggested', 'discussing') and v_row.status in ('agreed', 'in_progress', 'completed')
     and not public.can_manage_roadmap_item(v_row) then
    raise exception 'Only an administrator or the initiative owner can reopen this.' using errcode = 'LC403';
  end if;
  update public.roadmap_items set status = p_status, updated_at = now() where id = p_id;
  perform public.log_activity(v_uid, v_row.unit_id, 'roadmap_status', 5::smallint, 'roadmap_item', p_id,
                              'moved "' || v_row.title || '" to ' || replace(p_status, '_', ' '));
  if public.is_admin() then
    perform public.audit('roadmap.status', 'roadmap_item', p_id::text, jsonb_build_object('status', p_status));
  end if;
end $$;

create or replace function public.unit_contributor_ok(p_user uuid, p_unit uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_memberships m
                  where m.user_id = p_user and m.status = 'active' and m.role in ('admin', 'participant')
                    and (m.all_units or exists (select 1 from public.unit_memberships um
                                                 where um.user_id = p_user and um.unit_id = p_unit)))
$$;

create or replace function public.set_roadmap_owner(p_id uuid, p_owner_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_unit uuid;
begin
  perform public.require_admin();
  select unit_id into v_unit from public.roadmap_items where id = p_id;
  if v_unit is null then raise exception 'Not found.' using errcode = 'LC404'; end if;
  if p_owner_id is not null and not public.unit_contributor_ok(p_owner_id, v_unit) then
    raise exception 'Owner must be an active participant in this business unit.' using errcode = 'LC422';
  end if;
  update public.roadmap_items set owner_id = p_owner_id, updated_at = now(), version = version + 1 where id = p_id;
  perform public.audit('roadmap.owner', 'roadmap_item', p_id::text, jsonb_build_object('owner_id', p_owner_id));
end $$;

create or replace function public.set_roadmap_volunteer(p_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_unit uuid;
begin
  select unit_id into v_unit from public.roadmap_items where id = p_id and not hidden;
  if v_unit is null or not public.can_see_unit(v_unit) then raise exception 'Not found.' using errcode = 'LC404'; end if;
  if p_role is null then
    delete from public.roadmap_contributors where item_id = p_id and user_id = v_uid;
    return;
  end if;
  if p_role not in ('helper', 'offered_to_lead') then
    raise exception 'Unknown role.' using errcode = 'LC422';
  end if;
  insert into public.roadmap_contributors (item_id, user_id, role) values (p_id, v_uid, p_role)
  on conflict (item_id, user_id) do update set role = excluded.role;
  perform public.log_activity(v_uid, v_unit, 'roadmap_volunteer', 5::smallint, 'roadmap_item', p_id,
    case when p_role = 'helper' then 'volunteered to help' else 'offered to lead' end);
end $$;

create or replace function public.delete_roadmap_item(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_row public.roadmap_items;
begin
  select * into v_row from public.roadmap_items where id = p_id;
  if not found or not public.can_see_unit(v_row.unit_id) then raise exception 'Not found.' using errcode = 'LC404'; end if;
  if not public.is_admin() and not (v_row.created_by = v_uid and v_row.status = 'suggested') then
    raise exception 'Only an administrator can remove this.' using errcode = 'LC403';
  end if;
  delete from public.roadmap_items where id = p_id;
  if public.is_admin() then perform public.audit('roadmap.delete', 'roadmap_item', p_id::text); end if;
end $$;

-- ---------------------------------------------------------------------
-- Private surveys, per unit
-- ---------------------------------------------------------------------
create or replace function public.require_unit_respondent(p_unit uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid := public.require_contributor();
begin
  if not public.is_unit_member(p_unit) then
    raise exception 'Ratings and rankings are given by people assigned to this business unit.' using errcode = 'LC403';
  end if;
  return v;
end $$;

drop function if exists public.submit_health_ratings(jsonb);
create function public.submit_health_ratings(p_unit_id uuid, p_ratings jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_unit_respondent(p_unit_id); r jsonb; v_cat uuid; v_score int;
begin
  if jsonb_typeof(p_ratings) <> 'array' or jsonb_array_length(p_ratings) = 0 then
    raise exception 'Ratings must be a non-empty list.' using errcode = 'LC422';
  end if;
  for r in select * from jsonb_array_elements(p_ratings) loop
    v_cat := (r->>'category_id')::uuid;
    v_score := (r->>'score')::int;
    if not exists (select 1 from public.health_categories where id = v_cat and active) then
      raise exception 'Unknown category.' using errcode = 'LC422';
    end if;
    if v_score is null or v_score < 1 or v_score > 10 then
      raise exception 'Scores must be between 1 and 10.' using errcode = 'LC422';
    end if;
    insert into public.health_ratings (user_id, unit_id, category_id, score, updated_at)
    values (v_uid, p_unit_id, v_cat, v_score, now())
    on conflict (user_id, unit_id, category_id) do update set score = excluded.score, updated_at = now();
  end loop;
end $$;

-- Internal (not granted): raw per-unit statistics.
create or replace function public.health_stats()
returns table (unit_id uuid, category_id uuid, n integer, total numeric, buckets integer[])
language sql stable security definer set search_path = '' as $$
  select hr.unit_id, hr.category_id, count(*)::int, sum(hr.score)::numeric, array[
           count(*) filter (where hr.score between 1 and 2)::int,
           count(*) filter (where hr.score between 3 and 4)::int,
           count(*) filter (where hr.score between 5 and 6)::int,
           count(*) filter (where hr.score between 7 and 8)::int,
           count(*) filter (where hr.score between 9 and 10)::int]
    from public.health_ratings hr
   where exists (select 1 from public.workspace_memberships m where m.user_id = hr.user_id and m.status = 'active')
   group by hr.unit_id, hr.category_id
$$;

drop function if exists public.get_health_summary();
create function public.get_health_summary(p_unit_id uuid)
returns table (category_id uuid, key text, label text, respondents integer,
               suppressed boolean, avg_score numeric, distribution integer[])
language plpgsql stable security definer set search_path = '' as $$
declare v_threshold int := public.privacy_threshold();
begin
  perform public.require_unit_viewer(p_unit_id);
  return query
  select hc.id, hc.key, hc.label, coalesce(s.n, 0),
         coalesce(s.n, 0) < v_threshold,
         case when s.n >= v_threshold then round(s.total / s.n, 1) end,
         case when s.n >= v_threshold then s.buckets end
    from public.health_categories hc
    left join public.health_stats() s on s.category_id = hc.id and s.unit_id = p_unit_id
   where hc.active
   order by hc.sort;
end $$;

drop function if exists public.submit_priority_ranking(uuid[]);
create function public.submit_priority_ranking(p_unit_id uuid, p_factor_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_unit_respondent(p_unit_id); v_active uuid[]; i int;
begin
  select array_agg(id order by id) into v_active from public.priority_factors where active;
  if p_factor_ids is null or array_length(p_factor_ids, 1) is distinct from array_length(v_active, 1)
     or (select array_agg(x order by x) from unnest(p_factor_ids) x) is distinct from v_active then
    raise exception 'Please rank every factor exactly once.' using errcode = 'LC422';
  end if;
  delete from public.priority_rankings where user_id = v_uid and unit_id = p_unit_id;
  for i in 1 .. array_length(p_factor_ids, 1) loop
    insert into public.priority_rankings (user_id, unit_id, factor_id, rank, updated_at)
    values (v_uid, p_unit_id, p_factor_ids[i], i, now());
  end loop;
end $$;

drop function if exists public.submit_experience_ratings(jsonb);
create function public.submit_experience_ratings(p_unit_id uuid, p_ratings jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_unit_respondent(p_unit_id); r jsonb; v_factor uuid; v_score int;
begin
  if jsonb_typeof(p_ratings) <> 'array' or jsonb_array_length(p_ratings) = 0 then
    raise exception 'Ratings must be a non-empty list.' using errcode = 'LC422';
  end if;
  for r in select * from jsonb_array_elements(p_ratings) loop
    v_factor := (r->>'factor_id')::uuid;
    v_score := (r->>'score')::int;
    if not exists (select 1 from public.priority_factors where id = v_factor and active) then
      raise exception 'Unknown factor.' using errcode = 'LC422';
    end if;
    if v_score is null or v_score < 1 or v_score > 5 then
      raise exception 'Scores must be between 1 and 5.' using errcode = 'LC422';
    end if;
    insert into public.priority_experience_ratings (user_id, unit_id, factor_id, score, updated_at)
    values (v_uid, p_unit_id, v_factor, v_score, now())
    on conflict (user_id, unit_id, factor_id) do update set score = excluded.score, updated_at = now();
  end loop;
end $$;

-- Internal (not granted)
create or replace function public.priority_stats()
returns table (unit_id uuid, factor_id uuid, n integer, rank_sum numeric, top3 integer, dist integer[],
               exp_n integer, exp_sum numeric)
language sql stable security definer set search_path = '' as $$
  with nf as (select count(*)::int as n from public.priority_factors where active),
  r as (select pr.* from public.priority_rankings pr
         where exists (select 1 from public.workspace_memberships m where m.user_id = pr.user_id and m.status = 'active')),
  e as (select pe.* from public.priority_experience_ratings pe
         where exists (select 1 from public.workspace_memberships m where m.user_id = pe.user_id and m.status = 'active')),
  pairs as (select distinct unit_id, factor_id from r union select distinct unit_id, factor_id from e)
  select p.unit_id, p.factor_id,
         (select count(*)::int from r where r.unit_id = p.unit_id and r.factor_id = p.factor_id),
         (select coalesce(sum(r.rank), 0)::numeric from r where r.unit_id = p.unit_id and r.factor_id = p.factor_id),
         (select count(*)::int from r where r.unit_id = p.unit_id and r.factor_id = p.factor_id and r.rank <= 3),
         array(select (select count(*)::int from r where r.unit_id = p.unit_id and r.factor_id = p.factor_id and r.rank = g)
                 from generate_series(1, (select n from nf)) g order by g),
         (select count(*)::int from e where e.unit_id = p.unit_id and e.factor_id = p.factor_id),
         (select coalesce(sum(e.score), 0)::numeric from e where e.unit_id = p.unit_id and e.factor_id = p.factor_id)
    from pairs p
$$;

drop function if exists public.get_priority_summary();
create function public.get_priority_summary(p_unit_id uuid)
returns table (factor_id uuid, key text, label text,
               rank_respondents integer, rank_suppressed boolean,
               avg_rank numeric, importance numeric, top3_count integer, rank_distribution integer[],
               experience_respondents integer, experience_suppressed boolean, avg_experience numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_threshold int := public.privacy_threshold(); v_n int;
begin
  perform public.require_unit_viewer(p_unit_id);
  select count(*) into v_n from public.priority_factors where active;
  return query
  select f.id, f.key, f.label,
         coalesce(s.n, 0), coalesce(s.n, 0) < v_threshold,
         case when s.n >= v_threshold then round(s.rank_sum / s.n, 1) end,
         case when s.n >= v_threshold and v_n > 1 then round(10 * (v_n - s.rank_sum / s.n) / (v_n - 1), 1) end,
         case when s.n >= v_threshold then s.top3 end,
         case when s.n >= v_threshold then s.dist end,
         coalesce(s.exp_n, 0), coalesce(s.exp_n, 0) < v_threshold,
         case when s.exp_n >= v_threshold then round(s.exp_sum / s.exp_n, 1) end
    from public.priority_factors f
    left join public.priority_stats() s on s.factor_id = f.id and s.unit_id = p_unit_id
   where f.active
   order by f.sort;
end $$;

drop function if exists public.get_home_summary();
create function public.get_home_summary(p_unit_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.require_unit_viewer(p_unit_id);
  select jsonb_build_object(
    'active_participants', (select count(*) from public.workspace_memberships m
                             where m.status = 'active' and m.last_seen_at > now() - interval '5 minutes'
                               and exists (select 1 from public.unit_memberships um where um.user_id = m.user_id and um.unit_id = p_unit_id)),
    'members', (select count(*) from public.unit_memberships um join public.workspace_memberships m on m.user_id = um.user_id
                 where um.unit_id = p_unit_id and m.status = 'active'),
    'contributions_by_dashboard', (select coalesce(jsonb_object_agg(dashboard, n), '{}'::jsonb) from (
        select dashboard, count(*) n from public.contributions
         where unit_id = p_unit_id and not hidden and not archived group by dashboard) d),
    'roadmap_by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
        select status, count(*) n from public.roadmap_items
         where unit_id = p_unit_id and not hidden and not archived group by status) r),
    'bd_by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (
        select kind, count(*) n from public.bd_items where unit_id = p_unit_id and status <> 'dropped' group by kind) b),
    'themes', (select coalesce(jsonb_agg(t order by t.n desc), '[]'::jsonb) from (
        select c.label, c.board, count(*) n
          from public.contributions x join public.categories c on c.id = x.category_id
         where x.unit_id = p_unit_id and not x.hidden and not x.archived
         group by c.label, c.board order by count(*) desc limit 6) t),
    'roadmap_start_date', (select roadmap_start_date from public.workspace_settings
                            where workspace_id = public.default_workspace_id())
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 2027 Business Development
-- ---------------------------------------------------------------------
create or replace function public.bd_detail_keys(p_kind text)
returns text[] language sql immutable as $$
  select case p_kind
    when 'client' then array['relationship_lead', 'key_contacts', 'relationship_health', 'current_work',
                             'contract_vehicle', 'opportunities', 'rationale', 'risks', 'competitors',
                             'strategic_fit', 'next_steps', 'next_touchpoint']
    when 'association' then array['our_reps', 'key_contacts', 'membership_level', 'benefits', 'committees',
                                  'related_events', 'rationale', 'target_clients', 'visibility_value',
                                  'next_steps', 'renewal_notes']
    when 'conference' then array['attendees', 'speakers', 'target_contacts', 'location', 'event_dates',
                                 'cost_breakdown', 'presence_plan', 'rationale', 'success_measures',
                                 'last_year', 'next_steps', 'decision_deadline']
  end
$$;

create or replace function public.clean_bd_details(p_kind text, p jsonb)
returns jsonb language plpgsql immutable as $$
declare k text; v jsonb; result jsonb := '{}'::jsonb; allowed text[] := public.bd_detail_keys(p_kind);
begin
  if p is null or p = 'null'::jsonb then return '{}'::jsonb; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'Details must be an object.' using errcode = 'LC422'; end if;
  for k, v in select * from jsonb_each(p) loop
    if not (k = any (allowed)) then raise exception 'Unknown detail field: %', k using errcode = 'LC422'; end if;
    if jsonb_typeof(v) = 'null' then continue; end if;
    if jsonb_typeof(v) <> 'string' then raise exception 'Detail % must be text.', k using errcode = 'LC422'; end if;
    if btrim(v #>> '{}') <> '' then
      result := result || jsonb_build_object(k, public.clean_text(v #>> '{}', 2000, false, k));
    end if;
  end loop;
  return result;
end $$;

create or replace function public.create_bd_item(
  p_unit_id uuid, p_kind text, p_category text, p_name text,
  p_owner_id uuid default null, p_priority text default 'medium', p_client_request_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_unit_contributor(p_unit_id); v_id uuid;
begin
  if p_client_request_id is not null then
    select id into v_id from public.bd_items where client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  if p_kind not in ('client', 'association', 'conference') then
    raise exception 'Unknown type.' using errcode = 'LC422';
  end if;
  if p_owner_id is not null and not public.unit_contributor_ok(p_owner_id, p_unit_id) then
    raise exception 'The sponsor/owner must be an active participant in this business unit.' using errcode = 'LC422';
  end if;
  if coalesce(p_priority, 'medium') not in ('high', 'medium', 'low') then
    raise exception 'Unknown priority.' using errcode = 'LC422';
  end if;
  begin
    insert into public.bd_items (unit_id, kind, category, name, owner_id, priority, created_by, updated_by, client_request_id)
    values (p_unit_id, p_kind, p_category, public.clean_text(p_name, 200, true, 'Name'),
            p_owner_id, coalesce(p_priority, 'medium'), v_uid, v_uid, p_client_request_id)
    returning id into v_id;
  exception when check_violation then
    raise exception 'Choose a valid category for this type.' using errcode = 'LC422';
  end;
  perform public.log_activity(v_uid, p_unit_id, 'bd_created', null, 'bd_item', v_id,
                              'added to 2027 planning: ' || btrim(p_name));
  return v_id;
end $$;

-- Patch any subset of fields. Pass p_expected_version to detect conflicts
-- (the detail panel does); quick dropdown edits may omit it.
create or replace function public.update_bd_item(p_id uuid, p_patch jsonb, p_expected_version integer default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_row public.bd_items; k text; v_owner uuid;
begin
  select * into v_row from public.bd_items where id = p_id for update;
  if not found or not public.can_see_unit(v_row.unit_id) then raise exception 'Not found.' using errcode = 'LC404'; end if;
  if p_expected_version is not null and v_row.version <> p_expected_version then
    raise exception 'Someone else changed this while you were editing. Please review the latest version.' using errcode = 'LC409';
  end if;
  if jsonb_typeof(p_patch) <> 'object' then raise exception 'Invalid update.' using errcode = 'LC422'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('name', 'category', 'owner_id', 'status', 'priority', 'value_2026', 'value_2027', 'key_date', 'details') then
      raise exception 'Unknown field: %', k using errcode = 'LC422';
    end if;
  end loop;
  if p_patch ? 'owner_id' then
    v_owner := nullif(p_patch->>'owner_id', '')::uuid;
    if v_owner is not null and not public.unit_contributor_ok(v_owner, v_row.unit_id) then
      raise exception 'The sponsor/owner must be an active participant in this business unit.' using errcode = 'LC422';
    end if;
  end if;
  begin
    update public.bd_items set
      name       = case when p_patch ? 'name' then public.clean_text(p_patch->>'name', 200, true, 'Name') else name end,
      category   = case when p_patch ? 'category' then p_patch->>'category' else category end,
      owner_id   = case when p_patch ? 'owner_id' then v_owner else owner_id end,
      status     = case when p_patch ? 'status' then p_patch->>'status' else status end,
      priority   = case when p_patch ? 'priority' then p_patch->>'priority' else priority end,
      value_2026 = case when p_patch ? 'value_2026' then nullif(p_patch->>'value_2026', '')::numeric else value_2026 end,
      value_2027 = case when p_patch ? 'value_2027' then nullif(p_patch->>'value_2027', '')::numeric else value_2027 end,
      key_date   = case when p_patch ? 'key_date' then nullif(p_patch->>'key_date', '')::date else key_date end,
      details    = case when p_patch ? 'details'
                        then public.clean_bd_details(kind, details || coalesce(p_patch->'details', '{}'::jsonb))
                        else details end,
      updated_by = v_uid, updated_at = now(), version = version + 1
    where id = p_id;
  exception
    when check_violation then raise exception 'That value isn''t allowed here.' using errcode = 'LC422';
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
      raise exception 'Please check the number or date you entered.' using errcode = 'LC422';
  end;
  return v_row.version + 1;
end $$;

create or replace function public.delete_bd_item(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_row public.bd_items;
begin
  select * into v_row from public.bd_items where id = p_id;
  if not found or not public.can_see_unit(v_row.unit_id) then raise exception 'Not found.' using errcode = 'LC404'; end if;
  if not (public.is_admin() or v_row.created_by = v_uid or v_row.owner_id = v_uid) then
    raise exception 'Only the person who added this, its sponsor/owner, or an administrator can remove it.' using errcode = 'LC403';
  end if;
  delete from public.bd_items where id = p_id;
  if public.is_admin() then perform public.audit('bd.delete', 'bd_item', p_id::text, jsonb_build_object('name', v_row.name)); end if;
end $$;

-- ---------------------------------------------------------------------
-- Executive View (cross-cutting members and admins only)
-- ---------------------------------------------------------------------
-- JIT is disabled for this function: the plan's cost estimate is high
-- (many small sub-selects), which makes Postgres spend seconds compiling
-- a query that runs in milliseconds.
create or replace function public.get_exec_summary()
returns jsonb language plpgsql stable security definer set search_path = '' set jit = off as $$
declare v_threshold int := public.privacy_threshold(); v_nf int; v jsonb;
begin
  if not public.has_all_units() then
    raise exception 'The Executive View is for cross-cutting members.' using errcode = 'LC403';
  end if;
  select count(*) into v_nf from public.priority_factors where active;

  with units as materialized (select * from public.business_units where active),
  hs as materialized (select s.*, u.segment from public.health_stats() s join units u on u.id = s.unit_id),
  ps as materialized (select s.*, u.segment from public.priority_stats() s join units u on u.id = s.unit_id)
  select jsonb_build_object(
    'threshold', v_threshold,
    'units', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', u.id, 'slug', u.slug, 'name', u.name, 'short_name', u.short_name, 'segment', u.segment,
        'members', (select count(*) from public.unit_memberships um join public.workspace_memberships m on m.user_id = um.user_id
                     where um.unit_id = u.id and m.status = 'active'),
        'pending', (select count(*) from public.registration_requests rr where rr.requested_unit_id = u.id and rr.status = 'pending'),
        'contributions', (select coalesce(jsonb_object_agg(dashboard, n), '{}'::jsonb) from (
            select dashboard, count(*) n from public.contributions c
             where c.unit_id = u.id and not c.hidden and not c.archived group by dashboard) d),
        'comments', (select count(*) from public.contribution_comments c where c.unit_id = u.id and not c.hidden),
        'roadmap', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
            select status, count(*) n from public.roadmap_items r
             where r.unit_id = u.id and not r.hidden and not r.archived group by status) r)
      ) order by u.sort), '[]'::jsonb) from units u),

    -- Health: per unit (suppressed below threshold) and per segment
    -- (only units that individually meet the threshold are included).
    'health', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('scope', 'unit', 'key', u.id, 'category_key', hc.key, 'label', hc.label,
                 'respondents', coalesce(h.n, 0), 'suppressed', coalesce(h.n, 0) < v_threshold,
                 'avg', case when h.n >= v_threshold then round(h.total / h.n, 1) end) x
          from units u cross join public.health_categories hc
          left join hs h on h.unit_id = u.id and h.category_id = hc.id
         where hc.active
        union all
        select jsonb_build_object('scope', 'segment', 'key', seg.segment, 'category_key', hc.key, 'label', hc.label,
                 'respondents', coalesce(sum(h.n) filter (where h.n >= v_threshold), 0),
                 'suppressed', coalesce(sum(h.n) filter (where h.n >= v_threshold), 0) < v_threshold,
                 'avg', round(sum(h.total) filter (where h.n >= v_threshold) / nullif(sum(h.n) filter (where h.n >= v_threshold), 0), 1),
                 'excluded_units', (select coalesce(jsonb_agg(u2.short_name), '[]'::jsonb) from units u2
                                     where u2.segment = seg.segment
                                       and not exists (select 1 from hs h2 where h2.unit_id = u2.id and h2.category_id = hc.id and h2.n >= v_threshold)))
          from (select distinct segment from units) seg cross join public.health_categories hc
          left join hs h on h.segment = seg.segment and h.category_id = hc.id
         where hc.active
         group by seg.segment, hc.id, hc.key, hc.label) t),

    'priorities', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('scope', 'unit', 'key', u.id, 'factor_key', f.key, 'label', f.label,
                 'respondents', coalesce(p.n, 0), 'suppressed', coalesce(p.n, 0) < v_threshold,
                 'importance', case when p.n >= v_threshold and v_nf > 1 then round(10 * (v_nf - p.rank_sum / p.n) / (v_nf - 1), 1) end,
                 'experience', case when p.exp_n >= v_threshold then round(((p.exp_sum / p.exp_n) - 1) / 4 * 10, 1) end) x
          from units u cross join public.priority_factors f
          left join ps p on p.unit_id = u.id and p.factor_id = f.id
         where f.active
        union all
        select jsonb_build_object('scope', 'segment', 'key', seg.segment, 'factor_key', f.key, 'label', f.label,
                 'respondents', coalesce(sum(p.n) filter (where p.n >= v_threshold), 0),
                 'suppressed', coalesce(sum(p.n) filter (where p.n >= v_threshold), 0) < v_threshold,
                 'importance', case when v_nf > 1 and sum(p.n) filter (where p.n >= v_threshold) > 0 then round(10 * (v_nf -
                      sum(p.rank_sum) filter (where p.n >= v_threshold) / sum(p.n) filter (where p.n >= v_threshold)) / (v_nf - 1), 1) end,
                 'experience', case when sum(p.exp_n) filter (where p.exp_n >= v_threshold) > 0 then round(((
                      sum(p.exp_sum) filter (where p.exp_n >= v_threshold) / sum(p.exp_n) filter (where p.exp_n >= v_threshold)) - 1) / 4 * 10, 1) end)
          from (select distinct segment from units) seg cross join public.priority_factors f
          left join ps p on p.segment = seg.segment and p.factor_id = f.id
         where f.active
         group by seg.segment, f.id, f.key, f.label) t),

    'top_barriers', (select coalesce(jsonb_agg(x order by (x->>'score')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('id', c.id, 'title', c.title, 'unit_id', c.unit_id, 'unit_slug', u.slug,
                 'unit', u.short_name, 'segment', u.segment, 'resonates', c.resonates_count, 'top', c.top_count,
                 'comments', c.comment_count, 'score', c.resonates_count + 2 * c.top_count) x
          from public.contributions c join units u on u.id = c.unit_id
         where c.board = 'barriers' and not c.hidden and not c.archived
         order by c.resonates_count + 2 * c.top_count desc, c.comment_count desc limit 12) t),

    'roadmap_active', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'unit_slug', u.slug,
                 'unit', u.short_name, 'segment', u.segment, 'timeframe', r.timeframe, 'status', r.status,
                 'owner', (select username from public.profiles where id = r.owner_id))
                 order by u.sort, r.timeframe), '[]'::jsonb)
          from public.roadmap_items r join units u on u.id = r.unit_id
         where not r.hidden and not r.archived and r.status in ('agreed', 'in_progress')),

    'bd', (select coalesce(jsonb_agg(jsonb_build_object('unit_id', u.id, 'segment', u.segment, 'kind', b.kind,
                 'category', b.category, 'n', b.n, 'value_2026', b.v26, 'value_2027', b.v27, 'unowned', b.unowned,
                 'high', b.high)), '[]'::jsonb)
          from (select unit_id, kind, category, count(*) n, sum(value_2026) v26, sum(value_2027) v27,
                       count(*) filter (where owner_id is null) unowned, count(*) filter (where priority = 'high') high
                  from public.bd_items where status <> 'dropped' group by unit_id, kind, category) b
          join units u on u.id = b.unit_id),

    'bd_overlaps', (select coalesce(jsonb_agg(jsonb_build_object('kind', o.kind, 'name', o.name, 'units', o.units)), '[]'::jsonb)
          from (select b.kind, min(b.name) as name, jsonb_agg(distinct u.short_name) as units
                  from public.bd_items b join units u on u.id = b.unit_id
                 where b.status <> 'dropped'
                 group by b.kind, lower(regexp_replace(btrim(b.name), '\s+', ' ', 'g'))
                having count(distinct b.unit_id) > 1) o)
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Administration (redefined / new)
-- ---------------------------------------------------------------------
drop function if exists public.admin_list_people();
create function public.admin_list_people()
returns table (user_id uuid, username text, display_name text, email text, role text, status text,
               all_units boolean, unit_ids uuid[], requested_unit_id uuid,
               joined_at timestamptz, approved_at timestamptz, last_login_at timestamptz,
               last_seen_at timestamptz, last_ip text, named_contributions integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return query
  select p.id, p.username, p.display_name, u.email::text, m.role, m.status, m.all_units,
         coalesce((select array_agg(um.unit_id) from public.unit_memberships um where um.user_id = p.id), '{}'),
         (select rr.requested_unit_id from public.registration_requests rr where rr.user_id = p.id
           order by rr.created_at desc limit 1),
         m.created_at, m.approved_at, m.last_login_at, m.last_seen_at,
         (select e.ip from public.authentication_events e
           where e.user_id = p.id and e.ip is not null order by e.created_at desc limit 1),
         (select count(*)::int from public.contributions c where c.author_id = p.id)
  from public.profiles p
  join public.workspace_memberships m on m.user_id = p.id
  left join auth.users u on u.id = p.id
  order by case m.status when 'pending' then 0 else 1 end, lower(p.username);
end $$;

create or replace function public.admin_set_units(p_user_id uuid, p_unit_ids uuid[], p_all_units boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if not exists (select 1 from public.workspace_memberships where user_id = p_user_id) then
    raise exception 'Not found.' using errcode = 'LC404';
  end if;
  if exists (select 1 from unnest(coalesce(p_unit_ids, '{}')) x
              where not exists (select 1 from public.business_units b where b.id = x)) then
    raise exception 'Unknown business unit.' using errcode = 'LC422';
  end if;
  delete from public.unit_memberships where user_id = p_user_id and not (unit_id = any (coalesce(p_unit_ids, '{}')));
  insert into public.unit_memberships (user_id, unit_id)
  select p_user_id, x from unnest(coalesce(p_unit_ids, '{}')) x on conflict do nothing;
  update public.workspace_memberships set all_units = coalesce(p_all_units, false) where user_id = p_user_id;
  perform public.audit('member.units', 'user', p_user_id::text,
                       jsonb_build_object('unit_ids', to_jsonb(p_unit_ids), 'all_units', p_all_units));
end $$;

drop function if exists public.admin_review_registration(uuid, boolean, text, text);
create function public.admin_review_registration(p_user_id uuid, p_approve boolean,
                                                 p_role text default 'participant', p_note text default null,
                                                 p_unit_ids uuid[] default null, p_all_units boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public.require_admin();
begin
  if p_role not in ('admin', 'participant', 'viewer') then
    raise exception 'Unknown role.' using errcode = 'LC422';
  end if;
  if p_approve and coalesce(array_length(p_unit_ids, 1), 0) = 0 and not coalesce(p_all_units, false) then
    raise exception 'Choose a business unit for this person (or make them cross-cutting).' using errcode = 'LC422';
  end if;
  update public.workspace_memberships set
    status = case when p_approve then 'active' else 'rejected' end,
    role = case when p_approve then p_role else role end,
    approved_by = case when p_approve then v_admin end,
    approved_at = case when p_approve then now() end,
    status_changed_at = now()
  where user_id = p_user_id and status in ('pending', 'rejected');
  if not found then raise exception 'No pending request for that person.' using errcode = 'LC404'; end if;
  if p_approve then
    perform public.admin_set_units(p_user_id, p_unit_ids, p_all_units);
  end if;
  update public.registration_requests set
    status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = v_admin, reviewed_at = now(), review_note = p_note
  where user_id = p_user_id and status = 'pending';
  perform public.audit(case when p_approve then 'member.approve' else 'member.reject' end,
                       'user', p_user_id::text, jsonb_build_object('role', p_role));
end $$;

create or replace function public.admin_upsert_unit(p_id uuid, p_slug text, p_name text, p_short_name text,
                                                    p_segment text, p_sort smallint, p_active boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.require_admin();
  if p_segment is not null and p_segment not in ('corporate', 'government') then
    raise exception 'Segment must be Corporate or Government.' using errcode = 'LC422';
  end if;
  if p_id is null then
    insert into public.business_units (slug, name, short_name, segment, sort, active)
    values (p_slug, public.clean_text(p_name, 80, true, 'Name'), public.clean_text(p_short_name, 40, true, 'Short name'),
            coalesce(p_segment, 'government'), coalesce(p_sort, 99), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.business_units set
      name = case when p_name is null then name else public.clean_text(p_name, 80, true, 'Name') end,
      short_name = case when p_short_name is null then short_name else public.clean_text(p_short_name, 40, true, 'Short name') end,
      segment = coalesce(p_segment, segment), sort = coalesce(p_sort, sort), active = coalesce(p_active, active)
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Not found.' using errcode = 'LC404'; end if;
  end if;
  perform public.audit('unit.upsert', 'business_unit', v_id::text, jsonb_build_object('name', p_name, 'segment', p_segment));
  return v_id;
end $$;

create or replace function public.admin_moderate(p_kind text, p_id uuid, p_hidden boolean, p_archived boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if p_kind = 'contribution' then
    update public.contributions set
      hidden = coalesce(p_hidden, hidden), archived = coalesce(p_archived, archived),
      hidden_reason = case when p_hidden then p_reason when p_hidden = false then null else hidden_reason end
    where id = p_id;
  elsif p_kind = 'comment' then
    update public.contribution_comments set hidden = coalesce(p_hidden, hidden) where id = p_id;
  elsif p_kind = 'roadmap' then
    update public.roadmap_items set hidden = coalesce(p_hidden, hidden), archived = coalesce(p_archived, archived) where id = p_id;
  else
    raise exception 'Unknown content type.' using errcode = 'LC422';
  end if;
  if not found then raise exception 'Not found.' using errcode = 'LC404'; end if;
  perform public.audit('content.moderate', p_kind, p_id::text,
                       jsonb_build_object('hidden', p_hidden, 'archived', p_archived, 'reason', p_reason));
end $$;

create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'total_users', (select count(*) from public.workspace_memberships),
    'active_users', (select count(*) from public.workspace_memberships where status = 'active'),
    'online_now', (select count(*) from public.workspace_memberships
                    where status = 'active' and last_seen_at > now() - interval '5 minutes'),
    'pending', (select count(*) from public.workspace_memberships where status = 'pending'),
    'suspended', (select count(*) from public.workspace_memberships where status in ('suspended', 'deprovisioned')),
    'unassigned', (select count(*) from public.workspace_memberships m where m.status = 'active' and not m.all_units
                    and m.role <> 'admin' and not exists (select 1 from public.unit_memberships um where um.user_id = m.user_id)),
    'contributions_by_dashboard', (select coalesce(jsonb_object_agg(dashboard, n), '{}'::jsonb)
        from (select dashboard, count(*) n from public.contributions group by dashboard) d),
    'by_unit', (select coalesce(jsonb_agg(jsonb_build_object('name', b.short_name,
        'members', (select count(*) from public.unit_memberships um join public.workspace_memberships m on m.user_id = um.user_id
                     where um.unit_id = b.id and m.status = 'active'),
        'contributions', (select count(*) from public.contributions c where c.unit_id = b.id),
        'bd_items', (select count(*) from public.bd_items x where x.unit_id = b.id)) order by b.sort), '[]'::jsonb)
        from public.business_units b),
    'contributions_last_7_days', (select count(*) from public.contributions where created_at > now() - interval '7 days'),
    'comments_last_7_days', (select count(*) from public.contribution_comments where created_at > now() - interval '7 days'),
    'failed_logins_24h', (select count(*) from public.authentication_events
        where event_type in ('login_failure', 'login_rate_limited', 'invite_code_failure', 'invite_code_rate_limited')
          and created_at > now() - interval '24 hours'),
    'unusual_24h', (select count(*) from public.authentication_events where unusual and created_at > now() - interval '24 hours'),
    'open_reports', (select count(*) from public.content_reports where status = 'open')
  );
end $$;

-- Exports: add business unit; new BD export. Never anonymous identity,
-- individual answers, or IPs (except the separate security export).
create or replace function public.admin_export(p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.require_admin();
  if p_kind = 'contributions' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'business_unit', bu.name, 'dashboard', c.dashboard, 'board', c.board, 'title', c.title, 'details', c.body,
      'category', cat.label, 'status', c.status,
      'author', case when c.is_anonymous then 'Anonymous' else coalesce(p.username, '(removed)') end,
      'resonates', c.resonates_count, 'support', c.support_count, 'comments', c.comment_count,
      'hidden', c.hidden, 'archived', c.archived, 'created_at', c.created_at, 'updated_at', c.updated_at,
      'extra', c.details) order by bu.sort, c.created_at), '[]'::jsonb) into v
    from public.contributions c
    join public.business_units bu on bu.id = c.unit_id
    left join public.categories cat on cat.id = c.category_id
    left join public.profiles p on p.id = c.author_id;
  elsif p_kind = 'comments' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', cm.id, 'business_unit', bu.name, 'contribution_id', cm.contribution_id, 'roadmap_item_id', cm.roadmap_item_id,
      'bd_item_id', cm.bd_item_id, 'kind', cm.kind, 'body', cm.body, 'author', coalesce(p.username, '(removed)'),
      'hidden', cm.hidden, 'created_at', cm.created_at) order by cm.created_at), '[]'::jsonb) into v
    from public.contribution_comments cm
    join public.business_units bu on bu.id = cm.unit_id
    left join public.profiles p on p.id = cm.author_id;
  elsif p_kind = 'aggregates' then
    -- Same thresholded results members and executives see.
    v := (select jsonb_build_object(
            'health', (select coalesce(jsonb_agg(jsonb_build_object('group',
                         coalesce((select b.name from public.business_units b where b.id::text = h->>'key'),
                                  case h->>'key' when 'corporate' then 'Corporate Solutions' else 'Government Solutions' end))
                         || (h - 'key')), '[]'::jsonb) from jsonb_array_elements(x->'health') h),
            'priorities', (select coalesce(jsonb_agg(jsonb_build_object('group',
                         coalesce((select b.name from public.business_units b where b.id::text = p->>'key'),
                                  case p->>'key' when 'corporate' then 'Corporate Solutions' else 'Government Solutions' end))
                         || (p - 'key')), '[]'::jsonb) from jsonb_array_elements(x->'priorities') p))
            from (select public.get_exec_summary() as x) s);
  elsif p_kind = 'roadmap' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'business_unit', bu.name, 'title', r.title, 'description', r.description, 'timeframe_days', r.timeframe,
      'status', r.status, 'owner', o.username, 'target_outcome', r.target_outcome,
      'target_date', r.target_date, 'suggested_by', cb.username,
      'contributors', (select string_agg(pp.username || ' (' || rc.role || ')', '; ')
                         from public.roadmap_contributors rc join public.profiles pp on pp.id = rc.user_id
                        where rc.item_id = r.id),
      'comments', r.comment_count, 'created_at', r.created_at, 'updated_at', r.updated_at)
      order by bu.sort, r.timeframe, r.created_at), '[]'::jsonb) into v
    from public.roadmap_items r
    join public.business_units bu on bu.id = r.unit_id
    left join public.profiles o on o.id = r.owner_id
    left join public.profiles cb on cb.id = r.created_by;
  elsif p_kind = 'bd' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'business_unit', bu.name, 'segment', bu.segment, 'type', b.kind, 'category', b.category,
      'name', b.name, 'sponsor_owner', o.username, 'priority', b.priority, 'status', b.status,
      'value_2026', b.value_2026, 'value_2027', b.value_2027, 'key_date', b.key_date,
      'comments', b.comment_count, 'added_by', cb.username, 'created_at', b.created_at, 'updated_at', b.updated_at)
      || b.details order by bu.sort, b.kind, b.name), '[]'::jsonb) into v
    from public.bd_items b
    join public.business_units bu on bu.id = b.unit_id
    left join public.profiles o on o.id = b.owner_id
    left join public.profiles cb on cb.id = b.created_by;
  elsif p_kind = 'participation' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'username', p.username, 'role', m.role, 'status', m.status, 'cross_cutting', m.all_units,
      'business_units', (select string_agg(b.short_name, '; ' order by b.sort) from public.unit_memberships um
                          join public.business_units b on b.id = um.unit_id where um.user_id = p.id),
      'named_contributions', (select count(*) from public.contributions c where c.author_id = p.id),
      'comments', (select count(*) from public.contribution_comments c where c.author_id = p.id),
      'roadmap_volunteering', (select count(*) from public.roadmap_contributors rc where rc.user_id = p.id),
      'bd_items_owned', (select count(*) from public.bd_items b where b.owner_id = p.id),
      'last_login_at', m.last_login_at) order by p.username), '[]'::jsonb) into v
    from public.profiles p join public.workspace_memberships m on m.user_id = p.id;
  elsif p_kind = 'security' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'created_at', e.created_at, 'event_type', e.event_type, 'success', e.success,
      'username', e.username, 'email', e.email, 'ip', e.ip, 'user_agent', e.user_agent,
      'account_status', e.account_status, 'session_id', e.session_id, 'unusual', e.unusual)
      order by e.created_at desc), '[]'::jsonb) into v
    from public.authentication_events e;
  else
    raise exception 'Unknown export.' using errcode = 'LC422';
  end if;
  perform public.audit('export', 'export', p_kind);
  return v;
end $$;

create or replace function public.bootstrap_first_admin(p_email text, p_username text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  if exists (select 1 from public.workspace_memberships where role = 'admin') then
    raise exception 'An administrator already exists. Use the Admin area to manage roles.';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(p_email);
  if v_uid is null then
    raise exception 'No auth user with email %. Create the user in Supabase Auth first.', p_email;
  end if;
  insert into public.profiles (id, username, display_name) values (v_uid, p_username, p_display_name)
  on conflict (id) do update set username = excluded.username, display_name = excluded.display_name;
  insert into public.workspace_memberships (user_id, role, status, approved_at, all_units)
  values (v_uid, 'admin', 'active', now(), true)
  on conflict (workspace_id, user_id) do update set role = 'admin', status = 'active', approved_at = now(), all_units = true;
  insert into public.administrative_audit_logs (actor_id, action, target_type, target_id)
  values (v_uid, 'bootstrap.first_admin', 'user', v_uid::text);
  return v_uid;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.business_units enable row level security;
alter table public.unit_memberships enable row level security;
alter table public.bd_items enable row level security;

grant select on public.business_units, public.unit_memberships, public.bd_items to authenticated;
grant all on public.business_units, public.unit_memberships, public.bd_items to service_role;

create policy member_read on public.business_units for select to authenticated
  using ((select public.can_see_unit(id)));
create policy self_read on public.unit_memberships for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active_member()));
create policy admin_read on public.unit_memberships for select to authenticated
  using ((select public.is_admin()));
create policy member_read on public.bd_items for select to authenticated
  using ((select public.can_see_unit(unit_id)));

drop policy member_read on public.profiles;
create policy member_read on public.profiles for select to authenticated
  using (public.profile_visible(id));

drop policy member_read on public.contributions;
create policy member_read on public.contributions for select to authenticated
  using (public.can_see_unit(unit_id)
         and (not hidden or (select public.is_admin()) or author_id = (select auth.uid())));

drop policy member_read on public.contribution_comments;
create policy member_read on public.contribution_comments for select to authenticated
  using (public.can_see_unit(unit_id)
         and (not hidden or (select public.is_admin()) or author_id = (select auth.uid())));

drop policy member_read on public.contribution_links;
create policy member_read on public.contribution_links for select to authenticated
  using (public.can_see_unit(unit_id));

drop policy member_read on public.roadmap_items;
create policy member_read on public.roadmap_items for select to authenticated
  using (public.can_see_unit(unit_id) and (not hidden or (select public.is_admin())));

drop policy member_read on public.roadmap_contributors;
create policy member_read on public.roadmap_contributors for select to authenticated
  using (exists (select 1 from public.roadmap_items r where r.id = item_id and public.can_see_unit(r.unit_id)));

drop policy member_read on public.activity_events;
create policy member_read on public.activity_events for select to authenticated
  using (public.can_see_unit(unit_id));

-- ---------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------
revoke all on function
  public.has_all_units(), public.can_see_unit(uuid), public.is_unit_member(uuid), public.require_unit_contributor(uuid),
  public.require_unit_viewer(uuid),
  public.profile_visible(uuid), public.can_join_topic(text),
  public.log_activity(uuid, uuid, text, smallint, text, uuid, text), public.get_unit_members(uuid),
  public.create_contribution(uuid, text, text, text, uuid, jsonb, boolean, uuid),
  public.add_comment(uuid, uuid, text, text, uuid, uuid), public.item_unit(text, uuid),
  public.create_roadmap_item(uuid, text, text, smallint, text, date, uuid, uuid), public.unit_contributor_ok(uuid, uuid),
  public.require_unit_respondent(uuid), public.submit_health_ratings(uuid, jsonb), public.health_stats(),
  public.get_health_summary(uuid), public.submit_priority_ranking(uuid, uuid[]), public.submit_experience_ratings(uuid, jsonb),
  public.priority_stats(), public.get_priority_summary(uuid), public.get_home_summary(uuid),
  public.bd_detail_keys(text), public.clean_bd_details(text, jsonb),
  public.create_bd_item(uuid, text, text, text, uuid, text, uuid), public.update_bd_item(uuid, jsonb, integer),
  public.delete_bd_item(uuid), public.get_exec_summary(), public.admin_list_people(),
  public.admin_set_units(uuid, uuid[], boolean), public.admin_review_registration(uuid, boolean, text, text, uuid[], boolean),
  public.admin_upsert_unit(uuid, text, text, text, text, smallint, boolean)
from public, anon;

-- Used inside RLS policies, so callable by signed-in users (they only
-- answer questions about the caller).
grant execute on function
  public.has_all_units(), public.can_see_unit(uuid), public.is_unit_member(uuid), public.profile_visible(uuid),
  public.can_join_topic(text)
to authenticated;

grant execute on function
  public.get_unit_members(uuid),
  public.create_contribution(uuid, text, text, text, uuid, jsonb, boolean, uuid),
  public.add_comment(uuid, uuid, text, text, uuid, uuid),
  public.create_roadmap_item(uuid, text, text, smallint, text, date, uuid, uuid),
  public.submit_health_ratings(uuid, jsonb), public.get_health_summary(uuid),
  public.submit_priority_ranking(uuid, uuid[]), public.submit_experience_ratings(uuid, jsonb),
  public.get_priority_summary(uuid), public.get_home_summary(uuid),
  public.create_bd_item(uuid, text, text, text, uuid, text, uuid), public.update_bd_item(uuid, jsonb, integer),
  public.delete_bd_item(uuid), public.get_exec_summary(),
  public.admin_list_people(), public.admin_set_units(uuid, uuid[], boolean),
  public.admin_review_registration(uuid, boolean, text, text, uuid[], boolean),
  public.admin_upsert_unit(uuid, text, text, text, text, smallint, boolean)
to authenticated;

grant execute on function public.has_all_units(), public.can_see_unit(uuid) to service_role;

-- ---------------------------------------------------------------------
-- Realtime: per-unit private channels ('unit:<id>'); publish BD changes.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.bd_items, public.unit_memberships, public.business_units;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'realtime' and table_name = 'messages') then
    execute 'drop policy if exists lc_members_receive on realtime.messages';
    execute 'drop policy if exists lc_members_presence on realtime.messages';
    execute $p$
      create policy lc_members_receive on realtime.messages for select to authenticated
      using ( (select public.can_join_topic(realtime.topic())) )
    $p$;
    execute $p$
      create policy lc_members_presence on realtime.messages for insert to authenticated
      with check ( extension = 'presence' and (select public.can_join_topic(realtime.topic())) )
    $p$;
  end if;
end $$;
