import * as React from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, Info } from "lucide-react";
import { rpc } from "@/lib/api";
import { BD_KINDS } from "@/lib/bd";
import { DASHBOARDS, STATUS_LABEL } from "@/lib/dashboards";
import type { BdKind } from "@/lib/types";
import { cn, formatMoney } from "@/lib/utils";
import { SEGMENT_LABEL, unitPath } from "@/hooks/useUnit";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Notice, Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { EmptyState, PageHeader } from "@/components/collab/common";

type Segment = "corporate" | "government";
interface ExecUnit {
  id: string; slug: string; name: string; short_name: string; segment: Segment;
  members: number; pending: number; contributions: Record<string, number>; comments: number; roadmap: Record<string, number>;
}
interface HealthRow { scope: "unit" | "segment"; key: string; category_key: string; label: string; respondents: number; suppressed: boolean; avg: number | null; excluded_units?: string[] }
interface PriorityRow { scope: "unit" | "segment"; key: string; factor_key: string; label: string; respondents: number; suppressed: boolean; importance: number | null; experience: number | null }
interface BdRow { unit_id: string; segment: Segment; kind: BdKind; category: string; n: number; value_2026: number | null; value_2027: number | null; unowned: number; high: number }
interface ExecSummary {
  threshold: number;
  units: ExecUnit[];
  health: HealthRow[];
  priorities: PriorityRow[];
  top_barriers: { id: string; title: string; unit_slug: string; unit: string; segment: Segment; resonates: number; top: number; comments: number }[];
  roadmap_active: { id: string; title: string; unit_slug: string; unit: string; segment: Segment; timeframe: number; status: string; owner: string | null }[];
  bd: BdRow[];
  bd_overlaps: { kind: BdKind; name: string; units: string[] }[];
}

const SEGMENTS: Segment[] = ["corporate", "government"];
const SEG_COLOR: Record<Segment, string> = { corporate: "var(--color-brand)", government: "var(--color-d1)" };
const sumObj = (o: Record<string, number> | undefined) => Object.values(o ?? {}).reduce((a, b) => a + Number(b), 0);

export default function Exec() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["exec-summary"],
    refetchInterval: 60_000,
    queryFn: () => rpc<ExecSummary>("get_exec_summary"),
  });
  if (isLoading) return <Spinner />;
  if (error || !data) return <EmptyState title="We couldn't load the Executive View">{(error as Error)?.message}</EmptyState>;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Executive View"
        title="Corporate Solutions & Government Solutions"
        subtitle="A combined picture across every business unit. Government Solutions includes Government Advisory, EM & Disaster Recovery, Caribe, and WOB Admin."
      />
      <SegmentCards d={data} />
      <Participation d={data} />
      <Health d={data} />
      <Priorities d={data} />
      <div className="grid gap-4 lg:grid-cols-2">
        <TopBarriers d={data} />
        <RoadmapInMotion d={data} />
      </div>
      <BdRollup d={data} />
      <p className="flex items-start gap-2 text-xs text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Ratings and rankings appear only where at least {data.threshold} people have responded. Segment totals leave out any unit
        below that number, so no unit's answers can be worked out by subtraction. Individual answers are never shown here.
      </p>
    </div>
  );
}

