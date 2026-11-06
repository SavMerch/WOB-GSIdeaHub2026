import * as React from "react";
import { useSearchParams } from "react-router";
import {
  Archive, ChevronDown, Flag, Heart, MessageSquare, MoreHorizontal, Pencil, Plus, Star, Target, Trash2,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { rpc } from "@/lib/api";
import type { Contribution } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { STATUS_LABEL } from "@/lib/dashboards";
import { useAction, useCategories, useContributions, useMyReactions, useToggleReaction } from "@/hooks/data";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge, Card, Select, Spinner } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/primitives";
import { AuthorLine, EmptyState, StatusBadge } from "./common";
import { CommentThread, RelatedItems } from "./Discussion";
import { ContributionForm, type FormConfig } from "./ContributionForm";

export interface BoardOptions extends Omit<FormConfig, "categories"> {
  addLabel: string;
  emptyTitle: string;
  emptyText?: string;
  reactionKind?: "resonates" | "support";
  reactionLabel?: string;
  enableTop?: boolean;
  enableSolutions?: boolean;
  enableNominate?: boolean;
  enableFilters?: boolean;
  groupByCategory?: boolean;
  layout?: "grid" | "list";
  /** Admin-only: allow confirming items as shared commitments. */
  enableCommitment?: boolean;
  /** Pre-filter to one category (e.g. a prompt within a board). */
  categoryKey?: string;
}

type SortKey = "newest" | "resonates" | "discussed" | "significant" | "active";

