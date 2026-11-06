-- =====================================================================
-- The Leadership Collective — core schema
-- =====================================================================
-- Design notes
--  * One logical workspace today (fixed id), but every shared row carries
--    workspace_id so the model can grow to several workspaces.
--  * Clients never write tables directly. Every write goes through a
--    SECURITY DEFINER function (see 0003) that re-checks live membership.
--  * Anonymous contributions store NO author reference of any kind.
--  * Individual survey answers (health ratings, priority rankings,
--    experience ratings) are readable only by their owner; groups see
--    thresholded aggregates only.
-- =====================================================================

create or replace function public.default_workspace_id()
returns uuid language sql immutable as
$$ select '00000000-0000-0000-0000-000000000001'::uuid $$;

-- ---------------------------------------------------------------------
-- Workspaces & settings
-- ---------------------------------------------------------------------
create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table public.workspace_settings (
  workspace_id            uuid primary key references public.workspaces(id) on delete cascade,
  app_name                text not null default 'The Leadership Collective'
                            check (char_length(app_name) between 1 and 80),
  organization_name       text not null default 'Witt O''Brien''s'
                            check (char_length(organization_name) between 1 and 80),
  welcome_message         text not null default
    'This is our shared space to be honest about where we are, talk about what''s getting in our way, and figure out what we want to build together.'
                            check (char_length(welcome_message) <= 1000),
  dashboard_descriptions  jsonb not null default '{}'::jsonb
                            check (jsonb_typeof(dashboard_descriptions) = 'object'),
  registration_open       boolean not null default true,
  require_approval        boolean not null default true,
  invitation_code_enabled boolean not null default true,
  allow_anonymous         boolean not null default true,
  -- Minimum distinct respondents before any aggregate is shown.
  -- Hard floor of 3 regardless of admin configuration.
  privacy_threshold       integer not null default 3 check (privacy_threshold between 3 and 100),
  log_retention_days      integer not null default 30 check (log_retention_days between 1 and 3650),
  idle_timeout_minutes    integer not null default 240 check (idle_timeout_minutes between 0 and 10080),
  roadmap_start_date      date not null default current_date,
  updated_at              timestamptz not null default now(),
  updated_by              uuid
);

-- ---------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null check (username ~ '^[A-Za-z0-9_.-]{3,32}$'),
  display_name  text not null check (char_length(btrim(display_name)) between 1 and 80),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index profiles_username_lower_idx on public.profiles (lower(username));