function SegmentCards({ d }: { d: ExecSummary }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {SEGMENTS.map((seg) => {
        const units = d.units.filter((u) => u.segment === seg);
        const bd = d.bd.filter((b) => b.segment === seg);
        const clients = bd.filter((b) => b.kind === "client");
        const target = clients.reduce((s, b) => s + Number(b.value_2027 ?? 0), 0);
        const spend = bd.filter((b) => b.kind !== "client").reduce((s, b) => s + Number(b.value_2027 ?? 0), 0);
        const active = units.reduce((s, u) => s + Number(u.roadmap.agreed ?? 0) + Number(u.roadmap.in_progress ?? 0), 0);
        return (
          <Card key={seg} className="overflow-hidden">
            <div className="h-1" style={{ background: SEG_COLOR[seg] }} aria-hidden />
            <CardHeader>
              <CardTitle>{SEGMENT_LABEL[seg]}</CardTitle>
              <CardDescription>{units.map((u) => u.short_name).join(" · ")}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                <Stat label="Members" value={units.reduce((s, u) => s + u.members, 0)} />
                <Stat label="Contributions" value={units.reduce((s, u) => s + sumObj(u.contributions), 0)} />
                <Stat label="Actions under way" value={active} />
                <Stat label="2027 clients" value={clients.reduce((s, b) => s + b.n, 0)} />
                <Stat label="2027 client target" value={formatMoney(target, true)} />
                <Stat label="2027 events & associations" value={formatMoney(spend, true)} />
              </dl>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-display text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Participation({ d }: { d: ExecSummary }) {
  return (
    <section>
      <h2 className="mb-3 font-display text-lg font-semibold">Participation by unit</h2>
      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-line bg-canvas text-left text-xs text-muted">
              <th className="px-3 py-2 font-medium">Business unit</th>
              <th className="px-2 py-2 text-right font-medium">Members</th>
              {DASHBOARDS.map((x) => <th key={x.n} className="px-2 py-2 text-right font-medium" title={x.question}>Q{x.n}</th>)}
              <th className="px-2 py-2 text-right font-medium">Comments</th>
              <th className="px-2 py-2 text-right font-medium">Actions agreed / under way / done</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {SEGMENTS.map((seg) => (
              <React.Fragment key={seg}>
                <tr className="bg-canvas/50"><td colSpan={10} className="px-3 py-1.5 text-xs font-semibold" style={{ color: SEG_COLOR[seg] }}>{SEGMENT_LABEL[seg]}</td></tr>
                {d.units.filter((u) => u.segment === seg).map((u) => (
                  <tr key={u.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">{u.name}{u.pending > 0 && <Badge tone="warn" className="ml-2">{u.pending} pending</Badge>}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{u.members}</td>
                    {DASHBOARDS.map((x) => <td key={x.n} className="px-2 py-2 text-right tabular-nums text-ink-soft">{u.contributions[x.n] ?? 0}</td>)}
                    <td className="px-2 py-2 text-right tabular-nums text-ink-soft">{u.comments}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink-soft">{u.roadmap.agreed ?? 0} / {u.roadmap.in_progress ?? 0} / {u.roadmap.completed ?? 0}</td>
                    <td className="px-2 py-2 text-right"><Link to={unitPath(u.slug)} className="inline-flex items-center gap-1 text-brand hover:underline">Open <ArrowRight className="size-3.5" aria-hidden /></Link></td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Health({ d }: { d: ExecSummary }) {
  const cats = [...new Map(d.health.map((h) => [h.category_key, h.label])).entries()];
  const seg = (s: Segment, k: string) => d.health.find((h) => h.scope === "segment" && h.key === s && h.category_key === k);
  const unit = (id: string, k: string) => d.health.find((h) => h.scope === "unit" && h.key === id && h.category_key === k);
  const chart = cats.map(([k, label]) => ({
    label,
    [SEGMENT_LABEL.corporate]: seg("corporate", k)?.avg ?? null,
    [SEGMENT_LABEL.government]: seg("government", k)?.avg ?? null,
  }));
  const anyShown = d.health.some((h) => h.scope === "segment" && !h.suppressed);
  const excluded = [...new Set(d.health.filter((h) => h.scope === "segment").flatMap((h) => h.excluded_units ?? []))];
  return (
    <Card>
      <CardHeader>
        <CardTitle>How are we doing? — organizational health</CardTitle>
        <CardDescription>Average 1–10 ratings from each unit's own members.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!anyShown ? (
          <p className="text-sm text-muted">Results appear once at least {d.threshold} people in a unit have rated it.</p>
        ) : (
          <div className="h-80" role="img" aria-label={chart.map((c) => `${c.label}: Corporate ${c[SEGMENT_LABEL.corporate] ?? "n/a"}, Government ${c[SEGMENT_LABEL.government] ?? "n/a"}`).join("; ")}>
            <ResponsiveContainer>
              <BarChart data={chart} layout="vertical" margin={{ left: 8, right: 16 }} barGap={2}>
                <CartesianGrid horizontal={false} stroke="var(--color-line)" />
                <XAxis type="number" domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fontSize: 11, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" width={180} tick={{ fontSize: 12, fill: "var(--color-ink-soft)" }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "var(--color-canvas)" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey={SEGMENT_LABEL.corporate} fill={SEG_COLOR.corporate} radius={[0, 4, 4, 0]} barSize={9} isAnimationActive={false} />
                <Bar dataKey={SEGMENT_LABEL.government} fill={SEG_COLOR.government} radius={[0, 4, 4, 0]} barSize={9} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {excluded.length > 0 && anyShown && (
          <Notice>Not enough responses yet to include in the segment totals for some categories: {excluded.join(", ")}.</Notice>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Average ratings by unit</caption>
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1.5 pr-2 font-medium">Category</th>
                {d.units.map((u) => <th key={u.id} className="px-2 py-1.5 text-right font-medium">{u.short_name}</th>)}
              </tr>
            </thead>
            <tbody>
              {cats.map(([k, label]) => (
                <tr key={k} className="border-t border-line">
                  <td className="py-1.5 pr-2">{label}</td>
                  {d.units.map((u) => {
                    const h = unit(u.id, k);
                    return (
                      <td key={u.id} className="px-2 py-1.5 text-right tabular-nums">
                        {h && !h.suppressed && h.avg != null ? <HeatCell v={Number(h.avg)} /> : <span className="text-xs text-muted">{h?.respondents ? `${h.respondents} so far` : "—"}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function HeatCell({ v }: { v: number }) {
  const tone = v >= 7 ? "bg-d3-soft text-success" : v >= 5 ? "bg-d2-soft text-warning" : "bg-danger-soft text-danger";
  return <span className={cn("inline-block min-w-10 rounded-md px-1.5 py-0.5 text-center font-medium", tone)}>{v.toFixed(1)}</span>;
}

function Priorities({ d }: { d: ExecSummary }) {
  const factors = [...new Map(d.priorities.map((p) => [p.factor_key, p.label])).entries()];
  const seg = (s: Segment, k: string) => d.priorities.find((p) => p.scope === "segment" && p.key === s && p.factor_key === k);
  const shown = d.priorities.some((p) => p.scope === "segment" && !p.suppressed);
  const rows = factors
    .map(([k, label]) => ({ k, label, c: seg("corporate", k), g: seg("government", k) }))
    .sort((a, b) => Number(b.g?.importance ?? b.c?.importance ?? 0) - Number(a.g?.importance ?? a.c?.importance ?? 0));
  const cell = (p?: PriorityRow) =>
    p && !p.suppressed && p.importance != null ? (
      <span className="tabular-nums">
        {Number(p.importance).toFixed(1)}
        {p.experience != null && (
          <span className={cn("ml-2 text-xs", Number(p.importance) - Number(p.experience) >= 3 ? "font-semibold text-danger" : "text-muted")}>
            provided {Number(p.experience).toFixed(1)}
          </span>
        )}
      </span>
    ) : <span className="text-xs text-muted">—</span>;
  return (
    <Card>
      <CardHeader>
        <CardTitle>What matters most — and how well we provide it</CardTitle>
        <CardDescription>Importance from people's private rankings (0–10). "Provided" is how well they say we deliver it, on the same scale. Gaps of 3+ are highlighted.</CardDescription>
      </CardHeader>
      <CardContent>
        {!shown ? <p className="text-sm text-muted">Results appear once at least {d.threshold} people in a unit have completed their ranking.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1.5 pr-2 font-medium">Factor</th>
                  <th className="px-2 py-1.5 font-medium" style={{ color: SEG_COLOR.corporate }}>{SEGMENT_LABEL.corporate}</th>
                  <th className="px-2 py-1.5 font-medium" style={{ color: SEG_COLOR.government }}>{SEGMENT_LABEL.government}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.k} className="border-t border-line">
                    <td className="py-1.5 pr-2">{r.label}</td>
                    <td className="px-2 py-1.5">{cell(r.c)}</td>
                    <td className="px-2 py-1.5">{cell(r.g)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TopBarriers({ d }: { d: ExecSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What's getting in the way — most supported</CardTitle>
        <CardDescription>Across all units, ranked by "this resonates" and "most significant".</CardDescription>
      </CardHeader>
      <CardContent>
        {d.top_barriers.length === 0 ? <p className="text-sm text-muted">No issues raised yet.</p> : (
          <ol className="flex flex-col gap-2.5">
            {d.top_barriers.map((b) => (
              <li key={b.id} className="flex items-start gap-2 text-sm">
                <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: SEG_COLOR[b.segment] }} aria-hidden />
                <span className="flex-1">
                  <Link to={`${unitPath(b.unit_slug, "in-our-way")}?item=${b.id}`} className="hover:underline">{b.title}</Link>
                  <span className="block text-xs text-muted">{b.unit} · {b.resonates} resonate{b.top ? ` · ${b.top} significant` : ""} · {b.comments} comments</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function RoadmapInMotion({ d }: { d: ExecSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What we're building — agreed and under way</CardTitle>
        <CardDescription>60/90/120-day actions across units.</CardDescription>
      </CardHeader>
      <CardContent>
        {d.roadmap_active.length === 0 ? <p className="text-sm text-muted">Nothing agreed yet.</p> : (
          <ul className="flex flex-col gap-2.5">
            {d.roadmap_active.map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-sm">
                <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: SEG_COLOR[r.segment] }} aria-hidden />
                <span className="flex-1">
                  <Link to={`${unitPath(r.unit_slug, "build")}?item=${r.id}`} className="hover:underline">{r.title}</Link>
                  <span className="block text-xs text-muted">{r.unit} · {r.timeframe} days · {STATUS_LABEL[r.status]}{r.owner ? ` · ${r.owner}` : " · no owner yet"}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BdRollup({ d }: { d: ExecSummary }) {
  const kinds: BdKind[] = ["client", "association", "conference"];
  return (
    <section>
      <h2 className="mb-1 font-display text-lg font-semibold">2027 Business Development</h2>
      <p className="mb-4 text-sm text-ink-soft">Counts and dollars by category. Dropped items are excluded.</p>
      <Tabs defaultValue="client">
        <TabsList>{kinds.map((k) => <TabsTrigger key={k} value={k}>{BD_KINDS[k].label}</TabsTrigger>)}</TabsList>
        {kinds.map((k) => <TabsContent key={k} value={k}><BdTable d={d} kind={k} /></TabsContent>)}
      </Tabs>
      {d.bd_overlaps.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Shared across units</CardTitle>
            <CardDescription>The same name appears in more than one unit's plan — worth coordinating who leads.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {d.bd_overlaps.map((o) => (
                <li key={`${o.kind}-${o.name}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone="outline">{BD_KINDS[o.kind].singular}</Badge>
                  <span className="font-medium">{o.name}</span>
                  <span className="text-muted">{o.units.join(", ")}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function BdTable({ d, kind }: { d: ExecSummary; kind: BdKind }) {
  const cfg = BD_KINDS[kind];
  const rows = d.bd.filter((b) => b.kind === kind);
  const agg = (filter: (b: BdRow) => boolean) => {
    const r = rows.filter(filter);
    return {
      byCat: Object.fromEntries(cfg.categories.map((c) => [c.value, r.filter((b) => b.category === c.value).reduce((s, b) => s + b.n, 0)])),
      n: r.reduce((s, b) => s + b.n, 0),
      v26: r.reduce((s, b) => s + Number(b.value_2026 ?? 0), 0),
      v27: r.reduce((s, b) => s + Number(b.value_2027 ?? 0), 0),
      unowned: r.reduce((s, b) => s + b.unowned, 0),
    };
  };
  const line = (label: React.ReactNode, a: ReturnType<typeof agg>, strong = false, slug?: string) => (
    <tr className={cn("border-b border-line last:border-0", strong && "bg-canvas font-semibold")}>
      <td className="px-3 py-2">{label}</td>
      {cfg.categories.map((c) => <td key={c.value} className="px-2 py-2 text-right tabular-nums">{a.byCat[c.value] || <span className="text-muted">0</span>}</td>)}
      <td className="px-2 py-2 text-right tabular-nums">{a.n}</td>
      <td className="px-2 py-2 text-right tabular-nums">{formatMoney(a.v26)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{formatMoney(a.v27)}</td>
      <td className={cn("px-2 py-2 text-right tabular-nums", a.unowned > 0 && "text-warning")}>{a.unowned}</td>
      <td className="px-2 py-2 text-right">{slug && <Link to={`${unitPath(slug, "planning")}?tab=${kind}`} className="text-brand hover:underline">Open</Link>}</td>
    </tr>
  );
  if (rows.length === 0) return <p className="text-sm text-muted">No {cfg.label.toLowerCase()} in any unit's plan yet.</p>;
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-line bg-canvas text-left text-xs text-muted">
            <th className="px-3 py-2 font-medium">Business unit</th>
            {cfg.categories.map((c) => <th key={c.value} className="px-2 py-2 text-right font-medium">{c.label}</th>)}
            <th className="px-2 py-2 text-right font-medium">Total</th>
            <th className="px-2 py-2 text-right font-medium">{cfg.value2026}</th>
            <th className="px-2 py-2 text-right font-medium">{cfg.value2027}</th>
            <th className="px-2 py-2 text-right font-medium">No owner</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {SEGMENTS.map((seg) => (
            <React.Fragment key={seg}>
              {d.units.filter((u) => u.segment === seg).map((u) => (
                <React.Fragment key={u.id}>{line(u.short_name, agg((b) => b.unit_id === u.id), false, u.slug)}</React.Fragment>
              ))}
              {line(<span style={{ color: SEG_COLOR[seg] }}>{SEGMENT_LABEL[seg]} total</span>, agg((b) => b.segment === seg), true)}
            </React.Fragment>
          ))}
          {line("All units", agg(() => true), true)}
        </tbody>
      </table>
    </div>
  );
}
