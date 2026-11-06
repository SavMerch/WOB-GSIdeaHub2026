import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { AppError, rpc, unwrap } from "@/lib/api";
import type {
  BdItem, Category, Comment, Contribution, HealthSummaryRow, PrioritySummaryRow, RelatedItem, RoadmapItem,
} from "@/lib/types";

export const CONTRIBUTION_SELECT =
  "*, author:profiles!contributions_author_id_fkey(username, display_name), category:categories(label, key)";

// Shared data refreshes on realtime events; polling is a safety net only.
const FALLBACK_POLL = 60_000;

// Every unit-scoped query key starts with [kind, unitId, ...] so realtime
// invalidation by kind still reaches it.

export function useContributions(unitId: string, board: string) {
  return useQuery({
    queryKey: ["contributions", unitId, board],
    refetchInterval: FALLBACK_POLL,
    queryFn: async () =>
      unwrap(
        await supabase.from("contributions").select(CONTRIBUTION_SELECT).eq("unit_id", unitId).eq("board", board)
          .order("created_at", { ascending: false }).limit(500),
      ) as Contribution[],
  });
}

export function useRecentContributions(unitId: string, limit = 6, orderBy: "created_at" | "last_activity_at" = "created_at") {
  return useQuery({
    queryKey: ["contributions", unitId, "recent", orderBy, limit],
    queryFn: async () => {
      let q = supabase.from("contributions").select(CONTRIBUTION_SELECT).eq("unit_id", unitId).eq("hidden", false).eq("archived", false);
      if (orderBy === "last_activity_at") q = q.gt("comment_count", 0);
      return unwrap(await q.order(orderBy, { ascending: false }).limit(limit)) as Contribution[];
    },
  });
}

export function useTopContributions(unitId: string, boards: string[], limit = 5) {
  return useQuery({
    queryKey: ["contributions", unitId, "top", boards.join(","), limit],
    queryFn: async () =>
      unwrap(
        await supabase.from("contributions").select(CONTRIBUTION_SELECT).eq("unit_id", unitId).in("board", boards)
          .eq("hidden", false).eq("archived", false)
          .order("resonates_count", { ascending: false }).order("comment_count", { ascending: false }).limit(limit),
      ) as Contribution[],
  });
}

export function useFocusItems(unitId: string) {
  return useQuery({
    queryKey: ["focus", unitId],
    queryFn: async () =>
      unwrap(
        await supabase.from("contributions").select(CONTRIBUTION_SELECT).eq("unit_id", unitId).not("nominated_at", "is", null)
          .eq("hidden", false).order("support_count", { ascending: false }).order("nominated_at", { ascending: true }),
      ) as Contribution[],
  });
}

export function useCategories(board: string) {
  return useQuery({
    queryKey: ["categories", board],
    staleTime: 5 * 60_000,
    queryFn: async () =>
      unwrap(await supabase.from("categories").select("*").eq("board", board).order("sort")) as Category[],
  });
}

/** The ids the current user has reacted to, per kind. */
export function useMyReactions() {
  return useQuery({
    queryKey: ["my-reactions"],
    queryFn: async () => {
      const rows = unwrap(await supabase.from("contribution_reactions").select("contribution_id, kind")) as {
        contribution_id: string;
        kind: string;
      }[];
      return new Set(rows.map((r) => `${r.kind}:${r.contribution_id}`));
    },
  });
}

export function useComments(parent: { contributionId?: string; roadmapId?: string; bdItemId?: string }, enabled = true) {
  const key = parent.contributionId ?? parent.roadmapId ?? parent.bdItemId;
  return useQuery({
    queryKey: ["comments", key],
    enabled: enabled && !!key,
    queryFn: async () => {
      let q = supabase.from("contribution_comments").select("*, author:profiles!contribution_comments_author_id_fkey(username)");
      q = parent.contributionId
        ? q.eq("contribution_id", parent.contributionId)
        : parent.roadmapId
          ? q.eq("roadmap_item_id", parent.roadmapId)
          : q.eq("bd_item_id", parent.bdItemId!);
      return unwrap(await q.order("created_at")) as Comment[];
    },
  });
}

export function useRelated(kind: "contribution" | "roadmap", id: string, enabled = true) {
  return useQuery({
    queryKey: ["related", kind, id],
    enabled,
    queryFn: () => rpc<RelatedItem[]>("get_related", { p_kind: kind, p_id: id }),
  });
}

export function useRoadmap(unitId: string) {
  return useQuery({
    queryKey: ["roadmap", unitId],
    refetchInterval: FALLBACK_POLL,
    queryFn: async () =>
      unwrap(
        await supabase
          .from("roadmap_items")
          .select(
            "*, owner:profiles!roadmap_items_owner_id_fkey(username), creator:profiles!roadmap_items_created_by_fkey(username), contributors:roadmap_contributors(user_id, role, profile:profiles(username))",
          )
          .eq("unit_id", unitId)
          .order("created_at"),
      ) as RoadmapItem[],
  });
}

