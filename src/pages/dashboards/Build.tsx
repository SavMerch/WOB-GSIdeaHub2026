import * as React from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, Crown, HandHelping, Heart, MessageSquare, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { rpc, unwrap } from "@/lib/api";
import { DASHBOARDS, STATUS_LABEL, dashboardByN, itemHref } from "@/lib/dashboards";
import { addDays, cn, formatDate, newRequestId } from "@/lib/utils";
import type { RoadmapItem, RoadmapStatus } from "@/lib/types";
import { useAction, useFocusItems, useItemBoard, useMembers, useMyReactions, useRoadmap, useToggleReaction } from "@/hooks/data";
import { useAuth } from "@/hooks/useAuth";
import { useUnit } from "@/hooks/useUnit";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Spinner, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { EmptyState, PageHeader, SectionHeader, StatusBadge } from "@/components/collab/common";
import { CommentThread, RelatedItems } from "@/components/collab/Discussion";
import { ContributionBoard } from "@/components/collab/ContributionBoard";

const D = DASHBOARDS[4];
const COLUMNS = [
  { days: 60 as const, title: "60 Days", sub: "What can we fix first?" },
  { days: 90 as const, title: "90 Days", sub: "What can we build or improve?" },
  { days: 120 as const, title: "120 Days", sub: "What progress should we be seeing?" },
];
const STATUSES: RoadmapStatus[] = ["suggested", "discussing", "agreed", "in_progress", "completed"];

