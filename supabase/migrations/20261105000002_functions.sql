-- =====================================================================
-- Membership helpers, triggers, and every write path (RPCs)
-- =====================================================================
-- All functions are SECURITY DEFINER with an empty search_path, so every
-- object is schema-qualified. Each write re-checks *current* membership
-- status in the database — a suspended user is refused immediately even
-- while their JWT is still valid.
-- =====================================================================

-- Custom error codes surfaced to the client:
--   LC401 not an active member   LC403 not permitted   LC404 not found
--   LC409 edit conflict          LC422 invalid input   LC429 limit reached

-- ---------------------------------------------------------------------
-- Membership helpers
-- ---------------------------------------------------------------------
create or replace function public.current_role_if_active()
returns text language sql stable security definer set search_path = '' as $$
  select m.role
  from public.workspace_memberships m
  where m.user_id = auth.uid()
    and m.workspace_id = public.default_workspace_id()
    and m.status = 'active'
$$;

create or replace function public.is_active_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_role_if_active() is not null
$$;

create or replace function public.can_contribute()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_role_if_active() in ('admin', 'participant'), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_role_if_active() = 'admin', false)
$$;

-- Whether a profile belongs to someone who is (or was) a real workspace
-- member — used so pending/rejected applicants are never listed.
create or replace function public.is_listed_member(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_memberships m
                  where m.user_id = p_user_id and m.status in ('active', 'suspended', 'deprovisioned'))
$$;

create or replace function public.require_contributor()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_active_member() then
    raise exception 'Your account is not active in this workspace.' using errcode = 'LC401';
  end if;
  if not public.can_contribute() then
    raise exception 'Your account has read-only access.' using errcode = 'LC403';
  end if;
  return auth.uid();
end $$;

create or replace function public.require_admin()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = 'LC403';
  end if;
  return auth.uid();
end $$;

create or replace function public.audit(p_action text, p_target_type text, p_target_id text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.administrative_audit_logs (actor_id, action, target_type, target_id, details)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb))
$$;

create or replace function public.log_activity(p_actor uuid, p_type text, p_dashboard smallint, p_entity_type text, p_entity_id uuid, p_summary text)
returns void language sql security definer set search_path = '' as $$
  insert into public.activity_events (actor_id, event_type, dashboard, entity_type, entity_id, summary)
  values (p_actor, p_type, p_dashboard, p_entity_type, p_entity_id, left(p_summary, 300))
$$;

create or replace function public.privacy_threshold()
returns integer language sql stable security definer set search_path = '' as $$
  select greatest(3, coalesce((select s.privacy_threshold from public.workspace_settings s
                               where s.workspace_id = public.default_workspace_id()), 3))
$$;

-- ---------------------------------------------------------------------
-- Triggers: counters and timestamps
-- ---------------------------------------------------------------------
create or replace function public.tg_reaction_counts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := coalesce(new.contribution_id, old.contribution_id);
  v_kind text := coalesce(new.kind, old.kind);
  v_delta int := case when tg_op = 'INSERT' then 1 else -1 end;
begin
  update public.contributions c set
    resonates_count = c.resonates_count + case when v_kind = 'resonates' then v_delta else 0 end,
    support_count   = c.support_count   + case when v_kind = 'support'   then v_delta else 0 end,
    top_count       = c.top_count       + case when v_kind = 'top'       then v_delta else 0 end
  where c.id = v_id;
  return null;
end $$;

create trigger reactions_count_trg
after insert or delete on public.contribution_reactions
for each row execute function public.tg_reaction_counts();

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
  else
    update public.roadmap_items r set
      comment_count = r.comment_count + v_delta,
      updated_at = now()
    where r.id = coalesce(new.roadmap_item_id, old.roadmap_item_id);
  end if;
  return null;
end $$;

create trigger comments_count_trg
after insert or delete or update of hidden on public.contribution_comments
for each row execute function public.tg_comment_counts();

-- Links are stored once per unordered pair.
create or replace function public.tg_link_pair_key()
returns trigger language plpgsql as $$
declare a text; b text;
begin
  a := coalesce('c:' || new.from_contribution_id::text, 'r:' || new.from_roadmap_id::text);
  b := coalesce('c:' || new.to_contribution_id::text,   'r:' || new.to_roadmap_id::text);
  if a = b then
    raise exception 'An item cannot be linked to itself.' using errcode = 'LC422';
  end if;
  new.pair_key := least(a, b) || '|' || greatest(a, b);
  return new;
end $$;

create trigger links_pair_key_trg
before insert or update on public.contribution_links
for each row execute function public.tg_link_pair_key();

-- ---------------------------------------------------------------------
-- Validation helpers
-- ---------------------------------------------------------------------
create or replace function public.clean_text(p text, p_max int, p_required boolean, p_field text)
returns text language plpgsql immutable as $$
declare v text := btrim(coalesce(p, ''));
begin
  -- Strip ASCII control characters except tab/newline.
  v := regexp_replace(v, '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g');
  if p_required and v = '' then
    raise exception '% is required.', p_field using errcode = 'LC422';
  end if;
  if char_length(v) > p_max then
    raise exception '% must be % characters or fewer.', p_field, p_max using errcode = 'LC422';
  end if;
  return v;
end $$;

create or replace function public.clean_details(p jsonb)
returns jsonb language plpgsql immutable as $$
declare
  k text; v jsonb; result jsonb := '{}'::jsonb;
  allowed text[] := array['context', 'interesting', 'need_to_change', 'going_for_us', 'in_the_way'];