create table public.workspace_memberships (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade
                       default public.default_workspace_id(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  role               text not null default 'participant'
                       check (role in ('admin', 'participant', 'viewer')),
  status             text not null default 'pending'
                       check (status in ('pending', 'active', 'suspended', 'rejected', 'deprovisioned')),
  approved_by        uuid references public.profiles(id) on delete set null,
  approved_at        timestamptz,
  status_changed_at  timestamptz not null default now(),
  last_login_at      timestamptz,
  last_seen_at       timestamptz,
  created_at         timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index workspace_memberships_user_idx on public.workspace_memberships (user_id);

create table public.registration_requests (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade
                  default public.default_workspace_id(),
  user_id       uuid references public.profiles(id) on delete cascade,
  email         text not null,
  username      text not null,
  display_name  text not null,
  ip            text,
  user_agent    text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note   text,
  reviewed_by   uuid references public.profiles(id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- Shared invitation code (hash only; never readable by any client role).
create table public.invitation_codes (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade
                  default public.default_workspace_id(),
  code_hash     text not null,
  label         text,
  active        boolean not null default true,
  expires_at    timestamptz,
  max_uses      integer check (max_uses is null or max_uses > 0),
  use_count     integer not null default 0,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create unique index invitation_codes_one_active
  on public.invitation_codes (workspace_id) where active;

-- Single-use, short-lived registration authorizations issued by the gate.
create table public.registration_tokens (
  jti         uuid primary key,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  ip          text
);

-- Individual invitations sent by an administrator.
create table public.invitations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade
                  default public.default_workspace_id(),
  email         text not null,
  role          text not null default 'participant' check (role in ('admin', 'participant', 'viewer')),
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  user_id       uuid references public.profiles(id) on delete set null,
  invited_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Boards & categories
-- ---------------------------------------------------------------------
create table public.boards (
  key               text primary key,
  dashboard         smallint not null check (dashboard between 1 and 5),
  label             text not null,
  prompt            text not null,
  allows_anonymous  boolean not null default false,
  sort              smallint not null default 0
);

create table public.categories (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade
                  default public.default_workspace_id(),
  board         text not null references public.boards(key) on delete cascade,
  key           text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  label         text not null check (char_length(label) between 1 and 80),
  sort          smallint not null default 0,
  active        boolean not null default true,
  unique (workspace_id, board, key)
);

-- ---------------------------------------------------------------------
-- Contributions (all idea boards share one table)
-- ---------------------------------------------------------------------
create table public.contributions (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade
                       default public.default_workspace_id(),
  dashboard          smallint not null check (dashboard between 1 and 5),
  board              text not null references public.boards(key),
  title              text not null check (char_length(btrim(title)) between 1 and 200),
  body               text not null default '' check (char_length(body) <= 4000),
  category_id        uuid references public.categories(id) on delete set null,
  details            jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  status             text not null default 'open'
                       check (status in ('open', 'discussing', 'addressed', 'commitment')),
  is_anonymous       boolean not null default false,
  -- NULL for anonymous contributions. There is deliberately no other
  -- column, table, or log that ties an anonymous row to a person.
  author_id          uuid references public.profiles(id) on delete set null,
  client_request_id  uuid unique,
  nominated_at       timestamptz,
  hidden             boolean not null default false,
  hidden_reason      text,
  archived           boolean not null default false,
  resonates_count    integer not null default 0,
  support_count      integer not null default 0,
  top_count          integer not null default 0,
  comment_count      integer not null default 0,
  version            integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_activity_at   timestamptz not null default now(),
  constraint anonymous_has_no_author check (not is_anonymous or author_id is null)
);
create index contributions_board_idx on public.contributions (workspace_id, board, created_at desc);
create index contributions_nominated_idx on public.contributions (workspace_id) where nominated_at is not null;

-- ---------------------------------------------------------------------
-- Roadmap
-- ---------------------------------------------------------------------
create table public.roadmap_items (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade
                       default public.default_workspace_id(),
  title              text not null check (char_length(btrim(title)) between 1 and 200),
  description        text not null default '' check (char_length(description) <= 4000),
  timeframe          smallint not null check (timeframe in (60, 90, 120)),
  status             text not null default 'suggested'
                       check (status in ('suggested', 'discussing', 'agreed', 'in_progress', 'completed')),
  owner_id           uuid references public.profiles(id) on delete set null,
  target_outcome     text not null default '' check (char_length(target_outcome) <= 1000),
  target_date        date,
  created_by         uuid references public.profiles(id) on delete set null,
  client_request_id  uuid unique,
  hidden             boolean not null default false,
  archived           boolean not null default false,
  comment_count      integer not null default 0,
  version            integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.roadmap_contributors (
  item_id     uuid not null references public.roadmap_items(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'helper' check (role in ('helper', 'offered_to_lead')),
  created_at  timestamptz not null default now(),
  primary key (item_id, user_id)
);

-- ---------------------------------------------------------------------
-- Comments, reactions, links, reports
-- ---------------------------------------------------------------------
create table public.contribution_comments (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade
                       default public.default_workspace_id(),
  contribution_id    uuid references public.contributions(id) on delete cascade,
  roadmap_item_id    uuid references public.roadmap_items(id) on delete cascade,
  author_id          uuid references public.profiles(id) on delete set null,
  kind               text not null default 'comment' check (kind in ('comment', 'solution')),
  body               text not null check (char_length(btrim(body)) between 1 and 4000),
  client_request_id  uuid unique,
  hidden             boolean not null default false,
  edited             boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint comment_has_one_parent
    check ((contribution_id is null) <> (roadmap_item_id is null))
);
create index comments_contribution_idx on public.contribution_comments (contribution_id, created_at);
create index comments_roadmap_idx on public.contribution_comments (roadmap_item_id, created_at);

create table public.contribution_reactions (
  contribution_id  uuid not null references public.contributions(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  kind             text not null check (kind in ('resonates', 'support', 'top')),
  created_at       timestamptz not null default now(),
  primary key (contribution_id, user_id, kind)
);
create index reactions_user_idx on public.contribution_reactions (user_id, kind);

create table public.contribution_links (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade
                          default public.default_workspace_id(),
  from_contribution_id  uuid references public.contributions(id) on delete cascade,
  from_roadmap_id       uuid references public.roadmap_items(id) on delete cascade,
  to_contribution_id    uuid references public.contributions(id) on delete cascade,
  to_roadmap_id         uuid references public.roadmap_items(id) on delete cascade,
  pair_key              text not null unique,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  constraint link_from_one check ((from_contribution_id is null) <> (from_roadmap_id is null)),
  constraint link_to_one   check ((to_contribution_id is null) <> (to_roadmap_id is null))
);

create table public.content_reports (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade
                     default public.default_workspace_id(),
  contribution_id  uuid references public.contributions(id) on delete cascade,
  comment_id       uuid references public.contribution_comments(id) on delete cascade,
  reporter_id      uuid references public.profiles(id) on delete set null,
  reason           text not null check (char_length(btrim(reason)) between 1 and 1000),
  status           text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by      uuid references public.profiles(id) on delete set null,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint report_has_one_target check ((contribution_id is null) <> (comment_id is null))
);

-- ---------------------------------------------------------------------
-- Private survey data (owner-only rows; aggregates via functions)
-- ---------------------------------------------------------------------
create table public.health_categories (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade
                  default public.default_workspace_id(),
  key           text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  label         text not null check (char_length(label) between 1 and 80),
  sort          smallint not null default 0,
  active        boolean not null default true,
  unique (workspace_id, key)
);

create table public.health_ratings (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  category_id  uuid not null references public.health_categories(id) on delete cascade,
  score        smallint not null check (score between 1 and 10),
  updated_at   timestamptz not null default now(),
  primary key (user_id, category_id)
);

create table public.priority_factors (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade
                  default public.default_workspace_id(),
  key           text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  label         text not null,
  sort          smallint not null default 0,
  active        boolean not null default true,
  unique (workspace_id, key)
);

create table public.priority_rankings (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  factor_id   uuid not null references public.priority_factors(id) on delete cascade,
  rank        smallint not null check (rank between 1 and 50),
  updated_at  timestamptz not null default now(),
  primary key (user_id, factor_id),
  constraint one_factor_per_rank unique (user_id, rank) deferrable initially deferred
);

create table public.priority_experience_ratings (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  factor_id   uuid not null references public.priority_factors(id) on delete cascade,
  score       smallint not null check (score between 1 and 5),
  updated_at  timestamptz not null default now(),
  primary key (user_id, factor_id)
);

-- ---------------------------------------------------------------------
-- Activity, security & audit logs
-- ---------------------------------------------------------------------
create table public.activity_events (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade
                  default public.default_workspace_id(),
  -- NULL when the action was anonymous.
  actor_id      uuid references public.profiles(id) on delete set null,
  event_type    text not null,
  dashboard     smallint,
  entity_type   text,
  entity_id     uuid,
  summary       text not null,
  created_at    timestamptz not null default now()
);
create index activity_events_created_idx on public.activity_events (workspace_id, created_at desc);

create table public.authentication_events (
  id              bigint generated always as identity primary key,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade
                    default public.default_workspace_id(),
  user_id         uuid references public.profiles(id) on delete set null,
  username        text,
  email           text,
  event_type      text not null check (event_type in (
                    'invite_code_success', 'invite_code_failure', 'invite_code_rate_limited',
                    'registration_request', 'registration_rejected_input',
                    'login_success', 'login_failure', 'login_rate_limited', 'login_blocked_status',
                    'password_reset_request', 'session_activity', 'logout')),
  success         boolean not null,
  ip              text,
  user_agent      text,
  account_status  text,
  session_id      text,
  unusual         boolean not null default false,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index authentication_events_created_idx on public.authentication_events (created_at desc);
create index authentication_events_user_idx on public.authentication_events (user_id, created_at desc);

create table public.administrative_audit_logs (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade
                  default public.default_workspace_id(),
  actor_id      uuid references public.profiles(id) on delete set null,
  action        text not null,
  target_type   text,
  target_id     text,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index admin_audit_created_idx on public.administrative_audit_logs (created_at desc);

create table public.rate_limits (
  bucket        text not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (bucket, window_start)
);
