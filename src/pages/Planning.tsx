import * as React from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, MessageSquare, Plus, Search, Trash2 } from "lucide-react";
import { AppError, rpc } from "@/lib/api";
import { BD_KINDS, BD_PRIORITIES, BD_STATUSES, categoryLabel, type BdField } from "@/lib/bd";
import type { BdItem, BdKind } from "@/lib/types";
import { cn, formatDate, formatMoney, newRequestId, timeAgo } from "@/lib/utils";
import { useAction, useBdItems, useMembers } from "@/hooks/data";
import { useAuth } from "@/hooks/useAuth";
import { useUnit } from "@/hooks/useUnit";
import { Button } from "@/components/ui/button";
import { Badge, Field, Input, Notice, Select, Spinner, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { EmptyState, PageHeader } from "@/components/collab/common";
import { CommentThread } from "@/components/collab/Discussion";

const KIND_ORDER: BdKind[] = ["client", "association", "conference"];
const PRIORITY_TONE = { high: "danger", medium: "warn", low: "neutral" } as const;

export default function Planning() {
  const unit = useUnit();
  const [params, setParams] = useSearchParams();
  const tab = (KIND_ORDER.includes(params.get("tab") as BdKind) ? params.get("tab") : "client") as BdKind;
  return (
    <div>
      <PageHeader
        eyebrow={`Strategic planning · ${unit.short_name}`}
        title="2027 Business Development"
        subtitle="Who we'll keep, grow, and meet next year, and who's leading each. Add a row, then double-click it to fill in the who, what, and why."
      />
      <Tabs value={tab} onValueChange={(v) => { params.set("tab", v); params.delete("item"); setParams(params, { replace: true }); }}>
        <TabsList>
          {KIND_ORDER.map((k) => <TabsTrigger key={k} value={k}>{BD_KINDS[k].label}</TabsTrigger>)}
        </TabsList>
        {KIND_ORDER.map((k) => (
          <TabsContent key={k} value={k}>
            <BdSheet kind={k} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------
function BdSheet({ kind }: { kind: BdKind }) {
  const cfg = BD_KINDS[kind];
  const unit = useUnit();
  const { canContribute } = useAuth();
  const { data, isLoading, error } = useBdItems(unit.id, kind);
  const members = useMembers(unit.id);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = React.useState("");
  const [cat, setCat] = React.useState("");
  const [owner, setOwner] = React.useState("");
  const [showDropped, setShowDropped] = React.useState(false);
  const openId = params.get("item");
  const setOpenId = (id: string | null) => {
    if (id) params.set("item", id);
    else params.delete("item");
    setParams(params, { replace: true });
  };

  const all = data ?? [];
  const rows = all.filter((r) =>
    (showDropped || r.status !== "dropped") &&
    (!cat || r.category === cat) &&
    (!owner || (owner === "none" ? !r.owner_id : r.owner_id === owner)) &&
    (!q || r.name.toLowerCase().includes(q.toLowerCase())));
  const live = all.filter((r) => r.status !== "dropped");
  const openItem = all.find((r) => r.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-soft">{cfg.intro}</p>

      <div className="grid gap-3 sm:grid-cols-3" aria-label={`${cfg.label} by category`}>
        {cfg.categories.map((c) => {
          const items = live.filter((r) => r.category === c.value);
          const total = items.reduce((s, r) => s + Number(r.value_2027 ?? 0), 0);
          return (
            <button
              key={c.value}
              onClick={() => setCat(cat === c.value ? "" : c.value)}
              aria-pressed={cat === c.value}
              className={cn("rounded-[var(--radius-card)] border bg-surface p-4 text-left transition-colors",
                cat === c.value ? "border-brand ring-1 ring-brand" : "border-line hover:bg-canvas")}
            >
              <p className="flex items-baseline justify-between">
                <span className="font-display text-sm font-semibold">{c.label}</span>
                <span className="font-display text-2xl font-semibold tabular-nums">{items.length}</span>
              </p>
              <p className="mt-1 text-xs text-muted">
                {c.hint}{total > 0 ? ` · ${cfg.value2027.toLowerCase()} ${formatMoney(total, true)}` : ""}
              </p>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label={`Search ${cfg.label.toLowerCase()}`} placeholder="Search…" className="h-9 w-48 pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select aria-label="Filter by category" className="h-9 w-auto" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {cfg.categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
        <Select aria-label="Filter by sponsor or owner" className="h-9 w-auto" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Any sponsor/owner</option>
          <option value="none">No owner yet</option>
          {(members.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.username}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input type="checkbox" checked={showDropped} onChange={(e) => setShowDropped(e.target.checked)} className="accent-[var(--color-brand)]" />
          Show dropped
        </label>
        <span className="ml-auto text-xs text-muted">Double-click a row (or press Enter) to open it.</span>
      </div>

      {isLoading ? <Spinner /> : error ? (
        <EmptyState title="We couldn't load this list">{(error as Error).message}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
          <table className="w-full min-w-[920px] text-sm">
            <caption className="sr-only">{cfg.label} for 2027</caption>
            <thead>
              <tr className="border-b border-line bg-canvas text-left text-xs text-muted">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium">Category</th>
                <th className="px-2 py-2 font-medium">Sponsor / owner</th>
                <th className="px-2 py-2 font-medium">Priority</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 text-right font-medium">{cfg.value2027}</th>
                <th className="px-2 py-2 font-medium">{cfg.keyDate}</th>
                <th className="px-2 py-2"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <BdRow key={r.id} item={r} members={members.data ?? []} onOpen={() => setOpenId(r.id)} />
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-muted">
                  {all.length === 0 ? `No ${cfg.label.toLowerCase()} yet. Add the first one below.` : "Nothing matches these filters."}
                </td></tr>
              )}
            </tbody>
            {canContribute && <AddRow kind={kind} members={members.data ?? []} defaultCategory={cat} />}
          </table>
        </div>
      )}

      {live.length > 0 && <Totals kind={kind} items={live} />}

      <BdDetail item={openItem} kind={kind} members={members.data ?? []} onClose={() => setOpenId(null)} />
    </div>
  );
}

type Member = { id: string; username: string; display_name: string };

/** Quick dropdown edits: one field at a time, last write wins for that field. */
function useQuickUpdate(id: string) {
  return useAction(
    (patch: Record<string, unknown>) => rpc<number>("update_bd_item", { p_id: id, p_patch: patch }),
    { invalidate: [["bd"]] },
  );
}

function BdRow({ item: r, members, onOpen }: { item: BdItem; members: Member[]; onOpen: () => void }) {
  const cfg = BD_KINDS[r.kind];
  const { canContribute } = useAuth();
  const save = useQuickUpdate(r.id);
  const cell = "px-2 py-1.5";
  const sel = "h-8 w-full min-w-[7rem] rounded-md border border-transparent bg-transparent px-1.5 text-sm hover:border-line-strong focus:border-brand disabled:opacity-100";
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <tr
      tabIndex={0}
      onDoubleClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onOpen(); }}
      className={cn("border-b border-line last:border-0 hover:bg-canvas/60 focus-visible:bg-brand-soft/40 focus-visible:outline-none", r.status === "dropped" && "text-muted line-through decoration-muted/50")}
      aria-label={`${r.name}, ${categoryLabel(r.kind, r.category)}`}
    >
      <td className="px-3 py-1.5">
        <button className="text-left font-medium hover:underline" onClick={onOpen}>{r.name}</button>
      </td>
      <td className={cell} onDoubleClick={stop}>
        <select aria-label="Category" className={sel} value={r.category} disabled={!canContribute} onChange={(e) => save.mutate({ category: e.target.value })}>
          {cfg.categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </td>
      <td className={cell} onDoubleClick={stop}>
        <select aria-label="Sponsor or owner" className={cn(sel, !r.owner_id && "text-muted")} value={r.owner_id ?? ""} disabled={!canContribute}
          onChange={(e) => save.mutate({ owner_id: e.target.value || null })}>
          <option value="">— Unassigned —</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.username}</option>)}
          {r.owner_id && !members.some((m) => m.id === r.owner_id) && <option value={r.owner_id}>{r.owner?.username ?? "Former member"}</option>}
        </select>
      </td>
      <td className={cell} onDoubleClick={stop}>
        <select aria-label="Priority" className={sel} value={r.priority} disabled={!canContribute} onChange={(e) => save.mutate({ priority: e.target.value })}>
          {BD_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </td>
      <td className={cell} onDoubleClick={stop}>
        <select aria-label="Status" className={sel} value={r.status} disabled={!canContribute} onChange={(e) => save.mutate({ status: e.target.value })}>
          {BD_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </td>
      <td className={cn(cell, "text-right tabular-nums")}>{formatMoney(r.value_2027)}</td>
      <td className={cn(cell, "whitespace-nowrap")}>{r.key_date ? formatDate(r.key_date) : <span className="text-muted">—</span>}</td>
      <td className={cn(cell, "whitespace-nowrap text-right")}>
        <button onClick={onOpen} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-canvas hover:text-ink" aria-label={`Open ${r.name}`}>
          {r.comment_count > 0 && <><MessageSquare className="size-3.5" aria-hidden />{r.comment_count}</>}
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </td>
    </tr>
  );
}

function AddRow({ kind, members, defaultCategory }: { kind: BdKind; members: Member[]; defaultCategory: string }) {
  const cfg = BD_KINDS[kind];
  const unit = useUnit();
  const [v, setV] = React.useState({ name: "", category: defaultCategory || cfg.categories[0].value, owner: "", priority: "medium" });
  const rid = React.useRef(newRequestId());
  const nameRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (defaultCategory) setV((x) => ({ ...x, category: defaultCategory })); }, [defaultCategory]);
  const add = useAction(
    () => rpc<string>("create_bd_item", {
      p_unit_id: unit.id, p_kind: kind, p_category: v.category, p_name: v.name,
      p_owner_id: v.owner || null, p_priority: v.priority, p_client_request_id: rid.current,
    }),
    { invalidate: [["bd"], ["home"]], retry: true },
  );
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.name.trim() || add.isPending) return;
    add.mutate(undefined, {
      onSuccess: () => {
        toast.success(`Added ${v.name.trim()}`);
        setV((x) => ({ ...x, name: "" }));
        rid.current = newRequestId();
        nameRef.current?.focus();
      },
    });
  };
  const sel = "h-9 w-full rounded-md border border-line-strong bg-surface px-1.5 text-sm";
  return (
    <tfoot>
      <tr className="border-t-2 border-line bg-brand-soft/30">
        <td className="px-3 py-2" colSpan={1}>
          <form id={`add-${kind}`} onSubmit={submit} />
          <Input ref={nameRef} form={`add-${kind}`} aria-label={`New ${cfg.singular} name`} placeholder={`Add a ${cfg.singular}…`}
            className="h-9" value={v.name} maxLength={200} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </td>
        <td className="px-2 py-2">
          <select form={`add-${kind}`} aria-label="Category" className={sel} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>
            {cfg.categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </td>
        <td className="px-2 py-2">
          <select form={`add-${kind}`} aria-label="Sponsor or owner" className={sel} value={v.owner} onChange={(e) => setV({ ...v, owner: e.target.value })}>
            <option value="">Sponsor/owner…</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.username}</option>)}
          </select>
        </td>
        <td className="px-2 py-2">
          <select form={`add-${kind}`} aria-label="Priority" className={sel} value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>
            {BD_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </td>
        <td className="px-2 py-2" colSpan={4}>
          <Button form={`add-${kind}`} type="submit" variant="brand" size="sm" loading={add.isPending} disabled={!v.name.trim()}>
            <Plus /> Add row
          </Button>
        </td>
      </tr>
    </tfoot>
  );
}

function Totals({ kind, items }: { kind: BdKind; items: BdItem[] }) {
  const cfg = BD_KINDS[kind];
  const sum = (k: "value_2026" | "value_2027") => items.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const unowned = items.filter((r) => !r.owner_id).length;
  const high = items.filter((r) => r.priority === "high").length;
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-soft">
      <span>{items.length} active</span>
      <span>{high} high priority</span>
      <span className={unowned ? "text-warning" : ""}>{unowned} without a sponsor/owner</span>
      <span>{cfg.value2026}: {formatMoney(sum("value_2026"))}</span>
      <span>{cfg.value2027}: {formatMoney(sum("value_2027"))}</span>
    </div>
  );
}

