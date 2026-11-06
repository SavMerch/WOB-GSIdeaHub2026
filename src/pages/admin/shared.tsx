import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { rpc, unwrap } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface Person {
  user_id: string;
  username: string;
  display_name: string;
  email: string;
  role: string;
  status: string;
  all_units: boolean;
  unit_ids: string[];
  requested_unit_id: string | null;
  joined_at: string;
  approved_at: string | null;
  last_login_at: string | null;
  last_seen_at: string | null;
  last_ip: string | null;
  named_contributions: number;
}

export interface AuthEvent {
  id: number;
  user_id: string | null;
  username: string | null;
  email: string | null;
  event_type: string;
  success: boolean;
  ip: string | null;
  user_agent: string | null;
  account_status: string | null;
  session_id: string | null;
  unusual: boolean;
  details: Record<string, unknown>;
  created_at: string;
}

export const usePeople = () => useQuery({ queryKey: ["admin-people"], queryFn: () => rpc<Person[]>("admin_list_people") });

export const useAuthEvents = (filter: string, limit = 100) =>
  useQuery({
    queryKey: ["admin-auth-events", filter, limit],
    refetchInterval: 30_000,
    queryFn: async () => {
      let q = supabase.from("authentication_events").select("*").order("created_at", { ascending: false }).limit(limit);
      if (filter === "failed") q = q.eq("success", false);
      else if (filter === "unusual") q = q.eq("unusual", true);
      else if (filter === "logins") q = q.in("event_type", ["login_success", "login_failure", "login_blocked_status", "login_rate_limited"]);
      else if (filter === "invite") q = q.in("event_type", ["invite_code_success", "invite_code_failure", "invite_code_rate_limited"]);
      else if (filter === "registration") q = q.in("event_type", ["registration_request", "registration_rejected_input"]);
      else if (filter === "activity") q = q.in("event_type", ["session_activity", "logout"]);
      return unwrap(await q) as AuthEvent[];
    },
  });

export const EVENT_LABEL: Record<string, string> = {
  invite_code_success: "Invitation code accepted",
  invite_code_failure: "Invitation code failed",
  invite_code_rate_limited: "Invitation attempts limited",
  registration_request: "Account requested",
  registration_rejected_input: "Account request invalid",
  login_success: "Signed in",
  login_failure: "Sign-in failed",
  login_rate_limited: "Sign-in attempts limited",
  login_blocked_status: "Sign-in blocked (no access)",
  password_reset_request: "Password reset requested",
  session_activity: "Active session",
  logout: "Signed out",
};

export function StatTile({ label, value, tone }: { label: string; value: number | string | undefined; tone?: "warn" | "danger" }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("mt-1 font-display text-2xl font-semibold tabular-nums", tone === "warn" && "text-warning", tone === "danger" && "text-danger")}>{value ?? "—"}</p>
    </div>
  );
}

export function Table({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface"><table className="w-full min-w-[640px] text-sm">{children}</table></div>;
}
export const Th = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <th className={cn("border-b border-line bg-canvas px-3 py-2 text-left text-xs font-medium text-muted", className)}>{children}</th>
);
export const Td = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <td className={cn("border-b border-line px-3 py-2 align-top", className)}>{children}</td>
);
