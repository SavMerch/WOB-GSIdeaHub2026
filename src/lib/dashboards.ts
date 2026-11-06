import { Compass, Eye, Hammer, Heart, Mountain, type LucideIcon } from "lucide-react";

export interface DashboardMeta {
  n: 1 | 2 | 3 | 4 | 5;
  /** Path within a business unit, e.g. /u/caribe/<path> */
  path: string;
  question: string;
  short: string;
  subtitle: string;
  icon: LucideIcon;
  /** Tailwind classes using the dashboard's accent token. */
  accent: { text: string; bg: string; soft: string; border: string; hex: string };
}

export const DASHBOARDS: DashboardMeta[] = [
  {
    n: 1, path: "honest", question: "Are we being honest about where we are?", short: "Where we are",
    subtitle: "Let's get everything on the table.", icon: Eye,
    accent: { text: "text-d1", bg: "bg-d1", soft: "bg-d1-soft", border: "border-d1", hex: "#2b63a6" },
  },
  {
    n: 2, path: "in-our-way", question: "What's getting in our way?", short: "What's in our way",
    subtitle: "What's making this harder than it needs to be?", icon: Mountain,
    accent: { text: "text-d2", bg: "bg-d2", soft: "bg-d2-soft", border: "border-d2", hex: "#a1650f" },
  },
  {
    n: 3, path: "become", question: "What could we become?", short: "What we could become",
    subtitle: "Forget the limitations for a minute. What's possible?", icon: Compass,
    accent: { text: "text-d3", bg: "bg-d3", soft: "bg-d3-soft", border: "border-d3", hex: "#2a7a50" },
  },
  {
    n: 4, path: "matters", question: "What matters most to us?", short: "What matters most",
    subtitle: "What makes this work worth doing?", icon: Heart,
    accent: { text: "text-d4", bg: "bg-d4", soft: "bg-d4-soft", border: "border-d4", hex: "#6447b8" },
  },
  {
    n: 5, path: "build", question: "What are we willing to build together?", short: "What we'll build",
    subtitle: "Let's turn the conversation into something real.", icon: Hammer,
    accent: { text: "text-d5", bg: "bg-d5", soft: "bg-d5-soft", border: "border-d5", hex: "#0d7472" },
  },
];

export const dashboardByN = (n: number) => DASHBOARDS.find((d) => d.n === n) ?? DASHBOARDS[0];

export const BOARD_DASHBOARD: Record<string, number> = {
  honest_working: 1, honest_unsaid: 1, barriers: 2, known_for: 3, grow: 3, excited: 4, expectations: 5,
};

export function itemHref(unitSlug: string, kind: "contribution" | "roadmap", id: string, board: string, dashboard: number) {
  if (kind === "roadmap") return `/u/${unitSlug}/build?item=${id}`;
  const d = dashboardByN(dashboard ?? BOARD_DASHBOARD[board]);
  return `/u/${unitSlug}/${d.path}?item=${id}`;
}

export const STATUS_LABEL: Record<string, string> = {
  open: "New",
  discussing: "Being discussed",
  addressed: "Addressed",
  commitment: "Shared commitment",
  suggested: "Suggested",
  agreed: "Agreed",
  in_progress: "In progress",
  completed: "Completed",
};