begin
  if p is null or p = 'null'::jsonb then return '{}'::jsonb; end if;
  if jsonb_typeof(p) <> 'object' then
    raise exception 'Details must be an object.' using errcode = 'LC422';
  end if;
  for k, v in select * from jsonb_each(p) loop
    if not (k = any (allowed)) then
      raise exception 'Unknown detail field: %', k using errcode = 'LC422';
    end if;
    if jsonb_typeof(v) = 'null' then continue; end if;
    if jsonb_typeof(v) <> 'string' then
      raise exception 'Detail % must be text.', k using errcode = 'LC422';
    end if;
    if btrim(v #>> '{}') <> '' then
      result := result || jsonb_build_object(k, public.clean_text(v #>> '{}', 2000, false, k));
    end if;
  end loop;
  return result;
end $$;

-- ---------------------------------------------------------------------
-- Profile
-- ---------------------------------------------------------------------
create or replace function public.update_my_profile(p_display_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_active_member() then
    raise exception 'Your account is not active in this workspace.' using errcode = 'LC401';
  end if;
  update public.profiles
     set display_name = public.clean_text(p_display_name, 80, true, 'Display name'), updated_at = now()
   where id = auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- Contributions
-- ---------------------------------------------------------------------
create or replace function public.create_contribution(
  p_board text,
  p_title text,
  p_body text default '',
  p_category_id uuid default null,
  p_details jsonb default '{}'::jsonb,
  p_anonymous boolean default false,
  p_client_request_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_contributor();
  v_board public.boards;
  v_id uuid;
  v_anon boolean := coalesce(p_anonymous, false);
begin
  if p_client_request_id is not null then
    select id into v_id from public.contributions where client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;   -- repeated click / retry
  end if;

  select * into v_board from public.boards where key = p_board;
  if not found then raise exception 'Unknown board.' using errcode = 'LC422'; end if;

  if v_anon then
    if not v_board.allows_anonymous or not coalesce(
         (select allow_anonymous from public.workspace_settings where workspace_id = public.default_workspace_id()), false) then
      raise exception 'Anonymous sharing is not available here.' using errcode = 'LC403';
    end if;
  end if;

  if p_category_id is not null and not exists (
       select 1 from public.categories c where c.id = p_category_id and c.board = p_board and c.active) then
    raise exception 'That category does not belong to this board.' using errcode = 'LC422';
  end if;

  insert into public.contributions (dashboard, board, title, body, category_id, details,
                                    is_anonymous, author_id, client_request_id)
  values (v_board.dashboard, p_board,
          public.clean_text(p_title, 200, true, 'Title'),
          public.clean_text(p_body, 4000, false, 'Details'),
          p_category_id, public.clean_details(p_details),
          v_anon, case when v_anon then null else v_uid end, p_client_request_id)
  returning id into v_id;

  -- Anonymous: the activity feed records the event with no actor.
  perform public.log_activity(case when v_anon then null else v_uid end, 'contribution_created',
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
  if not found then raise exception 'Not found.' using errcode = 'LC404'; end if;
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
    version = version + 1,
    updated_at = now(),
    last_activity_at = now()
  where id = p_id;
  return v_row.version + 1;
end $$;

create or replace function public.delete_contribution(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_row public.contributions;
begin
  select * into v_row from public.contributions where id = p_id;
  if not found then raise exception 'Not found.' using errcode = 'LC404'; end if;
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
  if not found or (v_row.hidden and not public.is_admin()) then
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
  if not found or v_row.hidden or v_row.archived then
    raise exception 'Not found.' using errcode = 'LC404';
  end if;

  delete from public.contribution_reactions
   where contribution_id = p_contribution_id and user_id = v_uid and kind = p_kind;
  if found then return false; end if;

  if p_kind = 'top' and (
      select count(*) from public.contribution_reactions r
      join public.contributions c on c.id = r.contribution_id
      where r.user_id = v_uid and r.kind = 'top' and c.board = v_row.board) >= 3 then
    raise exception 'You can mark up to three issues as most significant. Unmark one first.' using errcode = 'LC429';
  end if;

  insert into public.contribution_reactions (contribution_id, user_id, kind)
  values (p_contribution_id, v_uid, p_kind)
  on conflict do nothing;
  return true;
end $$;

create or replace function public.set_focus_nomination(p_id uuid, p_nominated boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_row public.contributions;
begin
  select * into v_row from public.contributions where id = p_id;
  if not found or v_row.hidden then raise exception 'Not found.' using errcode = 'LC404'; end if;
  if not p_nominated and not public.is_admin() then
    raise exception 'Only an administrator can remove an item from the focus list.' using errcode = 'LC403';
  end if;
  update public.contributions
     set nominated_at = case when p_nominated then coalesce(nominated_at, now()) else null end,
         last_activity_at = now()
   where id = p_id;
  if p_nominated and v_row.nominated_at is null then
    perform public.log_activity(v_uid, 'focus_nominated', 5::smallint, 'contribution', p_id,
                                'suggested a focus: ' || v_row.title);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Comments (append-only discussion; authors may edit/remove their own)
-- ---------------------------------------------------------------------
create or replace function public.add_comment(
  p_contribution_id uuid, p_roadmap_item_id uuid, p_body text,
  p_kind text default 'comment', p_client_request_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_contributor();
  v_id uuid; v_dash smallint; v_title text;
begin
  if p_client_request_id is not null then
    select id into v_id from public.contribution_comments where client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  if (p_contribution_id is null) = (p_roadmap_item_id is null) then
    raise exception 'A comment needs exactly one parent.' using errcode = 'LC422';
  end if;
  if p_kind not in ('comment', 'solution') then
    raise exception 'Unknown comment type.' using errcode = 'LC422';
  end if;
  if p_contribution_id is not null then
    select dashboard, title into v_dash, v_title from public.contributions
     where id = p_contribution_id and not hidden and not archived;
  else
    select 5::smallint, title into v_dash, v_title from public.roadmap_items
     where id = p_roadmap_item_id and not hidden and not archived;
  end if;
  if v_dash is null then raise exception 'Not found.' using errcode = 'LC404'; end if;

  insert into public.contribution_comments (contribution_id, roadmap_item_id, author_id, kind, body, client_request_id)
  values (p_contribution_id, p_roadmap_item_id, v_uid, p_kind,
          public.clean_text(p_body, 4000, true, 'Comment'), p_client_request_id)
  returning id into v_id;

  perform public.log_activity(v_uid, 'comment_added', v_dash,
          case when p_contribution_id is null then 'roadmap_item' else 'contribution' end,
          coalesce(p_contribution_id, p_roadmap_item_id),
          case when p_kind = 'solution' then 'suggested a solution on: ' else 'commented on: ' end || v_title);
  return v_id;
end $$;

create or replace function public.edit_comment(p_id uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor();
begin
  update public.contribution_comments
     set body = public.clean_text(p_body, 4000, true, 'Comment'), edited = true, updated_at = now()
   where id = p_id and author_id = v_uid and not hidden;
  if not found then raise exception 'You can only edit your own comments.' using errcode = 'LC403'; end if;
end $$;

create or replace function public.delete_comment(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_author uuid;
begin
  select author_id into v_author from public.contribution_comments where id = p_id;
  if not found then raise exception 'Not found.' using errcode = 'LC404'; end if;
  if v_author is distinct from v_uid and not public.is_admin() then
    raise exception 'You can only remove your own comments.' using errcode = 'LC403';
  end if;
  delete from public.contribution_comments where id = p_id;
  if v_author is distinct from v_uid then
    perform public.audit('content.delete', 'comment', p_id::text);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Cross-dashboard links
-- ---------------------------------------------------------------------
create or replace function public.item_is_visible(p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'contribution' then exists (select 1 from public.contributions where id = p_id and not hidden)
    when 'roadmap'      then exists (select 1 from public.roadmap_items where id = p_id and not hidden)
    else false end
$$;

create or replace function public.create_link(p_from_kind text, p_from_id uuid, p_to_kind text, p_to_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_id uuid;
begin
  if not public.item_is_visible(p_from_kind, p_from_id) or not public.item_is_visible(p_to_kind, p_to_id) then
    raise exception 'Not found.' using errcode = 'LC404';
  end if;
  insert into public.contribution_links (from_contribution_id, from_roadmap_id, to_contribution_id, to_roadmap_id, created_by)
  values (case when p_from_kind = 'contribution' then p_from_id end,
          case when p_from_kind = 'roadmap' then p_from_id end,
          case when p_to_kind = 'contribution' then p_to_id end,
          case when p_to_kind = 'roadmap' then p_to_id end,
          v_uid)
  on conflict (pair_key) do nothing
  returning id into v_id;
  return v_id;  -- null when the link already existed
end $$;

create or replace function public.delete_link(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor();
begin
  delete from public.contribution_links
   where id = p_id and (created_by = v_uid or public.is_admin());
  if not found then raise exception 'You can only remove links you created.' using errcode = 'LC403'; end if;
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
    where public.is_active_member()
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

create or replace function public.report_content(p_contribution_id uuid, p_comment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  if auth.uid() is null or not public.is_active_member() then
    raise exception 'Your account is not active in this workspace.' using errcode = 'LC401';
  end if;
  v_uid := auth.uid();
  insert into public.content_reports (contribution_id, comment_id, reporter_id, reason)
  values (p_contribution_id, p_comment_id, v_uid, public.clean_text(p_reason, 1000, true, 'Reason'));
end $$;

-- ---------------------------------------------------------------------
-- Roadmap
-- ---------------------------------------------------------------------
create or replace function public.create_roadmap_item(
  p_title text, p_description text, p_timeframe smallint, p_target_outcome text default '',
  p_target_date date default null, p_related_contribution_id uuid default null,
  p_client_request_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_id uuid;
begin
  if p_client_request_id is not null then
    select id into v_id from public.roadmap_items where client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  if p_timeframe not in (60, 90, 120) then
    raise exception 'Timeframe must be 60, 90, or 120 days.' using errcode = 'LC422';
  end if;
  insert into public.roadmap_items (title, description, timeframe, target_outcome, target_date, created_by, client_request_id)
  values (public.clean_text(p_title, 200, true, 'Title'),
          public.clean_text(p_description, 4000, false, 'Description'),
          p_timeframe, public.clean_text(p_target_outcome, 1000, false, 'Target outcome'),
          p_target_date, v_uid, p_client_request_id)
  returning id into v_id;   -- note: owner is never set automatically

  if p_related_contribution_id is not null then
    if not public.item_is_visible('contribution', p_related_contribution_id) then
      raise exception 'Related item not found.' using errcode = 'LC404';
    end if;
    insert into public.contribution_links (from_roadmap_id, to_contribution_id, created_by)
    values (v_id, p_related_contribution_id, v_uid) on conflict (pair_key) do nothing;
  end if;

  perform public.log_activity(v_uid, 'roadmap_created', 5::smallint, 'roadmap_item', v_id,
                              'suggested a next step: ' || p_title);
  return v_id;
end $$;

create or replace function public.can_manage_roadmap_item(p_item public.roadmap_items)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or (p_item.owner_id is not null and p_item.owner_id = auth.uid())
$$;

create or replace function public.update_roadmap_item(
  p_id uuid, p_expected_version integer, p_title text, p_description text,
  p_timeframe smallint, p_target_outcome text, p_target_date date
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_row public.roadmap_items;
begin
  select * into v_row from public.roadmap_items where id = p_id for update;
  if not found then raise exception 'Not found.' using errcode = 'LC404'; end if;
  if not (v_row.created_by = v_uid or public.can_manage_roadmap_item(v_row)) then
    raise exception 'Only the person who suggested this, its owner, or an administrator can edit it.'
      using errcode = 'LC403';
  end if;
  if v_row.version <> p_expected_version then
    raise exception 'Someone else changed this while you were editing. Please review the latest version.'
      using errcode = 'LC409';
  end if;
  if p_timeframe not in (60, 90, 120) then
    raise exception 'Timeframe must be 60, 90, or 120 days.' using errcode = 'LC422';
  end if;
  update public.roadmap_items set
    title = public.clean_text(p_title, 200, true, 'Title'),
    description = public.clean_text(p_description, 4000, false, 'Description'),
    timeframe = p_timeframe,
    target_outcome = public.clean_text(p_target_outcome, 1000, false, 'Target outcome'),
    target_date = p_target_date,
    version = version + 1,
    updated_at = now()
  where id = p_id;
  return v_row.version + 1;
end $$;

create or replace function public.set_roadmap_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_row public.roadmap_items;
begin
  select * into v_row from public.roadmap_items where id = p_id;
  if not found or v_row.hidden then raise exception 'Not found.' using errcode = 'LC404'; end if;
  if p_status not in ('suggested', 'discussing', 'agreed', 'in_progress', 'completed') then
    raise exception 'Unknown status.' using errcode = 'LC422';
  end if;
  if p_status in ('agreed', 'in_progress', 'completed') and not public.can_manage_roadmap_item(v_row) then
    raise exception 'Only an administrator or the initiative owner can mark this %.', replace(p_status, '_', ' ')
      using errcode = 'LC403';
  end if;
  if p_status in ('suggested', 'discussing') and v_row.status in ('agreed', 'in_progress', 'completed')
     and not public.can_manage_roadmap_item(v_row) then
    raise exception 'Only an administrator or the initiative owner can reopen this.' using errcode = 'LC403';
  end if;
  update public.roadmap_items set status = p_status, updated_at = now() where id = p_id;
  perform public.log_activity(v_uid, 'roadmap_status', 5::smallint, 'roadmap_item', p_id,
                              'moved "' || v_row.title || '" to ' || replace(p_status, '_', ' '));
  if public.is_admin() then
    perform public.audit('roadmap.status', 'roadmap_item', p_id::text, jsonb_build_object('status', p_status));
  end if;
end $$;

create or replace function public.set_roadmap_owner(p_id uuid, p_owner_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if p_owner_id is not null and not exists (
      select 1 from public.workspace_memberships
       where user_id = p_owner_id and status = 'active' and role in ('admin', 'participant')) then
    raise exception 'Owner must be an active participant.' using errcode = 'LC422';
  end if;
  update public.roadmap_items set owner_id = p_owner_id, updated_at = now(), version = version + 1 where id = p_id;
  if not found then raise exception 'Not found.' using errcode = 'LC404'; end if;
  perform public.audit('roadmap.owner', 'roadmap_item', p_id::text, jsonb_build_object('owner_id', p_owner_id));
end $$;

create or replace function public.set_roadmap_volunteer(p_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor();
begin
  if not exists (select 1 from public.roadmap_items where id = p_id and not hidden) then
    raise exception 'Not found.' using errcode = 'LC404';
  end if;
  if p_role is null then
    delete from public.roadmap_contributors where item_id = p_id and user_id = v_uid;
    return;
  end if;
  if p_role not in ('helper', 'offered_to_lead') then
    raise exception 'Unknown role.' using errcode = 'LC422';
  end if;
  insert into public.roadmap_contributors (item_id, user_id, role) values (p_id, v_uid, p_role)
  on conflict (item_id, user_id) do update set role = excluded.role;
  perform public.log_activity(v_uid, 'roadmap_volunteer', 5::smallint, 'roadmap_item', p_id,
    case when p_role = 'helper' then 'volunteered to help' else 'offered to lead' end);
end $$;

create or replace function public.delete_roadmap_item(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_row public.roadmap_items;
begin
  select * into v_row from public.roadmap_items where id = p_id;
  if not found then raise exception 'Not found.' using errcode = 'LC404'; end if;
  if not public.is_admin() and not (v_row.created_by = v_uid and v_row.status = 'suggested') then
    raise exception 'Only an administrator can remove this.' using errcode = 'LC403';
  end if;
  delete from public.roadmap_items where id = p_id;
  if public.is_admin() then perform public.audit('roadmap.delete', 'roadmap_item', p_id::text); end if;
end $$;

-- ---------------------------------------------------------------------
-- Private surveys: write own answers, read only thresholded aggregates
-- ---------------------------------------------------------------------
create or replace function public.submit_health_ratings(p_ratings jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); r jsonb; v_cat uuid; v_score int;
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
    insert into public.health_ratings (user_id, category_id, score, updated_at)
    values (v_uid, v_cat, v_score, now())
    on conflict (user_id, category_id) do update set score = excluded.score, updated_at = now();
  end loop;
end $$;

create or replace function public.get_health_summary()
returns table (category_id uuid, key text, label text, respondents integer,
               suppressed boolean, avg_score numeric, distribution integer[])
language plpgsql stable security definer set search_path = '' as $$
declare v_threshold int := public.privacy_threshold();
begin
  if not public.is_active_member() then
    raise exception 'Your account is not active in this workspace.' using errcode = 'LC401';
  end if;
  return query
  select hc.id, hc.key, hc.label,
         count(hr.user_id)::int,
         count(hr.user_id) < v_threshold,
         case when count(hr.user_id) >= v_threshold then round(avg(hr.score)::numeric, 1) end,
         -- Distribution buckets: 1-2, 3-4, 5-6, 7-8, 9-10 (coarse on purpose)
         case when count(hr.user_id) >= v_threshold then array[
           count(*) filter (where hr.score between 1 and 2)::int,
           count(*) filter (where hr.score between 3 and 4)::int,
           count(*) filter (where hr.score between 5 and 6)::int,
           count(*) filter (where hr.score between 7 and 8)::int,
           count(*) filter (where hr.score between 9 and 10)::int] end
  from public.health_categories hc
  left join public.health_ratings hr on hr.category_id = hc.id
       and exists (select 1 from public.workspace_memberships m where m.user_id = hr.user_id and m.status = 'active')
  where hc.active
  group by hc.id, hc.key, hc.label, hc.sort
  order by hc.sort;
end $$;

create or replace function public.submit_priority_ranking(p_factor_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); v_active uuid[]; i int;
begin
  select array_agg(id order by id) into v_active from public.priority_factors where active;
  if p_factor_ids is null or array_length(p_factor_ids, 1) is distinct from array_length(v_active, 1)
     or (select array_agg(x order by x) from unnest(p_factor_ids) x) is distinct from v_active then
    raise exception 'Please rank every factor exactly once.' using errcode = 'LC422';
  end if;
  delete from public.priority_rankings where user_id = v_uid;
  for i in 1 .. array_length(p_factor_ids, 1) loop
    insert into public.priority_rankings (user_id, factor_id, rank, updated_at)
    values (v_uid, p_factor_ids[i], i, now());
  end loop;
end $$;

create or replace function public.submit_experience_ratings(p_ratings jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_contributor(); r jsonb; v_factor uuid; v_score int;
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
    insert into public.priority_experience_ratings (user_id, factor_id, score, updated_at)
    values (v_uid, v_factor, v_score, now())
    on conflict (user_id, factor_id) do update set score = excluded.score, updated_at = now();
  end loop;
end $$;

create or replace function public.get_priority_summary()
returns table (factor_id uuid, key text, label text,
               rank_respondents integer, rank_suppressed boolean,
               avg_rank numeric, importance numeric, top3_count integer, rank_distribution integer[],
               experience_respondents integer, experience_suppressed boolean, avg_experience numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_threshold int := public.privacy_threshold(); v_n int;
begin
  if not public.is_active_member() then
    raise exception 'Your account is not active in this workspace.' using errcode = 'LC401';
  end if;
  select count(*) into v_n from public.priority_factors where active;
  return query
  with ranks as (
    select pr.* from public.priority_rankings pr
    where exists (select 1 from public.workspace_memberships m where m.user_id = pr.user_id and m.status = 'active')
  ), exp as (
    select pe.* from public.priority_experience_ratings pe
    where exists (select 1 from public.workspace_memberships m where m.user_id = pe.user_id and m.status = 'active')
  ), rk as (
    select f.id as fid,
           count(r.user_id)::int as n,
           avg(r.rank)::numeric as avg_rank,
           count(*) filter (where r.rank <= 3)::int as top3,
           array(select count(r2.user_id)::int from generate_series(1, v_n) g
                 left join ranks r2 on r2.factor_id = f.id and r2.rank = g
                 group by g order by g) as dist
    from public.priority_factors f left join ranks r on r.factor_id = f.id
    where f.active group by f.id
  ), ex as (
    select f.id as fid, count(e.user_id)::int as n, avg(e.score)::numeric as avg_score
    from public.priority_factors f left join exp e on e.factor_id = f.id
    where f.active group by f.id
  )
  select f.id, f.key, f.label,
         rk.n, rk.n < v_threshold,
         case when rk.n >= v_threshold then round(rk.avg_rank, 1) end,
         -- Importance on a 0-10 scale: rank 1 → 10, last rank → 0
         case when rk.n >= v_threshold and v_n > 1
              then round(10 * (v_n - rk.avg_rank) / (v_n - 1), 1) end,
         case when rk.n >= v_threshold then rk.top3 end,
         case when rk.n >= v_threshold then rk.dist end,
         ex.n, ex.n < v_threshold,
         case when ex.n >= v_threshold then round(ex.avg_score, 1) end
  from public.priority_factors f
  join rk on rk.fid = f.id
  join ex on ex.fid = f.id
  where f.active
  order by f.sort;
end $$;

-- ---------------------------------------------------------------------
-- Home summary (no individual data)
-- ---------------------------------------------------------------------
create or replace function public.get_home_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not public.is_active_member() then
    raise exception 'Your account is not active in this workspace.' using errcode = 'LC401';
  end if;
  select jsonb_build_object(
    'active_participants', (select count(*) from public.workspace_memberships
                             where status = 'active' and last_seen_at > now() - interval '5 minutes'),
    'members', (select count(*) from public.workspace_memberships where status = 'active'),
    'contributions_by_dashboard', (select coalesce(jsonb_object_agg(dashboard, n), '{}'::jsonb) from (
        select dashboard, count(*) n from public.contributions where not hidden and not archived group by dashboard) d),
    'roadmap_by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
        select status, count(*) n from public.roadmap_items where not hidden and not archived group by status) r),
    'themes', (select coalesce(jsonb_agg(t order by t.n desc), '[]'::jsonb) from (
        select c.label, c.board, count(*) n
          from public.contributions x join public.categories c on c.id = x.category_id
         where not x.hidden and not x.archived
         group by c.label, c.board order by count(*) desc limit 6) t),
    'roadmap_start_date', (select roadmap_start_date from public.workspace_settings
                            where workspace_id = public.default_workspace_id())
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Administration
-- ---------------------------------------------------------------------
create or replace function public.admin_list_people()
returns table (user_id uuid, username text, display_name text, email text, role text, status text,
               joined_at timestamptz, approved_at timestamptz, last_login_at timestamptz,
               last_seen_at timestamptz, last_ip text, named_contributions integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return query
  select p.id, p.username, p.display_name, u.email::text, m.role, m.status,
         m.created_at, m.approved_at, m.last_login_at, m.last_seen_at,
         (select e.ip from public.authentication_events e
           where e.user_id = p.id and e.ip is not null order by e.created_at desc limit 1),
         (select count(*)::int from public.contributions c where c.author_id = p.id)
  from public.profiles p
  join public.workspace_memberships m on m.user_id = p.id
  left join auth.users u on u.id = p.id
  order by case m.status when 'pending' then 0 else 1 end, lower(p.username);
end $$;

create or replace function public.admin_review_registration(p_user_id uuid, p_approve boolean,
                                                            p_role text default 'participant', p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public.require_admin();
begin
  if p_role not in ('admin', 'participant', 'viewer') then
    raise exception 'Unknown role.' using errcode = 'LC422';
  end if;
  update public.workspace_memberships set
    status = case when p_approve then 'active' else 'rejected' end,
    role = case when p_approve then p_role else role end,
    approved_by = case when p_approve then v_admin end,
    approved_at = case when p_approve then now() end,
    status_changed_at = now()
  where user_id = p_user_id and status in ('pending', 'rejected');
  if not found then raise exception 'No pending request for that person.' using errcode = 'LC404'; end if;
  update public.registration_requests set
    status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = v_admin, reviewed_at = now(), review_note = p_note
  where user_id = p_user_id and status = 'pending';
  perform public.audit(case when p_approve then 'member.approve' else 'member.reject' end,
                       'user', p_user_id::text, jsonb_build_object('role', p_role));
end $$;

create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  perform public.require_admin();
  if p_role not in ('admin', 'participant', 'viewer') then
    raise exception 'Unknown role.' using errcode = 'LC422';
  end if;
  select role into v_old from public.workspace_memberships where user_id = p_user_id for update;
  if not found then raise exception 'Not found.' using errcode = 'LC404'; end if;
  if v_old = 'admin' and p_role <> 'admin' and (
      select count(*) from public.workspace_memberships where role = 'admin' and status = 'active') <= 1 then
    raise exception 'The workspace must keep at least one active administrator.' using errcode = 'LC422';
  end if;
  update public.workspace_memberships set role = p_role where user_id = p_user_id;
  perform public.audit('member.role', 'user', p_user_id::text, jsonb_build_object('from', v_old, 'to', p_role));
end $$;

create or replace function public.admin_set_status(p_user_id uuid, p_status text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public.require_admin(); v_old public.workspace_memberships;
begin
  if p_status not in ('active', 'suspended', 'deprovisioned') then
    raise exception 'Unknown status.' using errcode = 'LC422';
  end if;
  if p_user_id = v_admin and p_status <> 'active' then
    raise exception 'You cannot suspend or remove your own account.' using errcode = 'LC422';
  end if;
  select * into v_old from public.workspace_memberships where user_id = p_user_id for update;
  if not found then raise exception 'Not found.' using errcode = 'LC404'; end if;
  if v_old.role = 'admin' and v_old.status = 'active' and p_status <> 'active' and (
      select count(*) from public.workspace_memberships where role = 'admin' and status = 'active') <= 1 then
    raise exception 'The workspace must keep at least one active administrator.' using errcode = 'LC422';
  end if;
  update public.workspace_memberships set
    status = p_status, status_changed_at = now(),
    approved_by = case when p_status = 'active' and approved_by is null then v_admin else approved_by end,
    approved_at = case when p_status = 'active' and approved_at is null then now() else approved_at end
  where user_id = p_user_id;
  perform public.audit('member.status', 'user', p_user_id::text,
                       jsonb_build_object('from', v_old.status, 'to', p_status));
  return v_old.status;
end $$;

create or replace function public.admin_update_settings(p_settings jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public.require_admin();
begin
  if jsonb_typeof(p_settings) <> 'object' then
    raise exception 'Settings must be an object.' using errcode = 'LC422';
  end if;
  if exists (select 1 from jsonb_object_keys(p_settings) k where k not in (
      'app_name', 'organization_name', 'welcome_message', 'dashboard_descriptions', 'registration_open',
      'require_approval', 'invitation_code_enabled', 'allow_anonymous', 'privacy_threshold',
      'log_retention_days', 'idle_timeout_minutes', 'roadmap_start_date')) then
    raise exception 'Unknown setting.' using errcode = 'LC422';
  end if;
  update public.workspace_settings s set
    app_name = case when p_settings ? 'app_name'
      then public.clean_text(p_settings->>'app_name', 80, true, 'Application name') else s.app_name end,
    organization_name = case when p_settings ? 'organization_name'
      then public.clean_text(p_settings->>'organization_name', 80, true, 'Organization name') else s.organization_name end,
    welcome_message = case when p_settings ? 'welcome_message'
      then public.clean_text(p_settings->>'welcome_message', 1000, true, 'Welcome message') else s.welcome_message end,
    dashboard_descriptions = coalesce(p_settings->'dashboard_descriptions', s.dashboard_descriptions),
    registration_open = coalesce((p_settings->>'registration_open')::boolean, s.registration_open),
    require_approval = coalesce((p_settings->>'require_approval')::boolean, s.require_approval),
    invitation_code_enabled = coalesce((p_settings->>'invitation_code_enabled')::boolean, s.invitation_code_enabled),
    allow_anonymous = coalesce((p_settings->>'allow_anonymous')::boolean, s.allow_anonymous),
    privacy_threshold = coalesce((p_settings->>'privacy_threshold')::int, s.privacy_threshold),
    log_retention_days = coalesce((p_settings->>'log_retention_days')::int, s.log_retention_days),
    idle_timeout_minutes = coalesce((p_settings->>'idle_timeout_minutes')::int, s.idle_timeout_minutes),
    roadmap_start_date = coalesce((p_settings->>'roadmap_start_date')::date, s.roadmap_start_date),
    updated_at = now(), updated_by = v_admin
  where s.workspace_id = public.default_workspace_id();
  perform public.audit('settings.update', 'workspace_settings', public.default_workspace_id()::text,
                       (select jsonb_object_agg(k, true) from jsonb_object_keys(p_settings) k));
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
    update public.roadmap_items set hidden = coalesce(p_hidden, hidden), archived = coalesce(p_archived, archived)
    where id = p_id;
  else
    raise exception 'Unknown content type.' using errcode = 'LC422';
  end if;
  if not found then raise exception 'Not found.' using errcode = 'LC404'; end if;
  perform public.audit('content.moderate', p_kind, p_id::text,
                       jsonb_build_object('hidden', p_hidden, 'archived', p_archived, 'reason', p_reason));
end $$;

create or replace function public.admin_resolve_report(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public.require_admin();
begin
  if p_status not in ('resolved', 'dismissed', 'open') then
    raise exception 'Unknown status.' using errcode = 'LC422';
  end if;
  update public.content_reports set status = p_status,
    resolved_by = case when p_status = 'open' then null else v_admin end,
    resolved_at = case when p_status = 'open' then null else now() end
  where id = p_id;
  perform public.audit('report.' || p_status, 'content_report', p_id::text);
end $$;

create or replace function public.admin_upsert_category(p_id uuid, p_board text, p_key text, p_label text,
                                                        p_sort smallint, p_active boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.require_admin();
  if p_id is null then
    insert into public.categories (board, key, label, sort, active)
    values (p_board, p_key, public.clean_text(p_label, 80, true, 'Label'), coalesce(p_sort, 0), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.categories set label = public.clean_text(p_label, 80, true, 'Label'),
      sort = coalesce(p_sort, sort), active = coalesce(p_active, active)
    where id = p_id returning id into v_id;
  end if;
  perform public.audit('category.upsert', 'category', v_id::text, jsonb_build_object('board', p_board, 'label', p_label));
  return v_id;
end $$;

create or replace function public.admin_upsert_health_category(p_id uuid, p_key text, p_label text,
                                                               p_sort smallint, p_active boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.require_admin();
  if p_id is null then
    insert into public.health_categories (key, label, sort, active)
    values (p_key, public.clean_text(p_label, 80, true, 'Label'), coalesce(p_sort, 0), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.health_categories set label = public.clean_text(p_label, 80, true, 'Label'),
      sort = coalesce(p_sort, sort), active = coalesce(p_active, active)
    where id = p_id returning id into v_id;
  end if;
  perform public.audit('health_category.upsert', 'health_category', v_id::text, jsonb_build_object('label', p_label));
  return v_id;
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
    'contributions_by_dashboard', (select coalesce(jsonb_object_agg(dashboard, n), '{}'::jsonb)
        from (select dashboard, count(*) n from public.contributions group by dashboard) d),
    'contributions_last_7_days', (select count(*) from public.contributions where created_at > now() - interval '7 days'),
    'comments_last_7_days', (select count(*) from public.contribution_comments where created_at > now() - interval '7 days'),
    'failed_logins_24h', (select count(*) from public.authentication_events
        where event_type in ('login_failure', 'login_rate_limited', 'invite_code_failure', 'invite_code_rate_limited')
          and created_at > now() - interval '24 hours'),
    'unusual_24h', (select count(*) from public.authentication_events where unusual and created_at > now() - interval '24 hours'),
    'open_reports', (select count(*) from public.content_reports where status = 'open')
  );
end $$;

-- General-purpose exports. Never include anonymous identity, individual
-- survey answers, or IP addresses.
create or replace function public.admin_export(p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.require_admin();
  if p_kind = 'contributions' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'dashboard', c.dashboard, 'board', c.board, 'title', c.title, 'details', c.body,
      'category', cat.label, 'status', c.status,
      'author', case when c.is_anonymous then 'Anonymous' else coalesce(p.username, '(removed)') end,
      'resonates', c.resonates_count, 'support', c.support_count, 'comments', c.comment_count,
      'hidden', c.hidden, 'archived', c.archived, 'created_at', c.created_at, 'updated_at', c.updated_at,
      'extra', c.details) order by c.created_at), '[]'::jsonb) into v
    from public.contributions c
    left join public.categories cat on cat.id = c.category_id
    left join public.profiles p on p.id = c.author_id;
  elsif p_kind = 'comments' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', cm.id, 'contribution_id', cm.contribution_id, 'roadmap_item_id', cm.roadmap_item_id,
      'kind', cm.kind, 'body', cm.body, 'author', coalesce(p.username, '(removed)'),
      'hidden', cm.hidden, 'created_at', cm.created_at) order by cm.created_at), '[]'::jsonb) into v
    from public.contribution_comments cm left join public.profiles p on p.id = cm.author_id;
  elsif p_kind = 'aggregates' then
    v := jsonb_build_object(
      'health', (select coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb) from public.get_health_summary() h),
      'priorities', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.get_priority_summary() s));
  elsif p_kind = 'roadmap' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'title', r.title, 'description', r.description, 'timeframe_days', r.timeframe,
      'status', r.status, 'owner', o.username, 'target_outcome', r.target_outcome,
      'target_date', r.target_date, 'suggested_by', cb.username,
      'contributors', (select string_agg(pp.username || ' (' || rc.role || ')', '; ')
                         from public.roadmap_contributors rc join public.profiles pp on pp.id = rc.user_id
                        where rc.item_id = r.id),
      'comments', r.comment_count, 'created_at', r.created_at, 'updated_at', r.updated_at)
      order by r.timeframe, r.created_at), '[]'::jsonb) into v
    from public.roadmap_items r
    left join public.profiles o on o.id = r.owner_id
    left join public.profiles cb on cb.id = r.created_by;
  elsif p_kind = 'participation' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'username', p.username, 'role', m.role, 'status', m.status,
      'named_contributions', (select count(*) from public.contributions c where c.author_id = p.id),
      'comments', (select count(*) from public.contribution_comments c where c.author_id = p.id),
      'roadmap_volunteering', (select count(*) from public.roadmap_contributors rc where rc.user_id = p.id),
      'last_login_at', m.last_login_at) order by p.username), '[]'::jsonb) into v
    from public.profiles p join public.workspace_memberships m on m.user_id = p.id;
  elsif p_kind = 'security' then
    -- Security export is separate and contains IP data. Admin only.
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

-- Best-effort refresh-token revocation. On hosted Supabase the postgres
-- role may not be allowed to modify auth.sessions; the caller is told.
create or replace function public.admin_revoke_sessions(p_user_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer := -1;
begin
  perform public.require_admin();
  begin
    execute 'delete from auth.sessions where user_id = $1' using p_user_id;
    get diagnostics v_count = row_count;
  exception when others then
    v_count := -1;
  end;
  perform public.audit('member.revoke_sessions', 'user', p_user_id::text, jsonb_build_object('revoked', v_count));
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- Server-only functions (service role / Netlify Functions)
-- ---------------------------------------------------------------------
create or replace function public.svc_rate_limit_hit(p_bucket text, p_max integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits (bucket, window_start, hits) values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  -- opportunistic cleanup
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;
  return v_hits <= p_max;
end $$;

create or replace function public.svc_consume_registration_token(p_jti uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.registration_tokens set used_at = now()
   where jti = p_jti and used_at is null and expires_at > now();
  return found;
end $$;

create or replace function public.svc_use_invitation_code(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.invitation_codes set use_count = use_count + 1
   where id = p_id and active and (expires_at is null or expires_at > now())
     and (max_uses is null or use_count < max_uses);
  return found;
end $$;

-- Records a successful login and flags anything unusual.
create or replace function public.svc_record_login(p_user_id uuid, p_ip text, p_user_agent text, p_session_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_m public.workspace_memberships; v_username text; v_unusual boolean := false; v_reasons text[] := '{}';
begin
  select * into v_m from public.workspace_memberships where user_id = p_user_id;
  select username into v_username from public.profiles where id = p_user_id;

  if p_ip is not null and exists (
       select 1 from public.authentication_events where user_id = p_user_id and event_type = 'login_success')
     and not exists (
       select 1 from public.authentication_events
        where user_id = p_user_id and ip = p_ip and success and created_at > now() - interval '90 days') then
    v_unusual := true; v_reasons := array_append(v_reasons, 'new network address');
  end if;
  if (select count(*) from public.authentication_events
       where user_id = p_user_id and event_type = 'login_failure' and created_at > now() - interval '1 hour') >= 3 then
    v_unusual := true; v_reasons := array_append(v_reasons, 'several recent failed attempts');
  end if;

  insert into public.authentication_events (user_id, username, event_type, success, ip, user_agent,
                                            account_status, session_id, unusual, details)
  values (p_user_id, v_username,
          case when v_m.status = 'active' or v_m.status = 'pending' then 'login_success' else 'login_blocked_status' end,
          v_m.status in ('active', 'pending'), p_ip, left(p_user_agent, 400),
          coalesce(v_m.status, 'no_membership'), p_session_id, v_unusual,
          jsonb_build_object('reasons', to_jsonb(v_reasons)));

  if v_m.status = 'active' then
    update public.workspace_memberships set last_login_at = now(), last_seen_at = now() where user_id = p_user_id;
  end if;
  return jsonb_build_object('status', coalesce(v_m.status, 'no_membership'), 'role', v_m.role);
end $$;

create or replace function public.svc_heartbeat(p_user_id uuid, p_ip text, p_user_agent text, p_session_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_m public.workspace_memberships; v_last public.authentication_events;
begin
  select * into v_m from public.workspace_memberships where user_id = p_user_id;
  if not found then return jsonb_build_object('status', 'no_membership'); end if;
  if v_m.status = 'active' then
    update public.workspace_memberships set last_seen_at = now() where user_id = p_user_id;
    select * into v_last from public.authentication_events
     where user_id = p_user_id and event_type in ('session_activity', 'login_success')
     order by created_at desc limit 1;
    -- Log authenticated activity sparingly: on a new address or every 30 minutes.
    if v_last.id is null or v_last.ip is distinct from p_ip or v_last.created_at < now() - interval '30 minutes' then
      insert into public.authentication_events (user_id, username, event_type, success, ip, user_agent,
                                                account_status, session_id, unusual)
      values (p_user_id, (select username from public.profiles where id = p_user_id), 'session_activity', true,
              p_ip, left(p_user_agent, 400), v_m.status, p_session_id,
              v_last.id is not null and v_last.ip is distinct from p_ip
                and not exists (select 1 from public.authentication_events
                                 where user_id = p_user_id and ip = p_ip and success
                                   and created_at > now() - interval '90 days'));
    end if;
  end if;
  return jsonb_build_object('status', v_m.status, 'role', v_m.role);
end $$;

create or replace function public.purge_security_logs()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_days int; v_count int;
begin
  select log_retention_days into v_days from public.workspace_settings where workspace_id = public.default_workspace_id();
  delete from public.authentication_events where created_at < now() - make_interval(days => coalesce(v_days, 30));
  get diagnostics v_count = row_count;
  delete from public.registration_tokens where expires_at < now() - interval '1 day';
  delete from public.rate_limits where window_start < now() - interval '2 days';
  delete from public.registration_requests
   where status <> 'pending' and created_at < now() - make_interval(days => greatest(coalesce(v_days, 30), 30));
  return v_count;
end $$;

-- First administrator. Callable only from the SQL editor / service role.
-- Refuses to run once any administrator exists.
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
  insert into public.workspace_memberships (user_id, role, status, approved_at)
  values (v_uid, 'admin', 'active', now())
  on conflict (workspace_id, user_id) do update set role = 'admin', status = 'active', approved_at = now();
  insert into public.administrative_audit_logs (actor_id, action, target_type, target_id)
  values (v_uid, 'bootstrap.first_admin', 'user', v_uid::text);
  return v_uid;
end $$;

-- Used only to attribute failed sign-in attempts in the security log.
create or replace function public.svc_lookup_user_by_email(p_email text)
returns table (id uuid, username text) language sql stable security definer set search_path = '' as $$
  select p.id, p.username from auth.users u join public.profiles p on p.id = u.id
   where lower(u.email) = lower(p_email)
$$;
