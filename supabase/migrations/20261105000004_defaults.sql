-- =====================================================================
-- Default workspace configuration (structure only — no sample answers)
-- =====================================================================

insert into public.workspaces (id, name)
values (public.default_workspace_id(), 'The Leadership Collective')
on conflict do nothing;

insert into public.workspace_settings (workspace_id, dashboard_descriptions)
values (public.default_workspace_id(), jsonb_build_object(
  '1', 'Let''s get everything on the table.',
  '2', 'What''s making this harder than it needs to be?',
  '3', 'Forget the limitations for a minute. What''s possible?',
  '4', 'What makes this work worth doing?',
  '5', 'Let''s turn the conversation into something real.'))
on conflict do nothing;

insert into public.boards (key, dashboard, label, prompt, allows_anonymous, sort) values
  ('honest_working', 1, 'What''s Working?',              'What are we doing well that we shouldn''t lose?', false, 1),
  ('honest_unsaid',  1, 'What Needs to Be Said?',        'What''s something we need to be more honest about?', true, 2),
  ('barriers',       2, 'What''s Getting in Our Way?',   'What''s making this harder than it needs to be?', true, 1),
  ('known_for',      3, 'What Should We Be Known For?',  'If we were building the team we really want to be part of, what would it look like?', false, 1),
  ('grow',           3, 'Where Could We Grow?',          'Where do you see room for us to grow?', false, 2),
  ('excited',        4, 'What Would Excite You?',        'What would make you genuinely excited about our future?', true, 1),
  ('expectations',   5, 'What Do We Need From Each Other?', 'What do we need from each other to make this real?', true, 2)
on conflict (key) do nothing;

insert into public.categories (board, key, label, sort) values
  ('barriers', 'people_staffing',      'People and staffing', 1),
  ('barriers', 'process_systems',      'Processes and systems', 2),
  ('barriers', 'leadership_decisions', 'Leadership and decisions', 3),
  ('barriers', 'business_development', 'Business development', 4),
  ('barriers', 'financial_corporate',  'Financial and corporate constraints', 5),
  ('barriers', 'culture_collaboration','Culture and collaboration', 6),
  ('grow', 'new_services',        'New services', 1),
  ('grow', 'new_markets',         'New markets', 2),
  ('grow', 'existing_clients',    'Existing-client growth', 3),
  ('grow', 'new_capabilities',    'New capabilities', 4),
  ('grow', 'delivery_models',     'Better delivery models', 5),
  ('grow', 'partnerships',        'Partnerships', 6),
  ('grow', 'internal_innovation', 'Internal innovation', 7),
  ('grow', 'other',               'Other opportunities', 8),
  ('expectations', 'from_leadership',   'What do we need more of from leadership?', 1),
  ('expectations', 'as_a_team',         'What should we do differently as a team?', 2),
  ('expectations', 'contribute',        'What can we each contribute?', 3),
  ('expectations', 'accountable',       'What should we hold ourselves accountable for?', 4)
on conflict do nothing;

insert into public.health_categories (key, label, sort) values
  ('leadership_communication', 'Leadership communication', 1),
  ('trust_transparency',       'Trust and transparency', 2),
  ('operational_effectiveness','Operational effectiveness', 3),
  ('quality_of_work',          'Quality of our work', 4),
  ('team_collaboration',       'Team collaboration', 5),
  ('ability_to_grow',          'Ability to grow', 6),
  ('professional_opportunity', 'Professional opportunity', 7),
  ('confidence_future',        'Confidence in our future', 8)
on conflict do nothing;

insert into public.priority_factors (key, label, sort) values
  ('quality_impact',     'Quality and impact of the work', 1),
  ('lead_build_teams',   'Ability to lead and build teams', 2),
  ('career_advancement', 'Career advancement', 3),
  ('professional_dev',   'Professional development', 4),
  ('compensation',       'Compensation and recognition', 5),
  ('work_life_balance',  'Work-life balance', 6),
  ('autonomy',           'Autonomy and decision-making', 7),
  ('stability',          'Organizational stability', 8),
  ('relationships',      'Relationships and team culture', 9)
on conflict do nothing;