// ---------------------------------------------------------------------
// Detail panel (double-click)
// ---------------------------------------------------------------------
type Draft = {
  name: string; category: string; owner_id: string; priority: string; status: string;
  value_2026: string; value_2027: string; key_date: string; details: Record<string, string>;
};
const toDraft = (r: BdItem): Draft => ({
  name: r.name, category: r.category, owner_id: r.owner_id ?? "", priority: r.priority, status: r.status,
  value_2026: r.value_2026 == null ? "" : String(Number(r.value_2026)),
  value_2027: r.value_2027 == null ? "" : String(Number(r.value_2027)),
  key_date: r.key_date ?? "", details: { ...(r.details ?? {}) },
});

/** Only the fields this person changed, so concurrent edits to other fields survive. */
function diff(base: Draft, d: Draft): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  (["name", "category", "owner_id", "priority", "status", "value_2026", "value_2027", "key_date"] as const).forEach((k) => {
    if (base[k] !== d[k]) patch[k] = k === "owner_id" ? d[k] || null : d[k];
  });
  const det: Record<string, string> = {};
  new Set([...Object.keys(base.details), ...Object.keys(d.details)]).forEach((k) => {
    if ((base.details[k] ?? "") !== (d.details[k] ?? "")) det[k] = d.details[k] ?? "";
  });
  if (Object.keys(det).length) patch.details = det;
  return patch;
}

