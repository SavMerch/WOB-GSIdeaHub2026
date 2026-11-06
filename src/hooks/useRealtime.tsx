import * as React from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { matchPath, useLocation } from "react-router";
import { useAuth } from "./useAuth";
import { useUnits } from "./useUnit";

export type ConnectionState = "idle" | "connecting" | "live" | "reconnecting" | "offline";

interface RealtimeState {
  state: ConnectionState;
  online: { user_id: string; username: string }[];
}

const Ctx = React.createContext<RealtimeState>({ state: "connecting", online: [] });
export const useRealtime = () => React.useContext(Ctx);

/** Which cached queries to refresh when a table changes. */
const TABLE_KEYS: Record<string, string[][]> = {
  contributions: [["contributions"], ["home"], ["focus"], ["admin-content"], ["related"]],
  contribution_comments: [["comments"], ["contributions"], ["home"]],
  contribution_links: [["related"]],
  roadmap_items: [["roadmap"], ["home"], ["related"]],
  roadmap_contributors: [["roadmap"]],
  activity_events: [["activity"]],
  categories: [["categories"]],
  workspace_settings: [["settings"]],
  workspace_memberships: [["admin-people"], ["admin-overview"], ["me"]],
  bd_items: [["bd"], ["home"], ["comments"]],
  unit_memberships: [["units"], ["my-units"], ["members"]],
  business_units: [["units"]],
};

/**
 * One private channel for the business unit being viewed ('unit:<id>').
 * Joining is authorized by RLS on realtime.messages (can_join_topic); row
 * changes are filtered by each table's RLS, so a participant only ever
 * receives rows from units they can see.
 * Presence carries only the username — never what page someone is on, so
 * it can't be correlated with anonymous posts.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { session, profile, membership, signOut } = useAuth();
  const qc = useQueryClient();
  const loc = useLocation();
  const { data: units } = useUnits();
  const slug = matchPath("/u/:unit/*", loc.pathname)?.params.unit;
  const unitId = units?.find((u) => u.slug === slug)?.id;
  const [state, setState] = React.useState<ConnectionState>("connecting");
  const [online, setOnline] = React.useState<RealtimeState["online"]>([]);
  const active = membership?.status === "active";
  const uid = session?.user.id;

  React.useEffect(() => {
    if (!uid || !active || !profile) return;
    if (!unitId) {
      setState("idle");
      setOnline([]);
      return;
    }
    setState("connecting");
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<string>();
    let flush: ReturnType<typeof setTimeout> | undefined;

    const invalidate = (table: string) => {
      pending.add(table);
      clearTimeout(flush);
      flush = setTimeout(() => {
        const keys = new Map<string, string[]>();
        pending.forEach((t) => (TABLE_KEYS[t] ?? []).forEach((k) => keys.set(k.join("|"), k)));
        pending.clear();
        keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      }, 150);
    };

    const connect = async (attempt = 0) => {
      await supabase.realtime.setAuth(session!.access_token);
      if (cancelled) return;
      const ch = supabase.channel(`unit:${unitId}`, { config: { private: true, presence: { key: uid } } });
      channel = ch;
      for (const table of Object.keys(TABLE_KEYS)) {
        channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
          if (table === "workspace_memberships") {
            const row = payload.new as { user_id?: string; status?: string };
            if (row?.user_id === uid && row.status && row.status !== "active") {
              signOut("Your access to this workspace has been paused by an administrator.");
              return;
            }
          }
          invalidate(table);
        });
      }
      channel.on("presence", { event: "sync" }, () => {
        const s = channel!.presenceState<{ user_id: string; username: string }>();
        const seen = new Map<string, { user_id: string; username: string }>();
        Object.values(s).flat().forEach((p) => seen.set(p.user_id, { user_id: p.user_id, username: p.username }));
        setOnline([...seen.values()].sort((a, b) => a.username.localeCompare(b.username)));
      });
      ch.subscribe(async (status) => {
        if (cancelled || ch !== channel) return;
        if (status === "SUBSCRIBED") {
          setState("live");
          await channel!.track({ user_id: uid, username: profile.username });
          // Catch up on anything missed while disconnected.
          Object.keys(TABLE_KEYS).forEach(invalidate);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setState(navigator.onLine ? "reconnecting" : "offline");
          channel = null;
          supabase.removeChannel(ch);
          const delay = Math.min(30_000, 1000 * 2 ** attempt);
          retry = setTimeout(() => connect(attempt + 1), delay);
        }
      });
    };
    connect();

    const onOffline = () => setState("offline");
    const onOnline = () => setState((s) => (s === "live" ? s : "reconnecting"));
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      clearTimeout(retry);
      clearTimeout(flush);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      if (channel) supabase.removeChannel(channel);
    };
    // access_token intentionally excluded: supabase-js re-auths the socket on refresh.
  }, [uid, active, profile?.username, unitId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={{ state, online }}>{children}</Ctx.Provider>;
}
