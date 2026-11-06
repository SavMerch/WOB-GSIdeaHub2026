import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Briefcase, CalendarClock, Ear, Hammer, Heart, MessagesSquare, Sparkles, Users } from "lucide-react";
import { rpc } from "@/lib/api";
import { DASHBOARDS, dashboardByN, itemHref } from "@/lib/dashboards";
import { addDays, cn, formatDate, timeAgo } from "@/lib/utils";
import { useActivity, usePrioritySummary, useRecentContributions, useRoadmap, useTopContributions } from "@/hooks/data";
import { useAuth } from "@/hooks/useAuth";
import { unitPath, useUnit } from "@/hooks/useUnit";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { PresenceStrip } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/collab/common";

interface HomeSummary {
  active_participants: number;
  members: number;
  contributions_by_dashboard: Record<string, number>;
  roadmap_by_status: Record<string, number>;
  themes: { label: string; board: string; n: number }[];
  bd_by_kind: Record<string, number>;
  roadmap_start_date: string;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

function SynthesisNote() {
  return <p className="mt-3 text-[11px] text-muted">A draft picture from what's been shared so far — not a group conclusion.</p>;
}

export default function Home() {
  const { profile, settings } = useAuth();
  const unit = useUnit();
  const at = (sub: string) => unitPath(unit.slug, sub);
  const summary = useQuery({
    queryKey: ["home", "summary", unit.id],
    queryFn: () => rpc<HomeSummary>("get_home_summary", { p_unit_id: unit.id }),
    refetchInterval: 60_000,
  });
  const priorities = usePrioritySummary(unit.id);
  const potential = useTopContributions(unit.id, ["grow", "known_for"], 4);
  const hearing = useTopContributions(unit.id, ["honest_working", "honest_unsaid", "barriers"], 4);
  const recent = useRecentContributions(unit.id, 5, "created_at");
  const discussions = useRecentContributions(unit.id, 5, "last_activity_at");
  const roadmap = useRoadmap(unit.id);
  const activity = useActivity(unit.id, 12);

  const s = summary.data;
  const working = (roadmap.data ?? []).filter((r) => ["agreed", "in_progress"].includes(r.status));
  const topPriorities = (priorities.data ?? []).filter((p) => !p.rank_suppressed && p.importance != null)
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0)).slice(0, 3);
  const prioritiesWaiting = (priorities.data ?? []).every((p) => p.rank_suppressed);
  const start = s?.roadmap_start_date ?? settings?.roadmap_start_date;
  const milestones = start
    ? ([60, 90, 120] as const).map((d) => ({
        days: d,
        date: addDays(start, d),
        items: (roadmap.data ?? []).filter((r) => r.timeframe === d && r.status !== "completed").length,
      }))
    : [];
  const dated = (roadmap.data ?? []).filter((r) => r.target_date && r.status !== "completed" && new Date(r.target_date) >= new Date(Date.now() - 86400000))
    .sort((a, b) => a.target_date!.localeCompare(b.target_date!)).slice(0, 4);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="eyebrow mb-2 text-brand">Where We're Headed · {unit.name}</p>
          <h1 className="text-2xl font-semibold sm:text-3xl">Welcome back, {profile?.username}.</h1>
          <p className="mt-2 text-ink-soft">{settings?.welcome_message}</p>
          <p className="mt-1 text-sm text-muted">A picture of what we're building together.</p>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <PresenceStrip />
          {s && <p className="flex items-center gap-1.5 text-xs text-muted"><Users className="size-3.5" aria-hidden /> {s.active_participants} active in the last 5 minutes · {s.members} members</p>}
        </div>
      </header>

      {/* Five questions */}
      <nav aria-label="The five questions" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {DASHBOARDS.map((d) => (
          <Link key={d.n} to={at(d.path)} className={cn("group flex flex-col justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 transition-shadow hover:shadow-[var(--shadow-pop)]")}>
            <span className={cn("grid size-8 place-items-center rounded-lg", d.accent.soft, d.accent.text)}><d.icon className="size-4" aria-hidden /></span>
            <span className="text-sm font-medium leading-snug">{d.question}</span>
            <span className="flex items-center justify-between text-xs text-muted">
              {s?.contributions_by_dashboard?.[d.n] ?? 0} contributions
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </span>
          </Link>
        ))}
      </nav>

      <Link to={at("planning")} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4 transition-shadow hover:shadow-[var(--shadow-pop)] sm:flex-row sm:items-center">
        <span className="flex items-center gap-2 font-medium"><Briefcase className="size-4 text-brand" aria-hidden /> 2027 Business Development</span>
        <span className="text-sm text-muted sm:ml-auto">
          {s?.bd_by_kind?.client ?? 0} clients · {s?.bd_by_kind?.association ?? 0} associations · {s?.bd_by_kind?.conference ?? 0} conferences
        </span>
        <ArrowRight className="hidden size-4 text-muted sm:block" aria-hidden />
      </Link>

      {/* Four primary cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Ear className="size-4 text-d1" aria-hidden /> What We're Hearing</CardTitle>
            <CardDescription>Common themes emerging from discussions.</CardDescription>
          </CardHeader>
          <CardContent>
            {s && s.themes.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {s.themes.map((t) => <Badge key={t.board + t.label} tone="outline">{t.label} · {t.n}</Badge>)}
              </div>
            )}
            {(hearing.data ?? []).length === 0 ? (
              <Empty>Nothing yet. Themes will appear here as people share what's working and what's in the way.</Empty>
            ) : (
              <ul className="flex flex-col gap-2">
                {hearing.data!.map((c) => (
                  <li key={c.id}><Link className="text-sm hover:underline" to={itemHref(unit.slug, "contribution", c.id, c.board, c.dashboard)}>{c.title}</Link>
                    {c.resonates_count > 0 && <span className="ml-2 text-xs text-muted">{c.resonates_count} resonate</span>}</li>
                ))}
              </ul>
            )}
            {(hearing.data ?? []).length > 0 && <SynthesisNote />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Heart className="size-4 text-d4" aria-hidden /> What Matters to Us</CardTitle>
            <CardDescription>A collective view of the group's professional priorities.</CardDescription>
          </CardHeader>
          <CardContent>
            {prioritiesWaiting || topPriorities.length === 0 ? (
              <Empty>Group priorities appear once at least {settings?.privacy_threshold ?? 3} people have completed the ranking in <Link className="text-brand hover:underline" to={at("matters")}>What matters most to us?</Link></Empty>
            ) : (
              <ol className="flex flex-col gap-3">
                {topPriorities.map((p, i) => (
                  <li key={p.factor_id} className="flex items-center gap-3">
                    <span className="grid size-7 place-items-center rounded-full bg-d4-soft text-xs font-semibold text-d4">{i + 1}</span>
                    <span className="flex-1 text-sm">{p.label}</span>
                    <span className="text-xs text-muted">importance {p.importance}/10</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-d3" aria-hidden /> Where We See Potential</CardTitle>
            <CardDescription>Ideas and opportunities receiving attention.</CardDescription>
          </CardHeader>
          <CardContent>
            {(potential.data ?? []).length === 0 ? (
              <Empty>No ideas yet. Start one in <Link className="text-brand hover:underline" to={at("become")}>What could we become?</Link></Empty>
            ) : (
              <ul className="flex flex-col gap-2">
                {potential.data!.map((c) => (
                  <li key={c.id} className="flex items-center gap-2">
                    <Link className="flex-1 text-sm hover:underline" to={itemHref(unit.slug, "contribution", c.id, c.board, c.dashboard)}>{c.title}</Link>
                    {c.category && <Badge tone="outline">{c.category.label}</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Hammer className="size-4 text-d5" aria-hidden /> What We're Working On</CardTitle>
            <CardDescription>Shared next steps and commitments.</CardDescription>
          </CardHeader>
          <CardContent>
            {working.length === 0 ? (
              <Empty>Nothing agreed yet. Suggest a next step in <Link className="text-brand hover:underline" to={at("build")}>What are we willing to build together?</Link></Empty>
            ) : (
              <ul className="flex flex-col gap-2">
                {working.slice(0, 5).map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <Link className="flex-1 text-sm hover:underline" to={`${at("build")}?item=${r.id}`}>{r.title}</Link>
                    <Badge tone="outline">{r.timeframe} days</Badge>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Recently shared</CardTitle></CardHeader>
          <CardContent>
            {(recent.data ?? []).length === 0 ? <Empty>No contributions yet.</Empty> : (
              <ul className="flex flex-col gap-3">
                {recent.data!.map((c) => {
                  const d = dashboardByN(c.dashboard);
                  return (
                    <li key={c.id} className="flex gap-2">
                      <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded text-[10px] font-semibold", d.accent.soft, d.accent.text)}>{d.n}</span>
                      <div className="min-w-0">
                        <Link className="line-clamp-2 text-sm hover:underline" to={itemHref(unit.slug, "contribution", c.id, c.board, c.dashboard)}>{c.title}</Link>
                        <p className="text-xs text-muted">{c.is_anonymous ? "Anonymous" : c.author?.username} · {timeAgo(c.created_at)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><MessagesSquare className="size-4 text-muted" aria-hidden /> Active discussions</CardTitle></CardHeader>
          <CardContent>
            {(discussions.data ?? []).length === 0 ? <Empty>No discussions yet.</Empty> : (
              <ul className="flex flex-col gap-3">
                {discussions.data!.map((c) => (
                  <li key={c.id}>
                    <Link className="line-clamp-2 text-sm hover:underline" to={itemHref(unit.slug, "contribution", c.id, c.board, c.dashboard)}>{c.title}</Link>
                    <p className="text-xs text-muted">{c.comment_count} comments · {timeAgo(c.last_activity_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-4 text-muted" aria-hidden /> Upcoming milestones</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {milestones.map((m) => (
              <div key={m.days} className="flex items-center justify-between text-sm">
                <span>{m.days}-day checkpoint</span>
                <span className="text-muted">{formatDate(m.date)} · {m.items} open</span>
              </div>
            ))}
            {dated.length > 0 && <hr className="border-line" />}
            {dated.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                <Link to={`${at("build")}?item=${r.id}`} className="truncate hover:underline">{r.title}</Link>
                <span className="shrink-0 text-muted">{formatDate(r.target_date)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>What's been happening</CardTitle></CardHeader>
        <CardContent>
          {(activity.data ?? []).length === 0 ? <Empty>Activity will show here as people contribute.</Empty> : (
            <ul className="divide-y divide-line">
              {activity.data!.map((a) => (
                <li key={a.id} className="flex items-baseline gap-2 py-2 text-sm">
                  <span className="text-ink">
                    {a.actor ? <strong className="font-medium">{a.actor.username}</strong> : null} {a.summary}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted">{timeAgo(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