export default function Build() {
  const [tab, setTab] = React.useState(() => (new URLSearchParams(location.search).get("item") ? "roadmap" : "focus"));
  const linked = useItemBoard();
  React.useEffect(() => {
    if (linked === "expectations") setTab("each-other");
    else if (linked === "roadmap") setTab("roadmap");
  }, [linked]);
  return (
    <div>
      <PageHeader dashboard={D} title={D.question} subtitle={D.subtitle} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="focus">What should we focus on?</TabsTrigger>
          <TabsTrigger value="roadmap">60 · 90 · 120 days</TabsTrigger>
          <TabsTrigger value="each-other">What do we need from each other?</TabsTrigger>
        </TabsList>
        <TabsContent value="focus"><FocusList /></TabsContent>
        <TabsContent value="roadmap"><Roadmap /></TabsContent>
        <TabsContent value="each-other"><EachOther /></TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------
// A. What should we focus on?
// ---------------------------------------------------------------------
function FocusList() {
  const unit = useUnit();
  const { data, isLoading } = useFocusItems(unit.id);
  const { data: mine } = useMyReactions();
  const toggle = useToggleReaction();
  const { canContribute } = useAuth();
  const [suggestFrom, setSuggestFrom] = React.useState<string | null>(null);
  if (isLoading) return <Spinner />;
  return (
    <div>
      <SectionHeader letter="A" title="What Should We Focus On?" prompt="Ideas, challenges, and opportunities people have suggested as a focus. Show support, discuss, and turn them into next steps." />
      {(data ?? []).length === 0 ? (
        <EmptyState icon={Target} title="Nothing suggested yet">
          On any dashboard, open a card's menu and choose “Suggest as a focus” to bring it here.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {data!.map((c) => {
            const d = dashboardByN(c.dashboard);
            const supported = mine?.has(`support:${c.id}`);
            return (
              <li key={c.id}>
                <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", d.accent.soft, d.accent.text)}><d.icon className="size-4" aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <Link to={itemHref(unit.slug, "contribution", c.id, c.board, c.dashboard)} className="font-medium hover:underline">{c.title}</Link>
                    <p className="text-xs text-muted">From “{d.question}” · {c.comment_count} comments · {c.resonates_count} resonate</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant={supported ? "soft" : "outline"} aria-pressed={!!supported} disabled={!canContribute}
                      onClick={() => toggle.mutate({ id: c.id, kind: "support" })}>
                      <Heart className={cn(supported && "fill-current")} /> Support {c.support_count > 0 && <span className="tabular-nums">{c.support_count}</span>}
                    </Button>
                    {canContribute && <Button size="sm" variant="ghost" onClick={() => setSuggestFrom(c.id)}><Plus /> Suggest a next step</Button>}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <RoadmapForm open={!!suggestFrom} onOpenChange={(o) => !o && setSuggestFrom(null)} relatedId={suggestFrom ?? undefined} />
    </div>
  );
}

// ---------------------------------------------------------------------
// B. 60 / 90 / 120 day roadmap
// ---------------------------------------------------------------------
function Roadmap() {
  const unit = useUnit();
  const { data, isLoading } = useRoadmap(unit.id);
  const { canContribute, settings } = useAuth();
  const [params, setParams] = useSearchParams();
  const [form, setForm] = React.useState<{ open: boolean; timeframe?: 60 | 90 | 120; editing?: RoadmapItem }>({ open: false });
  const focusId = params.get("item");
  const items = (data ?? []).filter((r) => !r.archived);
  const counts = STATUSES.map((s) => ({ status: STATUS_LABEL[s], n: items.filter((i) => i.status === s).length }));

  if (isLoading) return <Spinner />;
  return (
    <div>
      <SectionHeader
        letter="B" title="What Can We Do in 60, 90, and 120 Days?"
        prompt={settings?.roadmap_start_date ? `Counting from ${formatDate(settings.roadmap_start_date)}.` : undefined}
        action={canContribute ? <Button variant="brand" onClick={() => setForm({ open: true })}><Plus /> Suggest a next step</Button> : undefined}
      />
      {items.length > 0 && (
        <Card className="mb-6">
          <CardContent className="pt-5">
            <div className="h-28" role="img" aria-label={counts.map((c) => `${c.status}: ${c.n}`).join(", ")}>
              <ResponsiveContainer>
                <BarChart data={counts} margin={{ left: 0, right: 8 }}>
                  <XAxis dataKey="status" tick={{ fontSize: 11, fill: "var(--color-ink-soft)" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} width={24} tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "var(--color-canvas)" }} />
                  <Bar dataKey="n" name="Actions" fill="var(--color-d5)" radius={[4, 4, 0, 0]} barSize={28} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNS.map((col) => {
          const colItems = items.filter((i) => i.timeframe === col.days);
          const due = settings?.roadmap_start_date ? addDays(settings.roadmap_start_date, col.days) : null;
          return (
            <section key={col.days} aria-label={`${col.title}: ${col.sub}`} className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-d5-soft/60 p-3">
              <header className="px-1 pt-1">
                <p className="eyebrow text-d5">{col.title}{due && <span className="ml-2 font-sans normal-case tracking-normal text-muted">by {formatDate(due, { month: "short", day: "numeric" })}</span>}</p>
                <h3 className="font-display text-sm font-semibold">{col.sub}</h3>
              </header>
              {colItems.length === 0 && <p className="px-1 py-6 text-center text-sm text-muted">Nothing here yet.</p>}
              {colItems.map((r) => (
                <RoadmapCard key={r.id} item={r} autoOpen={focusId === r.id}
                  onEdit={() => setForm({ open: true, editing: r })}
                  onClearFocus={() => { params.delete("item"); setParams(params, { replace: true }); }} />
              ))}
              {canContribute && (
                <Button variant="ghost" size="sm" onClick={() => setForm({ open: true, timeframe: col.days })}><Plus /> Add to {col.title}</Button>
              )}
            </section>
          );
        })}
      </div>
      <RoadmapForm open={form.open} onOpenChange={(o) => setForm({ open: o })} timeframe={form.timeframe} editing={form.editing} />
    </div>
  );
}

function RoadmapCard({ item: r, autoOpen, onEdit, onClearFocus }: { item: RoadmapItem; autoOpen?: boolean; onEdit: () => void; onClearFocus: () => void }) {
  const { profile, isAdmin, canContribute } = useAuth();
  const [open, setOpen] = React.useState(!!autoOpen);
  const ref = React.useRef<HTMLDivElement>(null);
  const unit = useUnit();
  const members = useMembers(unit.id);
  const me = r.contributors?.find((c) => c.user_id === profile?.id);
  const isOwner = r.owner_id === profile?.id;
  const canManage = isAdmin || isOwner;
  const canEdit = canManage || r.created_by === profile?.id;

  React.useEffect(() => {
    if (autoOpen && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
      ref.current.classList.add("lc-flash");
      const t = setTimeout(onClearFocus, 2500);
      return () => clearTimeout(t);
    }
  }, [autoOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const setStatus = useAction((s: string) => rpc("set_roadmap_status", { p_id: r.id, p_status: s }), { success: "Status updated", invalidate: [["roadmap"]] });
  const volunteer = useAction((role: string | null) => rpc("set_roadmap_volunteer", { p_id: r.id, p_role: role }), { invalidate: [["roadmap"]] });
  const setOwner = useAction((owner: string | null) => rpc("set_roadmap_owner", { p_id: r.id, p_owner_id: owner }), { success: "Owner updated", invalidate: [["roadmap"]] });
  const remove = useAction(() => rpc("delete_roadmap_item", { p_id: r.id }), { success: "Removed", invalidate: [["roadmap"]] });

  const allowed = STATUSES.filter((s) => canManage || ["suggested", "discussing"].includes(s));
  const lockedForMe = !canManage && ["agreed", "in_progress", "completed"].includes(r.status);
  const helpers = r.contributors?.filter((c) => c.role === "helper") ?? [];
  const offered = r.contributors?.filter((c) => c.role === "offered_to_lead") ?? [];

  return (
    <Card ref={ref} className="flex flex-col">
      <div className="flex flex-col gap-2.5 p-4">
        <div className="flex items-start gap-2">
          <h4 className="flex-1 text-sm font-semibold leading-snug">{r.title}</h4>
          <StatusBadge status={r.status} />
        </div>
        {r.description && <p className="whitespace-pre-wrap text-sm text-ink-soft">{r.description}</p>}
        {r.target_outcome && (
          <p className="rounded-lg bg-canvas px-3 py-2 text-sm"><span className="text-xs font-medium text-muted">Target outcome · </span>{r.target_outcome}</p>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1"><Crown className="size-3" aria-hidden /> {r.owner ? r.owner.username : "No owner yet"}</span>
          {r.target_date && <span>Target {formatDate(r.target_date)}</span>}
          {helpers.length > 0 && <span>Helping: {helpers.map((h) => h.profile?.username).join(", ")}</span>}
          {offered.length > 0 && <span>Offered to lead: {offered.map((h) => h.profile?.username).join(", ")}</span>}
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-line px-2 py-1.5">
        {canContribute && (
          <>
            <Button size="sm" variant={me?.role === "helper" ? "soft" : "ghost"} aria-pressed={me?.role === "helper"}
              onClick={() => volunteer.mutate(me?.role === "helper" ? null : "helper")}>
              <HandHelping /> {me?.role === "helper" ? "You're helping" : "I can help"}
            </Button>
            {!r.owner_id && (
              <Button size="sm" variant={me?.role === "offered_to_lead" ? "soft" : "ghost"} aria-pressed={me?.role === "offered_to_lead"}
                onClick={() => volunteer.mutate(me?.role === "offered_to_lead" ? null : "offered_to_lead")}>
                <Crown /> {me?.role === "offered_to_lead" ? "Offered to lead" : "Offer to lead"}
              </Button>
            )}
          </>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" aria-expanded={open} onClick={() => setOpen(!open)}>
          <MessageSquare /> {r.comment_count || ""} <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </div>
      {open && (
        <div className="flex flex-col gap-4 border-t border-line bg-canvas/50 p-4">
          {canContribute && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Status" htmlFor={`st-${r.id}`} hint={lockedForMe ? "Only the owner or an administrator can change this now." : !canManage ? "Agreed / In progress / Completed are set by the owner or an administrator." : undefined}>
                <Select id={`st-${r.id}`} value={r.status} disabled={lockedForMe || setStatus.isPending} onChange={(e) => setStatus.mutate(e.target.value)}>
                  {STATUSES.map((s) => <option key={s} value={s} disabled={!allowed.includes(s)}>{STATUS_LABEL[s]}</option>)}
                </Select>
              </Field>
              {isAdmin && (
                <Field label="Owner" htmlFor={`ow-${r.id}`}>
                  <Select id={`ow-${r.id}`} value={r.owner_id ?? ""} onChange={(e) => setOwner.mutate(e.target.value || null)}>
                    <option value="">No owner</option>
                    {(members.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.username}{offered.some((o) => o.user_id === m.id) ? " (offered)" : ""}</option>)}
                  </Select>
                </Field>
              )}
            </div>
          )}
          <CommentThread roadmapId={r.id} />
          <RelatedItems kind="roadmap" id={r.id} />
          <div className="flex gap-2">
            {canEdit && <Button size="sm" variant="outline" onClick={onEdit}><Pencil /> Edit</Button>}
            {(isAdmin || (r.created_by === profile?.id && r.status === "suggested")) && (
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => confirm("Remove this action and its discussion?") && remove.mutate(undefined)}>
                <Trash2 /> Remove
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function RoadmapForm({ open, onOpenChange, timeframe, editing, relatedId }: { open: boolean; onOpenChange: (o: boolean) => void; timeframe?: 60 | 90 | 120; editing?: RoadmapItem; relatedId?: string }) {
  const [v, setV] = React.useState({ title: "", description: "", timeframe: 60 as 60 | 90 | 120, target_outcome: "", target_date: "", related: "" });
  const unit = useUnit();
  const rid = React.useRef(newRequestId());
  const candidates = useQuery({
    queryKey: ["roadmap-related-candidates", unit.id],
    enabled: open && !editing,
    queryFn: async () => unwrap(await supabase.from("contributions").select("id, title, dashboard").eq("unit_id", unit.id).eq("hidden", false).eq("archived", false)
      .order("nominated_at", { ascending: false, nullsFirst: false }).order("resonates_count", { ascending: false }).limit(150)) as { id: string; title: string; dashboard: number }[],
  });
  React.useEffect(() => {
    if (!open) return;
    rid.current = newRequestId();
    setV({
      title: editing?.title ?? "", description: editing?.description ?? "",
      timeframe: editing?.timeframe ?? timeframe ?? 60, target_outcome: editing?.target_outcome ?? "",
      target_date: editing?.target_date ?? "", related: relatedId ?? "",
    });
  }, [open, editing, timeframe, relatedId]);
  const save = useAction(
    () => editing
      ? rpc("update_roadmap_item", { p_id: editing.id, p_expected_version: editing.version, p_title: v.title, p_description: v.description,
          p_timeframe: v.timeframe, p_target_outcome: v.target_outcome, p_target_date: v.target_date || null })
      : rpc("create_roadmap_item", { p_unit_id: unit.id, p_title: v.title, p_description: v.description, p_timeframe: v.timeframe, p_target_outcome: v.target_outcome,
          p_target_date: v.target_date || null, p_related_contribution_id: v.related || null, p_client_request_id: rid.current }),
    { success: editing ? "Saved" : "Next step suggested", invalidate: [["roadmap"], ["related"]], retry: !editing },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader title={editing ? "Edit next step" : "Suggest a next step"} description="Suggesting something doesn't make you its owner — others can volunteer, and an administrator confirms an owner." />
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (!save.isPending) save.mutate(undefined, { onSuccess: () => onOpenChange(false) }); }}>
          <Field label="What's the action?" htmlFor="r-title"><Input id="r-title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} maxLength={200} required autoFocus /></Field>
          <Field label="Description" htmlFor="r-desc"><Textarea id="r-desc" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} maxLength={4000} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Timeframe" htmlFor="r-tf">
              <Select id="r-tf" value={v.timeframe} onChange={(e) => setV({ ...v, timeframe: Number(e.target.value) as 60 | 90 | 120 })}>
                {COLUMNS.map((c) => <option key={c.days} value={c.days}>{c.title} — {c.sub}</option>)}
              </Select>
            </Field>
            <Field label="Target date (optional)" htmlFor="r-date"><Input id="r-date" type="date" value={v.target_date} onChange={(e) => setV({ ...v, target_date: e.target.value })} /></Field>
          </div>
          <Field label="Target outcome" htmlFor="r-out" hint="What would tell us this worked?"><Input id="r-out" value={v.target_outcome} onChange={(e) => setV({ ...v, target_outcome: e.target.value })} maxLength={1000} /></Field>
          {!editing && (
            <Field label="Related idea or issue (optional)" htmlFor="r-rel">
              <Select id="r-rel" value={v.related} onChange={(e) => setV({ ...v, related: e.target.value })}>
                <option value="">None</option>
                {(candidates.data ?? []).map((c) => <option key={c.id} value={c.id}>[{c.dashboard}] {c.title.slice(0, 90)}</option>)}
              </Select>
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="brand" loading={save.isPending} disabled={!v.title.trim()}>{editing ? "Save" : "Suggest a next step"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// C. What do we need from each other?
// ---------------------------------------------------------------------
const PROMPTS = [
  { key: "from_leadership", label: "What do we need more of from leadership?" },
  { key: "as_a_team", label: "What should we do differently as a team?" },
  { key: "contribute", label: "What can we each contribute?" },
  { key: "accountable", label: "What should we hold ourselves accountable for?" },
];

function EachOther() {
  const [prompt, setPrompt] = React.useState(PROMPTS[0].key);
  return (
    <div>
      <SectionHeader letter="C" title="What Do We Need From Each Other?" prompt="Thoughts can grow into shared commitments as people show support. The goal is collective ownership, not forced agreement." />
      <div className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="tablist" aria-label="Prompts">
        {PROMPTS.map((p) => (
          <button key={p.key} role="tab" aria-selected={prompt === p.key} onClick={() => setPrompt(p.key)}
            className={cn("rounded-xl border p-3 text-left text-sm transition-colors", prompt === p.key ? "border-d5 bg-d5-soft font-medium" : "border-line bg-surface hover:bg-canvas")}>
            {p.label}
          </button>
        ))}
      </div>
      <CommitmentsSummary />
      <ContributionBoard
        key={prompt}
        board="expectations" categoryKey={prompt}
        heading="Add a thought" prompt={PROMPTS.find((p) => p.key === prompt)!.label}
        titleLabel="Your thought" addLabel="Add a thought" allowAnonymous
        reactionKind="support" reactionLabel="Support" enableCommitment enableFilters
        emptyTitle="Nothing here yet" emptyText="Add a thought. When enough people support it, an administrator can confirm it as a shared commitment."
        layout="list"
      />
    </div>
  );
}

function CommitmentsSummary() {
  const unit = useUnit();
  const { data } = useQuery({
    queryKey: ["contributions", unit.id, "commitments"],
    queryFn: async () => unwrap(await supabase.from("contributions").select("id, title, support_count").eq("unit_id", unit.id).eq("board", "expectations").eq("status", "commitment").eq("hidden", false)) as { id: string; title: string; support_count: number }[],
  });
  if (!data?.length) return null;
  return (
    <Card className="mb-6 border-d5/30">
      <CardHeader><CardTitle className="flex items-center gap-2"><Target className="size-4 text-d5" aria-hidden /> Our shared commitments</CardTitle>
        <CardDescription>Confirmed after discussion and support from the group.</CardDescription></CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {data.map((c) => <li key={c.id} className="flex items-center gap-2 text-sm"><span className="flex-1">{c.title}</span><Badge tone="brand">{c.support_count} support</Badge></li>)}
        </ul>
      </CardContent>
    </Card>
  );
}
