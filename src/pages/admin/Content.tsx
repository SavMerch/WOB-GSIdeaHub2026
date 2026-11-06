import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { supabase } from "@/lib/supabase";
import { rpc, unwrap } from "@/lib/api";
import { CONTRIBUTION_SELECT, useAction } from "@/hooks/data";
import { itemHref } from "@/lib/dashboards";
import { formatDateTime } from "@/lib/utils";
import type { Category, Contribution } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle, Input, Select, Spinner } from "@/components/ui/primitives";
import { Table, Td, Th } from "./shared";

export function Content() {
  return (
    <div className="flex flex-col gap-8">
      <Reports />
      <Submissions />
      <Categories />
    </div>
  );
}

function Reports() {
  const { data } = useQuery({
    queryKey: ["admin-reports"],
    queryFn: async () => unwrap(await supabase.from("content_reports")
      .select("id, reason, status, created_at, contribution_id, comment_id, reporter:profiles!content_reports_reporter_id_fkey(username), contribution:contributions(id, title, board, dashboard, hidden), comment:contribution_comments(id, body, hidden)")
      .order("created_at", { ascending: false }).limit(100)) as any[],
  });
  const resolve = useAction((v: { id: string; status: string }) => rpc("admin_resolve_report", { p_id: v.id, p_status: v.status }), { invalidate: [["admin-reports"], ["admin-overview"]] });
  const hide = useAction((v: { kind: string; id: string }) => rpc("admin_moderate", { p_kind: v.kind, p_id: v.id, p_hidden: true, p_archived: null, p_reason: "Reported" }), {
    success: "Hidden from members", invalidate: [["admin-reports"], ["contributions"]],
  });
  const open = (data ?? []).filter((r) => r.status === "open");
  return (
    <section>
      <h2 className="mb-3 font-display text-lg font-semibold">Reported content {open.length > 0 && <Badge tone="warn">{open.length} open</Badge>}</h2>
      {open.length === 0 ? <p className="text-sm text-muted">No open reports.</p> : (
        <div className="flex flex-col gap-3">
          {open.map((r) => (
            <Card key={r.id} className="p-4">
              <p className="text-sm"><span className="font-medium">{r.reporter?.username ?? "Someone"}</span> reported {r.contribution ? "a contribution" : "a comment"} · {formatDateTime(r.created_at)}</p>
              <p className="mt-1 text-sm text-ink-soft">“{r.reason}”</p>
              <p className="mt-2 rounded-lg bg-canvas p-2 text-sm">{r.contribution?.title ?? r.comment?.body}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {r.contribution && <Button size="sm" variant="outline" disabled={r.contribution.hidden} onClick={() => hide.mutate({ kind: "contribution", id: r.contribution.id })}>Hide it</Button>}
                {r.comment && <Button size="sm" variant="outline" disabled={r.comment.hidden} onClick={() => hide.mutate({ kind: "comment", id: r.comment.id })}>Hide it</Button>}
                <Button size="sm" variant="brand" onClick={() => resolve.mutate({ id: r.id, status: "resolved" })}>Mark resolved</Button>
                <Button size="sm" variant="ghost" onClick={() => resolve.mutate({ id: r.id, status: "dismissed" })}>Dismiss</Button>
                {r.contribution && <Link className="self-center text-sm text-brand hover:underline" to={itemHref("contribution", r.contribution.id, r.contribution.board, r.contribution.dashboard)}>Open</Link>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function Submissions() {
  const [q, setQ] = React.useState("");
  const [show, setShow] = React.useState("all");
  const { data, isLoading } = useQuery({
    queryKey: ["admin-content"],
    queryFn: async () => unwrap(await supabase.from("contributions").select(CONTRIBUTION_SELECT).order("created_at", { ascending: false }).limit(1000)) as Contribution[],
  });
  const mod = useAction((v: { id: string; hidden?: boolean | null; archived?: boolean | null }) =>
    rpc("admin_moderate", { p_kind: "contribution", p_id: v.id, p_hidden: v.hidden ?? null, p_archived: v.archived ?? null, p_reason: null }), {
    success: "Updated", invalidate: [["admin-content"], ["contributions"]],
  });
  const del = useAction((id: string) => rpc("delete_contribution", { p_id: id }), { success: "Removed", invalidate: [["admin-content"], ["contributions"]] });
  const rows = (data ?? []).filter((c) =>
    (show === "all" || (show === "hidden" && c.hidden) || (show === "archived" && c.archived)) &&
    c.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-display text-lg font-semibold">Submissions</h2>
        <Input aria-label="Search" placeholder="Search titles…" className="h-9 w-56" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Show" className="h-9 w-auto" value={show} onChange={(e) => setShow(e.target.value)}>
          <option value="all">All</option><option value="hidden">Hidden</option><option value="archived">Archived</option>
        </Select>
      </div>
      {isLoading ? <Spinner /> : (
        <Table>
          <thead><tr><Th>Title</Th><Th>Board</Th><Th>Author</Th><Th>Created</Th><Th>State</Th><Th className="text-right">Actions</Th></tr></thead>
          <tbody>
            {rows.slice(0, 300).map((c) => (
              <tr key={c.id}>
                <Td><Link className="hover:underline" to={itemHref("contribution", c.id, c.board, c.dashboard)}>{c.title}</Link></Td>
                <Td className="text-xs">{c.board}</Td>
                <Td className="text-xs">{c.is_anonymous ? "Anonymous" : c.author?.username ?? "—"}</Td>
                <Td className="whitespace-nowrap text-xs">{formatDateTime(c.created_at)}</Td>
                <Td>{c.hidden && <Badge tone="danger">Hidden</Badge>} {c.archived && <Badge>Archived</Badge>}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => mod.mutate({ id: c.id, hidden: !c.hidden })}>{c.hidden ? "Unhide" : "Hide"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => mod.mutate({ id: c.id, archived: !c.archived })}>{c.archived ? "Unarchive" : "Archive"}</Button>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => confirm("Delete permanently?") && del.mutate(c.id)}>Delete</Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}

function Categories() {
  const boards = [
    { key: "barriers", label: "What's getting in our way? — issue categories" },
    { key: "grow", label: "Where could we grow? — opportunity types" },
  ];
  const health = useQuery({ queryKey: ["admin-health-cats"], queryFn: async () => unwrap(await supabase.from("health_categories").select("*").order("sort")) as Category[] });
  const saveHealth = useAction((v: { id?: string; key?: string; label: string; sort?: number; active?: boolean }) =>
    rpc("admin_upsert_health_category", { p_id: v.id ?? null, p_key: v.key ?? null, p_label: v.label, p_sort: v.sort ?? null, p_active: v.active ?? null }),
    { success: "Saved", invalidate: [["admin-health-cats"], ["health-summary"]] });
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      {boards.map((b) => <BoardCategories key={b.key} board={b.key} label={b.label} />)}
      <Card>
        <CardHeader><CardTitle>“How are we doing?” rating categories</CardTitle></CardHeader>
        <CardContent>
          <CategoryEditor rows={health.data ?? []} onSave={(v) => saveHealth.mutate(v)} />
        </CardContent>
      </Card>
    </section>
  );
}

function BoardCategories({ board, label }: { board: string; label: string }) {
  const { data } = useQuery({ queryKey: ["categories", board], queryFn: async () => unwrap(await supabase.from("categories").select("*").eq("board", board).order("sort")) as Category[] });
  const save = useAction((v: { id?: string; key?: string; label: string; sort?: number; active?: boolean }) =>
    rpc("admin_upsert_category", { p_id: v.id ?? null, p_board: board, p_key: v.key ?? null, p_label: v.label, p_sort: v.sort ?? null, p_active: v.active ?? null }),
    { success: "Saved", invalidate: [["categories"]] });
  return (
    <Card>
      <CardHeader><CardTitle>{label}</CardTitle></CardHeader>
      <CardContent><CategoryEditor rows={data ?? []} onSave={(v) => save.mutate(v)} /></CardContent>
    </Card>
  );
}

function CategoryEditor({ rows, onSave }: { rows: Category[]; onSave: (v: { id?: string; key?: string; label: string; sort?: number; active?: boolean }) => void }) {
  const [label, setLabel] = React.useState("");
  return (
    <div className="flex flex-col gap-2">
      {rows.map((c) => (
        <div key={c.id} className="flex items-center gap-2">
          <Input aria-label="Label" className="h-8 flex-1 text-sm" defaultValue={c.label} onBlur={(e) => e.target.value !== c.label && onSave({ id: c.id, label: e.target.value })} />
          <label className="flex items-center gap-1 text-xs text-muted">
            <input type="checkbox" defaultChecked={c.active} onChange={(e) => onSave({ id: c.id, label: c.label, active: e.target.checked })} className="accent-[var(--color-brand)]" /> Active
          </label>
        </div>
      ))}
      <form className="mt-2 flex gap-2" onSubmit={(e) => {
        e.preventDefault();
        const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
        if (key.length < 2) return;
        onSave({ key, label, sort: rows.length + 1, active: true });
        setLabel("");
      }}>
        <Input aria-label="New category" placeholder="Add a category" className="h-8 text-sm" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Button size="sm" type="submit" disabled={!label.trim()}>Add</Button>
      </form>
    </div>
  );
}
