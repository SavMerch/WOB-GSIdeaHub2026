import type { BdKind } from "./types";

export interface BdField {
  key: string;
  label: string;
  placeholder?: string;
  options?: string[];
  short?: boolean;
}

export interface BdKindConfig {
  kind: BdKind;
  label: string;
  singular: string;
  intro: string;
  categories: { value: string; label: string; hint: string }[];
  value2026: string;
  value2027: string;
  keyDate: string;
  sections: { title: string; fields: BdField[] }[];
}

export const BD_STATUSES = [
  { value: "proposed", label: "Proposed" },
  { value: "committed", label: "Committed" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "dropped", label: "Dropped" },
] as const;

export const BD_PRIORITIES = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const;

const NEXT_STEPS: BdField = { key: "next_steps", label: "Next steps", placeholder: "Who does what, by when?" };

export const BD_KINDS: Record<BdKind, BdKindConfig> = {
  client: {
    kind: "client",
    label: "Clients",
    singular: "client",
    intro: "Which clients do we keep, grow, or let go in 2027 — and who's leading each?",
    categories: [
      { value: "retain", label: "Retain", hint: "Protect and renew" },
      { value: "grow", label: "Grow", hint: "Expand the work" },
      { value: "surrender", label: "Surrender", hint: "Wind down or hand off" },
    ],
    value2026: "2026 revenue",
    value2027: "2027 target",
    keyDate: "Contract renewal",
    sections: [
      {
        title: "Who",
        fields: [
          { key: "relationship_lead", label: "Our relationship lead(s)", placeholder: "Who at WOB owns the day-to-day relationship?", short: true },
          { key: "key_contacts", label: "Their key contacts", placeholder: "Decision-makers, champions, procurement…" },
          { key: "relationship_health", label: "Relationship health", options: ["Strong", "Steady", "At risk", "New"], short: true },
        ],
      },
      {
        title: "What",
        fields: [
          { key: "current_work", label: "What we do for them today", placeholder: "Services, programs, active task orders" },
          { key: "contract_vehicle", label: "Contract vehicle and terms", placeholder: "MSA, GSA schedule, IDIQ, retainer; end date", short: true },
          { key: "opportunities", label: "2027 opportunities", placeholder: "New services, expansion, renewals, cross-sell" },
        ],
      },
      {
        title: "Why",
        fields: [
          { key: "rationale", label: "Why retain, grow, or surrender?", placeholder: "The reasoning behind the call" },
          { key: "risks", label: "Risks", placeholder: "Budget cuts, leadership change, performance concerns" },
          { key: "competitors", label: "Competitors in the account", short: true },
          { key: "strategic_fit", label: "Strategic fit", placeholder: "How this supports our 2027 priorities" },
        ],
      },
      { title: "Next steps", fields: [NEXT_STEPS, { key: "next_touchpoint", label: "Next touchpoint", placeholder: "e.g. QBR on Feb 12", short: true }] },
    ],
  },
  association: {
    kind: "association",
    label: "Associations",
    singular: "association",
    intro: "Where should we be a member, a sponsor, or a partner in 2027?",
    categories: [
      { value: "member", label: "Member", hint: "Join and participate" },
      { value: "sponsor", label: "Sponsor", hint: "Pay for visibility" },
      { value: "partnership", label: "Partnership", hint: "Co-create or co-lead" },
    ],
    value2026: "2026 cost",
    value2027: "2027 budget",
    keyDate: "Renewal date",
    sections: [
      {
        title: "Who",
        fields: [
          { key: "our_reps", label: "Who represents us", placeholder: "Members, board or committee seats" },
          { key: "key_contacts", label: "Key contacts at the association", short: true },
        ],
      },
      {
        title: "What",
        fields: [
          { key: "membership_level", label: "Membership or sponsorship level", placeholder: "Tier, annual dues, what's included", short: true },
          { key: "benefits", label: "What we get", placeholder: "Speaking slots, directory listing, data, introductions" },
          { key: "committees", label: "Committees and working groups" },
          { key: "related_events", label: "Related events", placeholder: "Conferences or webinars tied to this association" },
        ],
      },
      {
        title: "Why",
        fields: [
          { key: "rationale", label: "Why this association?" },
          { key: "target_clients", label: "Clients and prospects we reach here" },
          { key: "visibility_value", label: "Visibility and thought-leadership value" },
        ],
      },
      { title: "Next steps", fields: [NEXT_STEPS, { key: "renewal_notes", label: "Renewal notes", placeholder: "Deadline, decision owner, budget line", short: true }] },
    ],
  },
  conference: {
    kind: "conference",
    label: "Conferences",
    singular: "conference",
    intro: "Which events do we attend, exhibit at, or sponsor in 2027?",
    categories: [
      { value: "attend", label: "Attend", hint: "Send people" },
      { value: "booth", label: "Booth", hint: "Exhibit" },
      { value: "sponsor", label: "Sponsor", hint: "Sponsor or host" },
    ],
    value2026: "2026 cost",
    value2027: "2027 budget",
    keyDate: "Event date",
    sections: [
      {
        title: "Who",
        fields: [
          { key: "attendees", label: "Who from WOB attends", short: true },
          { key: "speakers", label: "Speaking slots and panels" },
          { key: "target_contacts", label: "Clients and prospects to meet" },
        ],
      },
      {
        title: "What",
        fields: [
          { key: "location", label: "Location", short: true },
          { key: "event_dates", label: "Dates", short: true },
          { key: "presence_plan", label: "Our presence", placeholder: "Booth size, session, reception, side meetings" },
          { key: "cost_breakdown", label: "Cost breakdown", placeholder: "Registration, booth, sponsorship, travel" },
        ],
      },
      {
        title: "Why",
        fields: [
          { key: "rationale", label: "Why go?" },
          { key: "success_measures", label: "What success looks like", placeholder: "e.g. 15 client meetings, 5 qualified leads" },
          { key: "last_year", label: "Results last time" },
        ],
      },
      { title: "Next steps", fields: [NEXT_STEPS, { key: "decision_deadline", label: "Decision or registration deadline", short: true }] },
    ],
  },
};

export const categoryLabel = (kind: BdKind, value: string) =>
  BD_KINDS[kind].categories.find((c) => c.value === value)?.label ?? value;
