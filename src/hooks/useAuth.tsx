import * as React from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { callFunction, unwrap } from "@/lib/api";
import type { Membership, Profile, WorkspaceSettings } from "@/lib/types";

interface AuthState {
  session: Session | null;
  loading: boolean;
  profile: Profile | null;
  membership: Membership | null;
  settings: WorkspaceSettings | null;
  isAdmin: boolean;
  /** Cross-cutting: every business unit plus the Executive View. */
  isExec: boolean;
  canContribute: boolean;
  /** Message to show after a forced sign-out (suspension, idle timeout). */
  endedReason: string | null;
  signIn: (email: string, password: string) => Promise<{ status: string }>;
  signOut: (reason?: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = React.createContext<AuthState | null>(null);

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}

const HEARTBEAT_MS = 2 * 60 * 1000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = React.useState<Session | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [endedReason, setEndedReason] = React.useState<string | null>(null);
  const uid = session?.user.id ?? null;

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) qc.clear();
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  const me = useQuery({
    queryKey: ["me", uid],
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: async () => {
      const [p, m] = await Promise.all([
        supabase.from("profiles").select("id, username, display_name").eq("id", uid!).maybeSingle(),
        supabase.from("workspace_memberships").select("role, status, all_units").eq("user_id", uid!).maybeSingle(),
      ]);
      return { profile: unwrap(p) as Profile | null, membership: unwrap(m) as Membership | null };
    },
  });
  const membership = me.data?.membership ?? null;
  const active = membership?.status === "active";

  const settings = useQuery({
    queryKey: ["settings"],
    enabled: !!uid && active,
    queryFn: async () =>
      unwrap(await supabase.from("workspace_settings").select("*").single()) as WorkspaceSettings,
  });

  const signOut = React.useCallback(
    async (reason?: string) => {
      try {
        await callFunction("heartbeat", { event: "logout" }, { auth: true });
      } catch {
        /* best effort */
      }
      if (reason) setEndedReason(reason);
      await supabase.auth.signOut({ scope: "local" });
      qc.clear();
    },
    [qc],
  );

  const refresh = React.useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["me"] });
  }, [qc]);

  const signIn = React.useCallback(async (email: string, password: string) => {
    const res = await callFunction<{ status: string; session: { access_token: string; refresh_token: string } }>("login", {
      email,
      password,
    });
    const { error } = await supabase.auth.setSession(res.session);
    if (error) throw error;
    setEndedReason(null);
    return { status: res.status };
  }, []);

  // Heartbeat: presence for admins, trusted-IP activity log, and instant
  // reaction to suspension (the server is authoritative either way).
  React.useEffect(() => {
    if (!uid) return;
    let stopped = false;
    const beat = async () => {
      try {
        const r = await callFunction<{ status: string }>("heartbeat", {}, { auth: true });
        if (stopped) return;
        if (r.status && !["active", "pending", "unknown"].includes(r.status)) {
          await signOut("Your access to this workspace has been paused by an administrator.");
        } else if (membership && r.status !== "unknown" && r.status !== membership.status) {
          refresh();
        }
      } catch (e: any) {
        if (e?.status === 401) await signOut("Your session has ended. Please sign in again.");
      }
    };
    beat();
    const t = setInterval(beat, HEARTBEAT_MS);
    const onCheck = () => beat();
    window.addEventListener("lc:membership-check", onCheck);
    return () => {
      stopped = true;
      clearInterval(t);
      window.removeEventListener("lc:membership-check", onCheck);
    };
  }, [uid, membership?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // (Live membership changes are handled by RealtimeProvider.)

  // Idle timeout (configurable by admins; 0 disables).
  const idleMinutes = settings.data?.idle_timeout_minutes ?? 0;
  React.useEffect(() => {
    if (!uid || !idleMinutes) return;
    let last = Date.now();
    const bump = () => (last = Date.now());
    const events = ["pointerdown", "keydown", "scroll", "visibilitychange"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      if (Date.now() - last > idleMinutes * 60_000) signOut("You were signed out after a period of inactivity.");
    }, 60_000);
    return () => {
      clearInterval(t);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [uid, idleMinutes, signOut]);

  const value: AuthState = {
    session,
    loading: loading || (!!uid && me.isLoading),
    profile: me.data?.profile ?? null,
    membership,
    settings: settings.data ?? null,
    isAdmin: active && membership?.role === "admin",
    isExec: active && (membership?.role === "admin" || !!membership?.all_units),
    canContribute: active && (membership?.role === "admin" || membership?.role === "participant"),
    endedReason,
    signIn,
    signOut,
    refresh,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