export function useHealthSummary(unitId: string) {
  return useQuery({
    queryKey: ["health-summary", unitId],
    queryFn: () => rpc<HealthSummaryRow[]>("get_health_summary", { p_unit_id: unitId }),
  });
}
export function usePrioritySummary(unitId: string) {
  return useQuery({
    queryKey: ["priority-summary", unitId],
    queryFn: () => rpc<PrioritySummaryRow[]>("get_priority_summary", { p_unit_id: unitId }),
  });
}

export function useActivity(unitId: string, limit = 15) {
  return useQuery({
    queryKey: ["activity", unitId, limit],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("activity_events")
          .select("id, event_type, dashboard, entity_type, entity_id, summary, created_at, actor:profiles(username)")
          .eq("unit_id", unitId)
          .order("created_at", { ascending: false })
          .limit(limit),
      ) as unknown as {
        id: number;
        event_type: string;
        dashboard: number | null;
        entity_type: string | null;
        entity_id: string | null;
        summary: string;
        created_at: string;
        actor: { username: string } | null;
      }[],
  });
}

/** People who can own or contribute in a unit (assigned members + cross-cutting). */
export function useMembers(unitId: string) {
  return useQuery({
    queryKey: ["members", unitId],
    staleTime: 5 * 60_000,
    queryFn: () => rpc<{ id: string; username: string; display_name: string }[]>("get_unit_members", { p_unit: unitId }),
  });
}

export const BD_SELECT =
  "*, owner:profiles!bd_items_owner_id_fkey(username), creator:profiles!bd_items_created_by_fkey(username), editor:profiles!bd_items_updated_by_fkey(username)";

export function useBdItems(unitId: string, kind: string) {
  return useQuery({
    queryKey: ["bd", unitId, kind],
    refetchInterval: FALLBACK_POLL,
    queryFn: async () =>
      unwrap(await supabase.from("bd_items").select(BD_SELECT).eq("unit_id", unitId).eq("kind", kind).order("created_at")) as BdItem[],
  });
}

// ---------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------
const isNetwork = (e: unknown) => !(e instanceof AppError && e.code);

/**
 * Generic mutation: shows an error toast on failure and never reports
 * success unless the server confirmed it. Calls that carry a client
 * request id are retried safely on network failures.
 */
export function useAction<TVars, TResult = unknown>(
  fn: (v: TVars) => Promise<TResult>,
  opts: { success?: string; invalidate?: string[][]; retry?: boolean } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    retry: opts.retry ? (count, e) => count < 2 && isNetwork(e) : false,
    onSuccess: () => {
      if (opts.success) toast.success(opts.success);
      (opts.invalidate ?? []).forEach((k) => qc.invalidateQueries({ queryKey: k }));
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
      if (e instanceof AppError && e.isConflict) (opts.invalidate ?? []).forEach((k) => qc.invalidateQueries({ queryKey: k }));
    },
  });
}

/** Optimistic reaction toggle — counts update instantly, reconcile on reply. */
export function useToggleReaction(listKey?: unknown[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; kind: "resonates" | "support" | "top" }) =>
      rpc<boolean>("toggle_reaction", { p_contribution_id: v.id, p_kind: v.kind }),
    onMutate: async (v) => {
      const mine = qc.getQueryData<Set<string>>(["my-reactions"]);
      const key = `${v.kind}:${v.id}`;
      const had = mine?.has(key) ?? false;
      if (mine) {
        const next = new Set(mine);
        had ? next.delete(key) : next.add(key);
        qc.setQueryData(["my-reactions"], next);
      }
      const field = v.kind === "resonates" ? "resonates_count" : v.kind === "support" ? "support_count" : "top_count";
      const prev = listKey ? qc.getQueryData<Contribution[]>(listKey) : undefined;
      if (listKey && prev) {
        qc.setQueryData<Contribution[]>(listKey, prev.map((c) =>
          c.id === v.id ? { ...c, [field]: Math.max(0, c[field] + (had ? -1 : 1)) } : c));
      }
      return { mine, prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.mine) qc.setQueryData(["my-reactions"], ctx.mine);
      if (listKey && ctx?.prev) qc.setQueryData(listKey, ctx.prev);
      toast.error(e instanceof Error ? e.message : "Couldn't save that.");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["my-reactions"] });
      qc.invalidateQueries({ queryKey: ["contributions"] });
      qc.invalidateQueries({ queryKey: ["focus"] });
    },
  });
}

/** For deep links (?item=…): which board holds the item, so pages can open the right tab. */
export function useItemBoard(): string | undefined {
  const id = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("item") : null;
  const { data } = useQuery({
    queryKey: ["item-board", id],
    enabled: !!id,
    queryFn: async () => {
      const r = await supabase.from("contributions").select("board").eq("id", id!).maybeSingle();
      return (r.data?.board as string | undefined) ?? "roadmap";
    },
  });
  return data;
}
