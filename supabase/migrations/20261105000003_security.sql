-- =====================================================================
-- Grants, Row Level Security, realtime authorization
-- =====================================================================
-- Principle: anon gets nothing. authenticated gets SELECT on what it may
-- read (filtered by RLS) and EXECUTE on the RPCs it may call. No client
-- role has INSERT/UPDATE/DELETE on any table.
-- =====================================================================

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Enable RLS everywhere (service_role bypasses it).
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    -- Not FORCE: the table owner runs the SECURITY DEFINER RPCs, which
    -- perform their own membership checks.
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Readable tables for signed-in users (RLS narrows further)
-- ---------------------------------------------------------------------
grant select on
  public.workspaces, public.workspace_settings, public.profiles, public.workspace_memberships,
  public.boards, public.categories, public.contributions, public.contribution_comments,
  public.contribution_reactions, public.contribution_links, public.roadmap_items,
  public.roadmap_contributors, public.health_categories, public.health_ratings,
  public.priority_factors, public.priority_rankings, public.priority_experience_ratings,
  public.activity_events, public.content_reports,
  public.registration_requests, public.invitations,
  public.authentication_events, public.administrative_audit_logs
to authenticated;
-- Intentionally NOT granted to any client role:
--   invitation_codes, registration_tokens, rate_limits

-- Workspace-wide reference data: any active member
create policy member_read on public.workspaces for select to authenticated
  using ((select public.is_active_member()));
create policy member_read on public.workspace_settings for select to authenticated
  using ((select public.is_active_member()));
create policy member_read on public.boards for select to authenticated
  using ((select public.is_active_member()));
create policy member_read on public.categories for select to authenticated
  using ((select public.is_active_member()));
create policy member_read on public.health_categories for select to authenticated
  using ((select public.is_active_member()));
create policy member_read on public.priority_factors for select to authenticated
  using ((select public.is_active_member()));

-- Profiles: yourself always; active members see people who are (or were)
-- part of the workspace — never pending or rejected applicants.
create policy self_read on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy member_read on public.profiles for select to authenticated
  using ((select public.is_active_member()) and public.is_listed_member(id));
create policy admin_read on public.profiles for select to authenticated
  using ((select public.is_admin()));

-- Memberships: your own row (needed for the awaiting-approval screen and
-- live suspension notice), or everything for admins.
create policy self_read on public.workspace_memberships for select to authenticated
  using (user_id = (select auth.uid()));
create policy admin_read on public.workspace_memberships for select to authenticated
  using ((select public.is_admin()));

-- Shared content
create policy member_read on public.contributions for select to authenticated
  using ((select public.is_active_member())
         and (not hidden or (select public.is_admin()) or author_id = (select auth.uid())));
create policy member_read on public.contribution_comments for select to authenticated
  using ((select public.is_active_member())
         and (not hidden or (select public.is_admin()) or author_id = (select auth.uid())));
create policy member_read on public.contribution_links for select to authenticated
  using ((select public.is_active_member()));
create policy member_read on public.roadmap_items for select to authenticated
  using ((select public.is_active_member()) and (not hidden or (select public.is_admin())));
create policy member_read on public.roadmap_contributors for select to authenticated
  using ((select public.is_active_member()));
create policy member_read on public.activity_events for select to authenticated
  using ((select public.is_active_member()));

-- Reactions: only your own rows. Totals are on the contribution itself.
create policy self_read on public.contribution_reactions for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active_member()));

-- Private survey answers: owner only. Not even administrators.
create policy self_read on public.health_ratings for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active_member()));
create policy self_read on public.priority_rankings for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active_member()));
create policy self_read on public.priority_experience_ratings for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active_member()));

-- Reports: reporter sees own; admin sees all
create policy self_read on public.content_reports for select to authenticated
  using (reporter_id = (select auth.uid()) and (select public.is_active_member()));
create policy admin_read on public.content_reports for select to authenticated
  using ((select public.is_admin()));

-- Administrator-only tables
create policy admin_read on public.registration_requests for select to authenticated
  using ((select public.is_admin()));
