import { supabase } from "./supabase";

export class AppError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number,
  ) {
    super(message);
  }
  get isConflict() {
    return this.code === "LC409";
  }
  get isMembership() {
    return this.code === "LC401";
  }
}

const FRIENDLY: Record<string, string> = {
  "23505": "That already exists.",
  "23514": "That value isn't allowed.",
  "42501": "You don't have access to do that.",
  PGRST301: "Your session has ended. Please sign in again.",
};

/** Call a database function and translate errors into readable messages. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const code = error.code ?? undefined;
    const msg = code?.startsWith("LC") ? error.message : (code && FRIENDLY[code]) || "Something went wrong. Please try again.";
    if (code === "LC401") window.dispatchEvent(new Event("lc:membership-check"));
    throw new AppError(msg, code);
  }
  return data as T;
}

/** Throws a readable error for PostgREST select errors. */
export function unwrap<T>(res: { data: T | null; error: { code?: string; message: string } | null }): T {
  if (res.error) {
    const code = res.error.code;
    throw new AppError((code && FRIENDLY[code]) || "We couldn't load this. Please try again.", code);
  }
  return res.data as T;
}

/** POST to one of our Netlify Functions. */
export async function callFunction<T = any>(path: string, body: Record<string, unknown>, opts: { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.auth) {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new AppError("Your session has ended. Please sign in again.", undefined, 401);
    headers.authorization = `Bearer ${data.session.access_token}`;
  }
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw new AppError("We couldn't reach the server. Check your connection and try again.");
  }
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) throw new AppError(payload?.error ?? `Request failed (${res.status}).`, undefined, res.status);
  return payload as T;
}
