import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key);

/**
 * Captured before the client consumes the URL: Supabase invite and
 * password-recovery links arrive as #access_token=…&type=invite|recovery.
 */
export const initialAuthLinkType: string | null = (() => {
  if (typeof window === "undefined") return null;
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return h.get("type");
})();

// The browser only ever holds the publishable key. RLS + SECURITY DEFINER
// functions enforce every permission server-side.
export const supabase = createClient(url ?? "http://localhost:54321", key ?? "missing-key", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "implicit",
  },
  realtime: { params: { eventsPerSecond: 10 } },
});