export function ContributionBoard(opts: BoardOptions) {
  const { canContribute, settings } = useAuth();
  const { data, isLoading, error } = useContributions(opts.board);
  const { data: categories } = useCategories(opts.board);
  const [params, setParams] = useSearchParams();
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Contribution | null>(null);
  const [sort, setSort] = React.useState<SortKey>(opts.enableTop ? "resonates" : "newest");
  const [cat, setCat] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [showArchived, setShowArchived] = React.useState(false);
  const focusId = params.get("item");

  const fixedCategory = categories?.find((c) => c.key === opts.categoryKey);
  const items = React.useMemo(() => {
    let list = (data ?? []).filter((c) => showArchived || !c.archived);
    if (fixedCategory) list = list.filter((c) => c.category_id === fixedCategory.id);
    if (cat) list = list.filter((c) => c.category_id === cat);
    if (status) list = list.filter((c) => c.status === status);
    const by: Record<SortKey, (a: Contribution, b: Contribution) => number> = {
      newest: (a, b) => b.created_at.localeCompare(a.created_at),
      resonates: (a, b) => primaryCount(b, opts) - primaryCount(a, opts) || b.created_at.localeCompare(a.created_at),
      discussed: (a, b) => b.comment_count - a.comment_count || b.created_at.localeCompare(a.created_at),
      significant: (a, b) => b.top_count - a.top_count || b.resonates_count - a.resonates_count,
      active: (a, b) => b.last_activity_at.localeCompare(a.last_activity_at),
    };
    return [...list].sort(by[sort]);
  }, [data, cat, status, sort, showArchived, fixedCategory, opts]);

  const allowAnon = opts.allowAnonymous && settings?.allow_anonymous !== false;
  const formConfig: FormConfig = { ...opts, categories: fixedCategory ? undefined : categories, allowAnonymous: allowAnon };

  const grouped = opts.groupByCategory && !cat
    ? (categories ?? []).map((c) => ({ key: c.id, label: c.label, items: items.filter((i) => i.category_id === c.id) }))
        .concat([{ key: "none", label: "Other", items: items.filter((i) => !i.category_id) }])
        .filter((g) => g.items.length > 0)
    : [{ key: "all", label: "", items }];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {canContribute && (
          <Button variant="brand" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus /> {opts.addLabel}
          </Button>
        )}
        {opts.enableFilters && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!fixedCategory && categories && categories.length > 0 && (
              <Select aria-label="Filter by category" className="h-9 w-auto" value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            )}
            <Select aria-label="Filter by status" className="h-9 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              {["open", "discussing", "addressed", ...(opts.enableCommitment ? ["commitment"] : [])].map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </Select>
            <Select aria-label="Sort" className="h-9 w-auto" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="resonates">Most support</option>
              {opts.enableTop && <option value="significant">Marked most significant</option>}
              <option value="discussed">Most discussed</option>
              <option value="active">Recently active</option>
              <option value="newest">Newest</option>
            </Select>
            <label className="flex items-center gap-1.5 text-sm text-muted">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-[var(--color-brand)]" />
              Show archived
            </label>
          </div>
        )}
      </div>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <EmptyState title="We couldn't load this board">{(error as Error).message}</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState
          title={opts.emptyTitle}
          action={canContribute ? <Button variant="outline" onClick={() => setFormOpen(true)}><Plus /> {opts.addLabel}</Button> : undefined}
        >
          {opts.emptyText ?? "Nothing here yet — be the first to add something."}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          {grouped.map((g) => (
            <section key={g.key} aria-label={g.label || undefined}>
              {g.label && <h3 className="eyebrow mb-3 text-muted">{g.label} <span className="font-sans normal-case tracking-normal">({g.items.length})</span></h3>}
              <div className={cn(opts.layout === "list" ? "flex flex-col gap-3" : "grid gap-4 md:grid-cols-2")}>
                {g.items.map((c) => (
                  <ContributionCard
                    key={c.id}
                    item={c}
                    opts={opts}
                    autoOpen={focusId === c.id}
                    onEdit={() => { setEditing(c); setFormOpen(true); }}
                    onClearFocus={() => { params.delete("item"); setParams(params, { replace: true }); }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <ContributionForm open={formOpen} onOpenChange={setFormOpen} config={formConfig} editing={editing} defaultCategoryId={fixedCategory?.id} />
    </div>
  );
}

function primaryCount(c: Contribution, opts: BoardOptions) {
  return opts.reactionKind === "support" ? c.support_count : c.resonates_count;
}

export function ContributionCard({
  item: c, opts, autoOpen, onEdit, onClearFocus,
}: { item: Contribution; opts: BoardOptions; autoOpen?: boolean; onEdit: () => void; onClearFocus?: () => void }) {
  const { profile, canContribute, isAdmin } = useAuth();
  const [open, setOpen] = React.useState(!!autoOpen);
  const [reporting, setReporting] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const { data: mine } = useMyReactions();
  const toggle = useToggleReaction(opts.board);
  const kind = opts.reactionKind ?? "resonates";
  const reacted = mine?.has(`${kind}:${c.id}`);
  const markedTop = mine?.has(`top:${c.id}`);
  const isMine = !!profile && c.author_id === profile.id;

  React.useEffect(() => {
    if (autoOpen && ref.current) {
      setOpen(true);
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
      ref.current.classList.add("lc-flash");
      const t = setTimeout(() => onClearFocus?.(), 2500);
      return () => clearTimeout(t);
    }
  }, [autoOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = useAction((s: string) => rpc("set_contribution_status", { p_id: c.id, p_status: s }), {
    success: "Status updated", invalidate: [["contributions"]],
  });
  const nominate = useAction(() => rpc("set_focus_nomination", { p_id: c.id, p_nominated: true }), {
    success: "Added to “What should we focus on?”", invalidate: [["contributions"], ["focus"]],
  });
  const remove = useAction(() => rpc("delete_contribution", { p_id: c.id }), {
    success: "Removed", invalidate: [["contributions"], ["home"]],
  });
  const archive = useAction(() => rpc("admin_moderate", { p_kind: "contribution", p_id: c.id, p_hidden: null, p_archived: !c.archived }), {
    success: c.archived ? "Restored" : "Archived", invalidate: [["contributions"]],
  });

  const count = kind === "support" ? c.support_count : c.resonates_count;
  const detailLabels = Object.fromEntries((opts.detailFields ?? []).map((f) => [f.key, f.label]));

  return (
    <Card ref={ref} className={cn("flex flex-col", c.hidden && "border-danger/40 opacity-75", c.archived && "opacity-70")}>
      <div className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {c.category && <Badge tone="outline">{c.category.label}</Badge>}
          <StatusBadge status={c.status} />
          {c.nominated_at && <Badge tone="brand"><Target className="size-3" aria-hidden /> Focus</Badge>}
          {c.archived && <Badge>Archived</Badge>}
          {c.hidden && <Badge tone="danger">Hidden{c.hidden_reason ? `: ${c.hidden_reason}` : ""}</Badge>}
          <div className="ml-auto">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink" aria-label="More actions">
                <MoreHorizontal className="size-4" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-48 rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
                  {isMine && <MenuItem onSelect={onEdit} icon={Pencil}>Edit</MenuItem>}
                  {canContribute && opts.enableNominate && !c.nominated_at && (
                    <MenuItem onSelect={() => nominate.mutate(undefined)} icon={Target}>Suggest as a focus</MenuItem>
                  )}
                  {(isMine || isAdmin) && (
                    <>
                      <DropdownMenu.Separator className="my-1 h-px bg-line" />
                      <DropdownMenu.Label className="px-2 py-1 text-xs text-muted">Set status</DropdownMenu.Label>
                      {(["open", "discussing", "addressed"] as const).map((s) => (
                        <MenuItem key={s} onSelect={() => status.mutate(s)} disabled={c.status === s}>{STATUS_LABEL[s]}</MenuItem>
                      ))}
                    </>
                  )}
                  {isAdmin && opts.enableCommitment && c.status !== "commitment" && (
                    <MenuItem onSelect={() => status.mutate("commitment")} icon={Star}>Confirm as shared commitment</MenuItem>
                  )}
                  <DropdownMenu.Separator className="my-1 h-px bg-line" />
                  {!isMine && <MenuItem onSelect={() => setReporting(true)} icon={Flag}>Report to an administrator</MenuItem>}
                  {isAdmin && <MenuItem onSelect={() => archive.mutate(undefined)} icon={Archive}>{c.archived ? "Restore" : "Archive"}</MenuItem>}
                  {(isMine || isAdmin) && (
                    <MenuItem onSelect={() => confirm("Remove this permanently, including its discussion?") && remove.mutate(undefined)} icon={Trash2} danger>
                      Remove
                    </MenuItem>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>

        <h3 className="text-[15px] font-semibold leading-snug text-ink">{c.title}</h3>
        {c.body && <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{c.body}</p>}
        {Object.keys(c.details ?? {}).length > 0 && (
          <dl className="grid gap-2 rounded-lg bg-canvas p-3 text-sm">
            {Object.entries(c.details).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-medium text-muted">{detailLabels[k] ?? k}</dt>
                <dd className="whitespace-pre-wrap text-ink-soft">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <AuthorLine anonymous={c.is_anonymous} username={c.author?.username} when={c.created_at} />
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-line px-3 py-2">
        <Button
          size="sm"
          variant={reacted ? "soft" : "ghost"}
          aria-pressed={!!reacted}
          disabled={!canContribute || c.archived}
          onClick={() => toggle.mutate({ id: c.id, kind })}
        >
          <Heart className={cn(reacted && "fill-current")} /> {opts.reactionLabel ?? "This resonates"}
          <span className="tabular-nums">{count > 0 ? count : ""}</span>
        </Button>
        {opts.enableTop && (
          <Button
            size="sm"
            variant={markedTop ? "soft" : "ghost"}
            aria-pressed={!!markedTop}
            disabled={!canContribute || c.archived}
            title="Mark up to three issues as the most significant"
            onClick={() => toggle.mutate({ id: c.id, kind: "top" })}
          >
            <Star className={cn(markedTop && "fill-current")} /> {markedTop ? "Most significant" : "Mark significant"}
            <span className="tabular-nums">{c.top_count > 0 ? c.top_count : ""}</span>
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" aria-expanded={open} onClick={() => setOpen(!open)}>
          <MessageSquare /> {c.comment_count > 0 ? `${c.comment_count}` : "Build on this"}
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </div>

      {open && (
        <div className="flex flex-col gap-5 border-t border-line bg-canvas/50 p-5">
          <CommentThread contributionId={c.id} allowSolutions={opts.enableSolutions} />
          <RelatedItems kind="contribution" id={c.id} />
          <p className="text-xs text-muted">Last activity {timeAgo(c.last_activity_at)}</p>
        </div>
      )}
      <ReportDialog open={reporting} onOpenChange={setReporting} contributionId={c.id} />
    </Card>
  );
}

function MenuItem({ children, onSelect, icon: Icon, danger, disabled }: { children: React.ReactNode; onSelect: () => void; icon?: React.ElementType; danger?: boolean; disabled?: boolean }) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none data-[disabled]:cursor-default data-[disabled]:opacity-40 data-[highlighted]:bg-canvas",
        danger && "text-danger",
      )}
    >
      {Icon && <Icon className="size-4" aria-hidden />}
      {children}
    </DropdownMenu.Item>
  );
}

export function ReportDialog({ open, onOpenChange, contributionId, commentId }: { open: boolean; onOpenChange: (o: boolean) => void; contributionId?: string; commentId?: string }) {
  const [reason, setReason] = React.useState("");
  const report = useAction(
    () => rpc("report_content", { p_contribution_id: contributionId ?? null, p_comment_id: commentId ?? null, p_reason: reason }),
    { success: "Thanks — an administrator will take a look." },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title="Report to an administrator" description="Reports are seen only by administrators." />
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            report.mutate(undefined, { onSuccess: () => { setReason(""); onOpenChange(false); } });
          }}
        >
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What's the concern?" maxLength={1000} required aria-label="Reason" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={report.isPending} disabled={!reason.trim()}>Send report</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

