// Shared plumbing for Netlify Functions: env, Supabase clients, responses.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new ConfigError(`Missing server environment variable ${name}`);
  return v;
}

export class ConfigError extends Error {}

const clientOpts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

/** Privileged client. Server-only; bypasses RLS. */
export function serviceClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), clientOpts);
}

/** Unprivileged client (publishable/anon key), e.g. for password sign-in. */
export function publicClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), clientOpts);
}

/** Acts as the calling user so RLS and in-database admin checks apply. */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    ...clientOpts,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export function appUrl(req: Request): string {
  return (process.env.APP_URL || process.env.URL || new URL(req.url).origin).replace(/\/$/, "");
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

export const fail = (status: number, error: string) => json({ error }, status);

/**
 * Basic request hygiene for every function: POST only, JSON body under
 * 16 KB, and — as CSRF defense in depth, even though auth uses bearer
 * tokens rather than cookies — the Origin must match this site.
 */
export async function readJsonPost(req: Request): Promise<Record<string, unknown> | Response> {
  if (req.method !== "POST") return fail(405, "Method not allowed.");
  const origin = req.headers.get("origin");
  if (origin) {
    const allowed = new Set([new URL(req.url).origin, process.env.APP_URL, process.env.URL, process.env.DEPLOY_PRIME_URL]);
    if (!allowed.has(origin.replace(/\/$/, ""))) return fail(403, "Cross-site request refused.");
  }
  const text = await req.text();
  if (text.length > 16_384) return fail(413, "Request too large.");
  try {
    const parsed = JSON.parse(text || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail(400, "Invalid request.");
    return parsed;
  } catch {
    return fail(400, "Invalid request.");
  }
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

/** Returns true when the request is within the limit. */
export async function rateLimit(svc: SupabaseClient, bucket: string, max: number, windowSeconds: number) {
  const { data, error } = await svc.rpc("svc_rate_limit_hit", {
    p_bucket: bucket,
    p_max: max,
    p_window_seconds: windowSeconds,
  });
  if (error) throw error;
  return data === true;
}

export async function logAuthEvent(
  svc: SupabaseClient,
  e: {
    event_type: string;
    success: boolean;
    ip: string | null;
    user_agent: string | null;
    user_id?: string | null;
    username?: string | null;
    email?: string | null;
    account_status?: string | null;
    session_id?: string | null;
    unusual?: boolean;
    details?: Record<string, unknown>;
  },
) {
  const { error } = await svc.from("authentication_events").insert({ details: {}, ...e });
  if (error) console.error("auth event log failed", error.message);
}

/** Wraps a handler so unexpected errors never leak internals. */
export function safe(handler: (req: Request, ctx: any) => Promise<Response>) {
  return async (req: Request, ctx: any) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      console.error(e);
      if (e instanceof ConfigError) return fail(500, "The server is not fully configured yet.");
      return fail(500, "Something went wrong. Please try again.");
    }
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
