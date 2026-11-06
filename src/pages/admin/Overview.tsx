import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { rpc, unwrap } from "@/lib/api";
import { DASHBOARDS } from "@/lib/dashboards";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { Badge, Card, CardContent, CardHeader, CardTitle, Spinner } from "@/components/ui/primitives";
import { EVENT_LABEL, StatTile, useAuthEvents } from "./shared";

interface OverviewData {
  total_users: number; active_users: number; online_now: number; pending: number; suspended: number;
  contributions_by_dashboard: Record<string, number>; contributions_last_7_days: number; comments_last_7_days: number;
  failed_logins_24h: number; unusual_24h: number; open_reports: number;
}

export function Overview() {
  const o = useQuery({ queryKey: ["admin-overview"], refetchInterval: 30_000, queryFn: () => rpc<OverviewData>("admin_overview") });
  const events = useAuthEvents("all", 8);
  const audit = useQuery({
    queryKey: ["admin-audit"],
    queryFn: async () => unwrap(await supabase.from("administrative_audit_logs").select("id, action, target_type, target_id, created_at, actor:profiles(username)").order("created_at", { ascending: false }).limit(10)) as any[],
  });
  if (o.isLoading) return <Spinner />;
  const d = o.data;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Total accounts" value={d?.total_users} />
        <StatTile label="Active members" value={d?.active_users} />
        <StatTile label="Online now" value={d?.online_now} />
        <StatTile label="Pending approval" value={d?.pending} tone={d?.pending ? "warn" : undefined} />
        <StatTile label="Suspended / removed" value={d?.suspended} />
        <StatTile label="Contributions (7 days)" value={d?.contributions_last_7_days} />
        <StatTile label="Failed access (24h)" value={d?.failed_logins_24h} tone={d?.failed_logins_24h ? "warn" : undefined} />
        <StatTile label="Unusual sign-ins (24h)" value={d?.unusual_24h} tone={d?.unusual_24h ? "danger" : undefined} />
      </div>
      {d?.pending ? <p className="text-sm"><Link className="font-medium text-brand hover:underline" to="/admin/people">Review {d.pending} pending request{d.pending > 1 ? "s" : ""} →</Link></p> : null}
      {d?.open_reports ? <p className="text-sm"><Link className="font-medium text-brand hover:underline" to="/admin/content">{d.open_reports} open content report{d.open_reports > 1 ? "s" : ""} →</Link></p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Contributions by dashboard</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {DASHBOARDS.map((x) => (
              <div key={x.n} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{x.n}. {x.question}</span>
                <span className="tabular-nums text-muted">{d?.contributions_by_dashboard?.[x.n] ?? 0}</span>
              </div>
            ))}
            <p className="pt-2 text-xs text-muted">{d?.comments_last_7_days ?? 0} comments in the last 7 days</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent security events</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {(events.data ?? []).map((e) => (
                <li key={e.id} className="flex items-start gap-2 text-sm">
                  <span className="flex-1">
                    {EVENT_LABEL[e.event_type] ?? e.event_type}
                    {(e.username || e.email) && <span className="text-muted"> · {e.username ?? e.email}</span>}
                    {e.unusual && <Badge tone="danger" className="ml-1">Unusual</Badge>}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{timeAgo(e.created_at)}</span>
                </li>
              ))}
            </ul>
            <Link to="/admin/security" className="mt-3 inline-block text-sm text-brand hover:underline">All activity →</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent administrative actions</CardTitle></CardHeader>
          <CardContent>
            {(audit.data ?? []).length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
              <ul className="flex flex-col gap-2">
                {audit.data!.map((a) => (
                  <li key={a.id} className="text-sm">
                    <span className="font-medium">{a.actor?.username ?? "system"}</span> <span className="text-ink-soft">{a.action}</span>
                    <span className="block text-xs text-muted">{formatDateTime(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