function BdDetail({ item, kind, members, onClose }: { item: BdItem | null; kind: BdKind; members: Member[]; onClose: () => void }) {
  const cfg = BD_KINDS[kind];
  const { profile, isAdmin, canContribute } = useAuth();
  const qc = useQueryClient();
  const [base, setBase] = React.useState<Draft | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const itemId = item?.id;

  React.useEffect(() => {
    if (item) {
      setBase(toDraft(item));
      setDraft(toDraft(item));
      setConflict(false);
    }
  }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = base && draft ? diff(base, draft) : {};
  const dirty = Object.keys(patch).length > 0;

  const save = useAction(
    () => rpc<number>("update_bd_item", { p_id: item!.id, p_patch: patch, p_expected_version: item!.version }),
    { invalidate: [["bd"]] },
  );
  const remove = useAction(() => rpc("delete_bd_item", { p_id: item!.id }), { success: "Removed", invalidate: [["bd"], ["home"]] });

  const close = () => {
    if (dirty && !confirm("Discard your unsaved changes?")) return;
    onClose();
  };
  const doSave = () =>
    save.mutate(undefined, {
      onSuccess: () => {
        toast.success("Saved");
        setBase(draft);
        setConflict(false);
      },
      onError: (e) => {
        if (e instanceof AppError && e.isConflict) {
          setConflict(true);
          qc.invalidateQueries({ queryKey: ["bd"] });
        }
      },
    });

  const set = (k: keyof Draft, val: string) => setDraft((d) => (d ? { ...d, [k]: val } : d));
  const setDetail = (k: string, val: string) => setDraft((d) => (d ? { ...d, details: { ...d.details, [k]: val } } : d));
  const canDelete = item && (isAdmin || item.created_by === profile?.id || item.owner_id === profile?.id);
  const ro = !canContribute;

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && close()}>
      <DialogContent side="right" onEscapeKeyDown={(e) => { if (dirty) { e.preventDefault(); close(); } }}>
        {item && draft && (
          <div className="flex flex-col gap-6">
            <DialogHeader
              title={draft.name || item.name}
              description={
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone="brand">{categoryLabel(kind, draft.category)}</Badge>
                  <Badge tone={PRIORITY_TONE[draft.priority as keyof typeof PRIORITY_TONE] ?? "neutral"}>{draft.priority} priority</Badge>
                  <span className="text-xs">Added by {item.creator?.username ?? "a former member"} · updated {timeAgo(item.updated_at)}{item.editor ? ` by ${item.editor.username}` : ""}</span>
                </span>
              }
            />
            {conflict && (
              <Notice tone="warn">
                Someone else saved changes to this {cfg.singular} while you were editing. The latest version has been loaded;
                your edits are kept. Saving again applies only the fields you changed.
              </Notice>
            )}

            <section className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="bd-name" className="sm:col-span-2">
                <Input id="bd-name" value={draft.name} maxLength={200} disabled={ro} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label="Category" htmlFor="bd-cat">
                <Select id="bd-cat" value={draft.category} disabled={ro} onChange={(e) => set("category", e.target.value)}>
                  {cfg.categories.map((c) => <option key={c.value} value={c.value}>{c.label} — {c.hint}</option>)}
                </Select>
              </Field>
              <Field label="Sponsor / owner" htmlFor="bd-owner">
                <Select id="bd-owner" value={draft.owner_id} disabled={ro} onChange={(e) => set("owner_id", e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.username} ({m.display_name})</option>)}
                </Select>
              </Field>
              <Field label="Priority" htmlFor="bd-pri">
                <Select id="bd-pri" value={draft.priority} disabled={ro} onChange={(e) => set("priority", e.target.value)}>
                  {BD_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </Select>
              </Field>
              <Field label="Status" htmlFor="bd-status">
                <Select id="bd-status" value={draft.status} disabled={ro} onChange={(e) => set("status", e.target.value)}>
                  {BD_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
              </Field>
              <Field label={`${cfg.value2026} (USD)`} htmlFor="bd-v26">
                <Input id="bd-v26" inputMode="decimal" placeholder="0" value={draft.value_2026} disabled={ro}
                  onChange={(e) => set("value_2026", e.target.value.replace(/[^0-9.]/g, ""))} />
              </Field>
              <Field label={`${cfg.value2027} (USD)`} htmlFor="bd-v27">
                <Input id="bd-v27" inputMode="decimal" placeholder="0" value={draft.value_2027} disabled={ro}
                  onChange={(e) => set("value_2027", e.target.value.replace(/[^0-9.]/g, ""))} />
              </Field>
              <Field label={cfg.keyDate} htmlFor="bd-date">
                <Input id="bd-date" type="date" value={draft.key_date} disabled={ro} onChange={(e) => set("key_date", e.target.value)} />
              </Field>
            </section>

            {cfg.sections.map((sec) => (
              <section key={sec.title} className="border-t border-line pt-5">
                <h3 className="eyebrow mb-3 text-brand">{sec.title}</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {sec.fields.map((f) => (
                    <DetailField key={f.key} field={f} value={draft.details[f.key] ?? ""} disabled={ro} onChange={(val) => setDetail(f.key, val)} />
                  ))}
                </div>
              </section>
            ))}

            {canContribute && (
              <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center gap-2 border-t border-line bg-surface/95 px-6 py-3 backdrop-blur">
                <Button variant="brand" loading={save.isPending} disabled={!dirty} onClick={doSave}>Save changes</Button>
                <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(base)}>Undo changes</Button>
                {canDelete && (
                  <Button variant="ghost" className="ml-auto text-danger" loading={remove.isPending}
                    onClick={() => confirm(`Remove ${item.name} and its discussion? You can also set the status to Dropped instead.`) && remove.mutate(undefined, { onSuccess: onClose })}>
                    <Trash2 /> Remove
                  </Button>
                )}
              </div>
            )}

            <section className="border-t border-line pt-5">
              <h3 className="eyebrow mb-3 text-muted">Discussion</h3>
              <CommentThread bdItemId={item.id} placeholder={`Add context, a question, or an update on this ${cfg.singular}…`} />
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailField({ field: f, value, disabled, onChange }: { field: BdField; value: string; disabled: boolean; onChange: (v: string) => void }) {
  const id = `bd-d-${f.key}`;
  if (f.options) {
    return (
      <Field label={f.label} htmlFor={id}>
        <Select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      </Field>
    );
  }
  return (
    <Field label={f.label} htmlFor={id} className={f.short ? "" : "sm:col-span-2"}>
      {f.short ? (
        <Input id={id} value={value} placeholder={f.placeholder} disabled={disabled} maxLength={2000} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Textarea id={id} value={value} placeholder={f.placeholder} disabled={disabled} maxLength={2000} className="min-h-[72px]" onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}
