import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp, GripVertical, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { rpc, unwrap } from "@/lib/api";
import { DASHBOARDS } from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { useAction, useItemBoard, usePrioritySummary } from "@/hooks/data";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { PageHeader, SectionHeader, SuppressedNote } from "@/components/collab/common";
import { ContributionBoard } from "@/components/collab/ContributionBoard";

const D = DASHBOARDS[3];
type Factor = { id: string; key: string; label: string; sort: number };

export default function Matters() {
  const [tab, setTab] = React.useState("rank");
  const linked = useItemBoard();
  React.useEffect(() => { if (linked === "excited") setTab("excited"); }, [linked]);
  return (
    <div>
      <PageHeader dashboard={D} title={D.question} subtitle={D.subtitle} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="rank">My priorities</TabsTrigger>
          <TabsTrigger value="group">See what others think</TabsTrigger>
          <TabsTrigger value="excited">What would excite you?</TabsTrigger>
        </TabsList>
        <TabsContent value="rank"><MyPriorities onDone={() => setTab("group")} /></TabsContent>
        <TabsContent value="group"><GroupView /></TabsContent>
        <TabsContent value="excited">
          <SectionHeader title="What would make you genuinely excited about our future?" />
          <ContributionBoard
            board="excited" heading="Share your answer" prompt="What would make you genuinely excited about our future?"
            titleLabel="Your answer" addLabel="Share your answer" allowAnonymous
            emptyTitle="No answers yet" emptyText="Share by name or anonymously." enableNominate layout="list"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function useFactors() {
  return useQuery({
    queryKey: ["factors"],
    queryFn: async () => unwrap(await supabase.from("priority_factors").select("id, key, label, sort").eq("active", true).order("sort")) as Factor[],
  });
}

function MyPriorities({ onDone }: { onDone: () => void }) {
  const { canContribute, profile } = useAuth();
  const factors = useFactors();
  const mine = useQuery({
    queryKey: ["my-priorities", profile?.id],
    queryFn: async () => {
      const [r, e] = await Promise.all([
        supabase.from("priority_rankings").select("factor_id, rank").order("rank"),
        supabase.from("priority_experience_ratings").select("factor_id, score"),
      ]);
      return {
        ranks: unwrap(r) as { factor_id: string; rank: number }[],
        exp: unwrap(e) as { factor_id: string; score: number }[],
      };
    },
  });
  const [order, setOrder] = React.useState<string[]>([]);
  const [exp, setExp] = React.useState<Record<string, number>>({});
  React.useEffect(() => {
    if (!factors.data || !mine.data) return;
    const ranked = mine.data.ranks.map((r) => r.factor_id).filter((id) => factors.data.some((f) => f.id === id));
    const rest = factors.data.map((f) => f.id).filter((id) => !ranked.includes(id));
    setOrder(ranked.length === factors.data.length ? ranked : [...ranked, ...rest]);
    setExp(Object.fromEntries(mine.data.exp.map((x) => [x.factor_id, x.score])));
  }, [factors.data, mine.data]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (e.over && e.active.id !== e.over.id) {
      setOrder((o) => arrayMove(o, o.indexOf(String(e.active.id)), o.indexOf(String(e.over!.id))));
    }
  };
  const move = (i: number, d: -1 | 1) => setOrder((o) => (i + d < 0 || i + d >= o.length ? o : arrayMove(o, i, i + d)));

  const save = useAction(async () => {
    await rpc("submit_priority_ranking", { p_factor_ids: order });
    const ratings = Object.entries(exp).map(([factor_id, score]) => ({ factor_id, score }));
    if (ratings.length) await rpc("submit_experience_ratings", { p_ratings: ratings });
  }, { success: "Your priorities are saved — only you can see them", invalidate: [["my-priorities"], ["priority-summary"]] });

  if (factors.isLoading || mine.isLoading) return <Spinner />;
  const byId = Object.fromEntries((factors.data ?? []).map((f) => [f.id, f]));
  const hasRanking = (mine.data?.ranks.length ?? 0) > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>What matters most to you?</CardTitle>
          <CardDescription className="flex items-center gap-1.5">
            <Lock className="size-3.5" aria-hidden /> Drag to rank, most important at the top — or use the arrows. Your ranking is private; the group only sees combined results.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <ol className="flex flex-col gap-2" aria-label="Your priority ranking">
                {order.map((id, i) => (
                  <SortableRow key={id} id={id} index={i} label={byId[id]?.label ?? ""} total={order.length} disabled={!canContribute}
                    onUp={() => move(i, -1)} onDown={() => move(i, 1)} />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>How well are we doing at providing these?</CardTitle>
          <CardDescription>1 = not at all, 5 = very well. Optional, and private.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {(factors.data ?? []).map((f) => (
            <fieldset key={f.id} className="flex flex-col gap-1.5">
              <legend className="mb-1 text-sm">{f.label}</legend>
              <div className="flex gap-1.5" role="radiogroup">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={exp[f.id] === n}
                    aria-label={`${n} of 5`}
                    disabled={!canContribute}
                    onClick={() => setExp({ ...exp, [f.id]: n })}
                    className={cn("h-8 flex-1 rounded-md border text-sm tabular-nums transition-colors",
                      exp[f.id] === n ? "border-d4 bg-d4 text-white" : "border-line-strong bg-surface hover:bg-canvas")}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
        </CardContent>
      </Card>

      {canContribute && (
        <div className="flex flex-wrap items-center gap-3 lg:col-span-5">
          <Button variant="brand" size="lg" loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onDone })}>
            {hasRanking ? "Update my priorities" : "Save my priorities"}
          </Button>
          <p className="text-sm text-muted">You can come back and change this any time.</p>
        </div>
      )}
    </div>
  );
}

function SortableRow({ id, index, label, total, disabled, onUp, onDown }: { id: string; index: number; label: string; total: number; disabled: boolean; onUp: () => void; onDown: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5", isDragging && "z-10 shadow-[var(--shadow-pop)]")}
    >
      <button className="cursor-grab touch-none rounded p-1 text-muted hover:bg-canvas active:cursor-grabbing" aria-label={`Drag to reorder ${label}`} {...attributes} {...listeners}>
        <GripVertical className="size-4" />
      </button>
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-d4-soft text-xs font-semibold text-d4">{index + 1}</span>
      <span className="flex-1 text-sm">{label}</span>
      <div className="flex gap-0.5">
        <Button size="icon" variant="ghost" className="size-8" onClick={onUp} disabled={disabled || index === 0} aria-label={`Move ${label} up`}><ArrowUp /></Button>
        <Button size="icon" variant="ghost" className="size-8" onClick={onDown} disabled={disabled || index === total - 1} aria-label={`Move ${label} down`}><ArrowDown /></Button>
      </div>
    </li>
  );
}

function GroupView() {
  const { settings } = useAuth();
  const { data, isLoading } = usePrioritySummary();
  if (isLoading) return <Spinner />;
  const rows = data ?? [];
  const threshold = settings?.privacy_threshold ?? 3;
  const ranked = rows.filter((r) => !r.rank_suppressed).sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
  if (ranked.length === 0) {
    return <Card><CardContent className="pt-5"><SuppressedNote n={rows[0]?.rank_respondents ?? 0} threshold={threshold} /></CardContent></Card>;
  }
  const expShown = rows.some((r) => !r.experience_suppressed);
  const compare = ranked.map((r) => ({
    name: r.label,
    Importance: r.importance,
    // Experience 1–5 rescaled to 0–10 so the two bars share an axis
    "How well we provide it": r.experience_suppressed || r.avg_experience == null ? null : Math.round(((Number(r.avg_experience) - 1) / 4) * 100) / 10,
  }));
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Group priorities</CardTitle>
          <CardDescription>Based on {ranked[0].rank_respondents} rankings. Importance is scaled 0–10 (ranked first by everyone = 10).</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-2.5">
            {ranked.map((r, i) => (
              <li key={r.factor_id} className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[1.5rem_16rem_1fr_auto]">
                <span className="text-xs text-muted">{i + 1}</span>
                <span>{r.label}</span>
                <span className="hidden h-2 overflow-hidden rounded-full bg-canvas sm:block" aria-hidden>
                  <span className="block h-full rounded-full bg-d4" style={{ width: `${(Number(r.importance) / 10) * 100}%` }} />
                </span>
                <span className="text-xs tabular-nums text-muted">{r.importance}/10 · top-3 for {r.top3_count}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>What matters vs. how well we provide it</CardTitle>
          <CardDescription>Where the gap is widest is where to look first. Both on a 0–10 scale.</CardDescription>
        </CardHeader>
        <CardContent>
          {!expShown ? <SuppressedNote n={rows[0]?.experience_respondents ?? 0} threshold={threshold} /> : (
            <div className="h-96" role="img" aria-label={compare.map((c) => `${c.name}: importance ${c.Importance}, provided ${c["How well we provide it"] ?? "n/a"}`).join("; ")}>
              <ResponsiveContainer>
                <BarChart data={compare} layout="vertical" margin={{ left: 8, right: 16 }} barGap={2}>
                  <CartesianGrid horizontal={false} stroke="var(--color-line)" />
                  <XAxis type="number" domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fontSize: 11, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={190} tick={{ fontSize: 12, fill: "var(--color-ink-soft)" }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "var(--color-canvas)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Importance" fill="var(--color-d4)" radius={[0, 4, 4, 0]} barSize={10} isAnimationActive={false} />
                  <Bar dataKey="How well we provide it" fill="var(--color-brand)" radius={[0, 4, 4, 0]} barSize={10} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
