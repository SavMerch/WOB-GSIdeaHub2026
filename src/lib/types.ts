export type Role = "admin" | "participant" | "viewer";
export type MemberStatus = "pending" | "active" | "suspended" | "rejected" | "deprovisioned";

export interface Profile {
  id: string;
  username: string;
  display_name: string;
}

export interface Membership {
  role: Role;
  status: MemberStatus;
}

export interface WorkspaceSettings {
  app_name: string;
  organization_name: string;
  welcome_message: string;
  dashboard_descriptions: Record<string, string>;
  registration_open: boolean;
  require_approval: boolean;
  invitation_code_enabled: boolean;
  allow_anonymous: boolean;
  privacy_threshold: number;
  log_retention_days: number;
  idle_timeout_minutes: number;
  roadmap_start_date: string;
}

export type ContributionStatus = "open" | "discussing" | "addressed" | "commitment";

export interface Category {
  id: string;
  board: string;
  key: string;
  label: string;
  sort: number;
  active: boolean;
}

export interface Contribution {
  id: string;
  dashboard: number;
  board: string;
  title: string;
  body: string;
  category_id: string | null;
  details: Record<string, string>;
  status: ContributionStatus;
  is_anonymous: boolean;
  author_id: string | null;
  nominated_at: string | null;
  hidden: boolean;
  hidden_reason: string | null;
  archived: boolean;
  resonates_count: number;
  support_count: number;
  top_count: number;
  comment_count: number;
  version: number;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  author?: { username: string; display_name: string } | null;
  category?: { label: string; key: string } | null;
}

export interface Comment {
  id: string;
  contribution_id: string | null;
  roadmap_item_id: string | null;
  author_id: string | null;
  kind: "comment" | "solution";
  body: string;
  edited: boolean;
  hidden: boolean;
  created_at: string;
  author?: { username: string } | null;
}

export type RoadmapStatus = "suggested" | "discussing" | "agreed" | "in_progress" | "completed";

export interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  timeframe: 60 | 90 | 120;
  status: RoadmapStatus;
  owner_id: string | null;
  target_outcome: string;
  target_date: string | null;
  created_by: string | null;
  hidden: boolean;
  archived: boolean;
  comment_count: number;
  version: number;
  created_at: string;
  updated_at: string;
  owner?: { username: string } | null;
  creator?: { username: string } | null;
  contributors?: { user_id: string; role: "helper" | "offered_to_lead"; profile: { username: string } | null }[];
}

export interface RelatedItem {
  link_id: string;
  kind: "contribution" | "roadmap";
  id: string;
  title: string;
  dashboard: number;
  board: string;
  status: string;
}

export interface HealthSummaryRow {
  category_id: string;
  key: string;
  label: string;
  respondents: number;
  suppressed: boolean;
  avg_score: number | null;
  distribution: number[] | null;
}

export interface PrioritySummaryRow {
  factor_id: string;
  key: string;
  label: string;
  rank_respondents: number;
  rank_suppressed: boolean;
  avg_rank: number | null;
  importance: number | null;
  top3_count: number | null;
  rank_distribution: number[] | null;
  experience_respondents: number;
  experience_suppressed: boolean;
  avg_experience: number | null;
}
