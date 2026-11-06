import * as React from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Lightbulb, Link2, MessageSquare, Pencil, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { rpc, unwrap } from "@/lib/api";
import { dashboardByN, itemHref } from "@/lib/dashboards";
import { cn, newRequestId, timeAgo } from "@/lib/utils";
import { useAction, useComments, useRelated } from "@/hooks/data";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { StatusBadge } from "./common";

// ---------------------------------------------------------------------
// Comment thread (append-only; authors can edit/remove their own)
// ---------------------------------------------------------------------
export function CommentThread({
  contributionId, roadmapId, allowSolutions = false,
}: { contributionId?: string; roadmapId?: string; allowSolutions?: boolean }) {
  const { profile, canContribute, isAdmin } = useAuth();
  const { data: comments, isLoading } = useComments({ contributionId, roadmapId });
  const [body, setBody] = React.useState("");
  const [kind, setKind] = React.useState<"comment" | "solution">("comment");
  const requestId = React.useRef(newRequestId());
  const [editing, setEditing] = React.useState<{ id: string; body: string } | null>(null);

  const add = useAction(
    () => rpc("add_comment", {
      p_contribution_id: contributionId ?? null, p_roadmap_item_id: roadmapId ?? null,
      p_body: body, p_kind: kind, p_client_request_id: requestId.current,
    }),
    { invalidate: [["comments", contributionId ?? roadmapId ?? ""]], retry: true },
  );
  const edit = useAction((v: { id: string; body: string }) => rpc("edit_comment", { p_id: v.id, p_body: v.body }), {
    invalidate: [["comments", contributionId ?? roadmapId ?? ""]],
  });
  const del = useAction((id: string) => rpc("delete_comment", { p_id: id }), {
    success: "Comment removed", invalidate: [["comments", contributionId ?? roadmapId ?? ""]],
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || add.isPending) return;
    add.mutate(undefined, {
      onSuccess: () => {
        setBody("");
        setKind("comment");
        requestId.current = newRequestId();
      },
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {isLoading ? (
        <p className="text-sm text-muted">Loading discussion…</p>
      ) : comments && comments.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className={cn("rounded-lg border px-3 py-2.5", c.kind === "solution" ? "border-d3/30 bg-d3-soft" : "border-line bg-canvas", c.hidden && "opacity-60")}>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="font-medium text-ink-soft">{c.author?.username ?? "Former member"}</span>
                {c.kind === "solution" && <span className="inline-flex items-center gap-1 font-medium text-d3"><Lightbulb className="size-3" aria-hidden /> Possible solution</span>}
                <span>{timeAgo(c.created_at)}{c.edited ? " · edited" : ""}</span>
                {c.hidden && <span className="text-danger">Hidden by an administrator</span>}
                <span className="ml-auto flex gap-1">
                  {c.author_id === profile?.id && !c.hidden && (
                    <button className="rounded p-1 hover:bg-surface" aria-label="Edit comment" onClick={() => setEditing({ id: c.id, body: c.body })}>
                      <Pencil className="size-3.5" />
                    </button>
                  )}
                  {(c.author_id === profile?.id || isAdmin) && (
                    <button
                      className="rounded p-1 hover:bg-surface"
                      aria-label="Remove comment"
                      onClick={() => confirm("Remove this comment?") && del.mutate(c.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </span>
              </div>
              {editing?.id === c.id ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    edit.mutate(editing, { onSuccess: () => setEditing(null) });
                  }}
                >
                  <Textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} maxLength={4000} aria-label="Edit comment" />
                  <div className="flex gap-2">
                    <Button size="sm" type="submit" loading={edit.isPending}>Save</Button>
                    <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </form>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{c.body}</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No comments yet. Start the conversation.</p>
      )}

      {canContribute && (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label className="sr-only" htmlFor={`c-${contributionId ?? roadmapId}`}>Add a comment</label>
          <Textarea
            id={`c-${contributionId ?? roadmapId}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={kind === "solution" ? "What might help?" : "Add a comment…"}
            maxLength={4000}
            className="min-h-[64px]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" type="submit" loading={add.isPending} disabled={!body.trim()}>
              <MessageSquare /> {kind === "solution" ? "Suggest this solution" : "Add a comment"}
            </Button>
            {allowSolutions && (
              <Button size="sm" type="button" variant={kind === "solution" ? "soft" : "ghost"} onClick={() => setKind(kind === "solution" ? "comment" : "solution")} aria-pressed={kind === "solution"}>
                <Lightbulb /> Suggest a possible solution
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Related items across dashboards
// ---------------------------------------------------------------------
export function RelatedItems({ kind, id }: { kind: "contribution" | "roadmap"; id: string }) {
  const { profile, canContribute, isAdmin } = useAuth();
  const { data } = useRelated(kind, id);
  const [open, setOpen] = React.useState(false);
  const del = useAction((linkId: string) => rpc("delete_link", { p_id: linkId }), { invalidate: [["related"]] });
  void profile;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="eyebrow text-muted">Connected to</p>
        {canContribute && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            <Link2 /> Connect
          </Button>
        )}
      </div>
      {data && data.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {data.map((r) => {
            const d = dashboardByN(r.dashboard);
            return (
              <li key={r.link_id} className="flex items-center gap-2 text-sm">
                <span className={cn("grid size-5 shrink-0 place-items-center rounded text-[10px] font-semibold", d.accent.soft, d.accent.text)}>{d.n}</span>
                <Link to={itemHref(r.kind, r.id, r.board, r.dashboard)} className="min-w-0 flex-1 truncate text-ink hover:underline">
                  {r.title}
                </Link>
                <StatusBadge status={r.status} />
                {isAdmin && (
                  <button className="rounded p-1 text-muted hover:bg-canvas" aria-label="Remove connection" onClick={() => del.mutate(r.link_id)}>
                    <X className="size-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">Not connected to anything yet.</p>
      )}
      <LinkDialog open={open} onOpenChange={setOpen} from={{ kind, id }} />
    </div>
  );
}

function LinkDialog({ open, onOpenChange, from }: { open: boolean; onOpenChange: (o: boolean) => void; from: { kind: "contribution" | "roadmap"; id: string } }) {
  const [q, setQ] = React.useState("");
  const { data } = useQuery({
    queryKey: ["link-candidates"],
    enabled: open,
    queryFn: async () => {
      const [c, r] = await Promise.all([
        supabase.from("contributions").select("id, title, board, dashboard").eq("hidden", false).order("created_at", { ascending: false }).limit(400),
        supabase.from("roadmap_items").select("id, title").eq("hidden", false).order("created_at", { ascending: false }).limit(200),
      ]);
      return [
        ...(unwrap(c) as { id: string; title: string; board: string; dashboard: number }[]).map((x) => ({ ...x, kind: "contribution" as const })),
        ...(unwrap(r) as { id: string; title: string }[]).map((x) => ({ ...x, kind: "roadmap" as const, board: "roadmap", dashboard: 5 })),
      ];
    },
  });
  const link = useAction(
    (to: { kind: string; id: string }) => rpc("create_link", { p_from_kind: from.kind, p_from_id: from.id, p_to_kind: to.kind, p_to_id: to.id }),
    { success: "Connected", invalidate: [["related"]] },
  );
  const items = (data ?? []).filter((x) => x.id !== from.id && x.title.toLowerCase().includes(q.toLowerCase())).slice(0, 30);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title="Connect to something related" description="Link this to an issue, idea, or next step on any dashboard. Both keep their own discussion." />
        <Input autoFocus placeholder="Search by title…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <ul className="mt-3 flex max-h-80 flex-col gap-1 overflow-y-auto">
          {items.map((x) => {
            const d = dashboardByN(x.dashboard);
            return (
              <li key={`${x.kind}-${x.id}`}>
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-canvas disabled:opacity-50"
                  disabled={link.isPending}
                  onClick={() => link.mutate(x, { onSuccess: () => onOpenChange(false) })}
                >
                  <span className={cn("grid size-5 shrink-0 place-items-center rounded text-[10px] font-semibold", d.accent.soft, d.accent.text)}>{d.n}</span>
                  <span className="flex-1 truncate">{x.title}</span>
                  {x.kind === "roadmap" && <span className="text-xs text-muted">Next step</span>}
                </button>
              </li>
            );
          })}
          {items.length === 0 && <li className="px-2 py-4 text-sm text-muted">Nothing matches.</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