create policy admin_read on public.invitations for select to authenticated
  using ((select public.is_admin()));
create policy admin_read on public.authentication_events for select to authenticated
  using ((select public.is_admin()));
create policy admin_read on public.administrative_audit_logs for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------
-- Helpers referenced inside RLS policies must be executable by the caller.
grant execute on function
  public.default_workspace_id(), public.current_role_if_active(), public.is_active_member(),
  public.can_contribute(), public.is_admin(), public.is_listed_member(uuid)
to authenticated;

grant execute on function
  public.update_my_profile(text),
  public.create_contribution(text, text, text, uuid, jsonb, boolean, uuid),
  public.update_contribution(uuid, integer, text, text, uuid, jsonb),
  public.delete_contribution(uuid),
  public.set_contribution_status(uuid, text),
  public.toggle_reaction(uuid, text),
  public.set_focus_nomination(uuid, boolean),
  public.add_comment(uuid, uuid, text, text, uuid),
  public.edit_comment(uuid, text),
  public.delete_comment(uuid),
  public.create_link(text, uuid, text, uuid),
  public.delete_link(uuid),
  public.get_related(text, uuid),
  public.report_content(uuid, uuid, text),
  public.create_roadmap_item(text, text, smallint, text, date, uuid, uuid),
  public.update_roadmap_item(uuid, integer, text, text, smallint, text, date),
  public.set_roadmap_status(uuid, text),
  public.set_roadmap_owner(uuid, uuid),
  public.set_roadmap_volunteer(uuid, text),
  public.delete_roadmap_item(uuid),
  public.submit_health_ratings(jsonb),
  public.get_health_summary(),
  public.submit_priority_ranking(uuid[]),
  public.submit_experience_ratings(jsonb),
  public.get_priority_summary(),
  public.get_home_summary(),
  public.admin_list_people(),
  public.admin_review_registration(uuid, boolean, text, text),
  public.admin_set_role(uuid, text),
  public.admin_set_status(uuid, text),
  public.admin_update_settings(jsonb),
  public.admin_moderate(text, uuid, boolean, boolean, text),
  public.admin_resolve_report(uuid, text),
  public.admin_upsert_category(uuid, text, text, text, smallint, boolean),
  public.admin_upsert_health_category(uuid, text, text, smallint, boolean),
  public.admin_overview(),
  public.admin_export(text),
  public.admin_revoke_sessions(uuid)
to authenticated;

-- Server-only: Netlify Functions using the secret/service key.
grant execute on function
  public.svc_rate_limit_hit(text, integer, integer),
  public.svc_consume_registration_token(uuid),
  public.svc_use_invitation_code(uuid),
  public.svc_record_login(uuid, text, text, text),
  public.svc_heartbeat(uuid, text, text, text),
  public.svc_lookup_user_by_email(text),
  public.purge_security_logs(),
  public.bootstrap_first_admin(text, text, text),
  public.default_workspace_id(), public.is_active_member(), public.is_admin(),
  public.current_role_if_active(), public.can_contribute()
to service_role;

-- ---------------------------------------------------------------------
-- Realtime: publish only shared, non-sensitive tables. Survey tables,
-- reactions (who reacted), and all logs are deliberately excluded.
-- Postgres-changes delivery is filtered by the RLS policies above.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.contributions, public.contribution_comments, public.contribution_links,
      public.roadmap_items, public.roadmap_contributors, public.activity_events,
      public.workspace_memberships, public.workspace_settings, public.categories;
  end if;
end $$;

-- Private channel authorization (Supabase Realtime Authorization).
-- Only active members may join 'workspace:main', and they may only send
-- presence (no arbitrary broadcast).
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'realtime' and table_name = 'messages') then
    execute $p$
      create policy lc_members_receive on realtime.messages for select to authenticated
      using ( realtime.topic() = 'workspace:main' and (select public.is_active_member()) )
    $p$;
    execute $p$
      create policy lc_members_presence on realtime.messages for insert to authenticated
      with check ( realtime.topic() = 'workspace:main'
                   and extension = 'presence'
                   and (select public.is_active_member()) )
    $p$;
  end if;
end $$;
