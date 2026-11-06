// Handler-level tests for the Netlify Functions with a fake Supabase.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashSecret, verifyRegistrationToken } from "../../netlify/lib/security";

const state: any = {};
function fakeSupabase() {
  const from = (table: string) => {
    const q: any = {
      _table: table,
      select: () => q, eq: () => q, ilike: () => q, neq: () => q, order: () => q, limit: () => q,
      in: () => q,
      then: (resolve: any) => resolve({ data: state.tables[table] ?? [], error: null }),
      single: async () => ({ data: state.tables[table]?.[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: state.tables[table]?.[0] ?? null, error: null }),
      insert: async (row: any) => { (state.inserts[table] ??= []).push(row); return { error: null }; },
      update: () => q,
    };
    return q;
  };
  return {
    from,
    rpc: async (fn: string, args: any) => {
      state.rpcCalls.push([fn, args]);
      if (fn === "svc_rate_limit_hit") return { data: !state.rateLimited, error: null };
      if (fn === "svc_use_invitation_code") return { data: true, error: null };
      if (fn === "svc_record_login") return { data: { status: state.memberStatus }, error: null };
      if (fn === "svc_lookup_user_by_email") return { data: [], error: null };
      return { data: null, error: null };
    },
    auth: {
      signInWithPassword: async ({ password }: any) =>
        password === "Right-Pass-123"
          ? { data: { user: { id: "u1" }, session: { access_token: "h.e30.s", refresh_token: "r" } }, error: null }
          : { data: { user: null, session: null }, error: { code: "invalid_credentials" } },
      admin: { signOut: vi.fn(async () => ({ error: null })) },
    },
  };
}

vi.mock("../../netlify/lib/server", async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    serviceClient: () => state.client,
    publicClient: () => state.client,
    sleep: async () => {},
  };
});

const req = (body: unknown) =>
  new Request("https://example.netlify.app/api/x", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.netlify.app", "user-agent": "vitest" },
    body: JSON.stringify(body),
  });
const ctx = { ip: "198.51.100.20" } as any;

beforeEach(async () => {
  process.env.REGISTRATION_TOKEN_SECRET = "s".repeat(48);
  state.client = fakeSupabase();
  state.rpcCalls = [];
  state.inserts = {};
  state.rateLimited = false;
  state.memberStatus = "active";
  state.tables = {
    workspace_settings: [{ registration_open: true, invitation_code_enabled: true }],
    business_units: [{ id: "u1", name: "WOB Caribe (USVI/PR)" }],
    invitation_codes: [{ id: "c1", code_hash: await hashSecret("Open-Sesame-26"), expires_at: null, max_uses: null, use_count: 0 }],
  };
});

describe("gate function", () => {
  it("rejects a wrong code and logs the attempt with the trusted IP", async () => {
    const { default: gate } = await import("../../netlify/functions/gate.mts");
    const res = await gate(req({ code: "wrong-code" }), ctx);
    expect(res.status).toBe(401);
    const ev = state.inserts.authentication_events[0];
    expect(ev).toMatchObject({ event_type: "invite_code_failure", ip: "198.51.100.20", success: false });
  });
  it("issues a short-lived signed token for the right code", async () => {
    const { default: gate } = await import("../../netlify/functions/gate.mts");
    const res = await gate(req({ code: "Open-Sesame-26" }), ctx);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const claims = verifyRegistrationToken(process.env.REGISTRATION_TOKEN_SECRET!, body.registrationToken);
    expect(claims).not.toBeNull();
    expect(state.inserts.registration_tokens[0].jti).toBe(claims!.jti);
    expect(body.units).toEqual([{ id: "u1", name: "WOB Caribe (USVI/PR)" }]);
  });
  it("refuses when registration is closed, even with the right code", async () => {
    state.tables.workspace_settings = [{ registration_open: false, invitation_code_enabled: true }];
    const { default: gate } = await import("../../netlify/functions/gate.mts");
    expect((await gate(req({ code: "Open-Sesame-26" }), ctx)).status).toBe(403);
  });
  it("rate limits", async () => {
    state.rateLimited = true;
    const { default: gate } = await import("../../netlify/functions/gate.mts");
    expect((await gate(req({ code: "Open-Sesame-26" }), ctx)).status).toBe(429);
  });
  it("refuses cross-site requests", async () => {
    const { default: gate } = await import("../../netlify/functions/gate.mts");
    const r = new Request("https://example.netlify.app/api/gate", {
      method: "POST", headers: { origin: "https://evil.example" }, body: "{}",
    });
    expect((await gate(r, ctx)).status).toBe(403);
  });
});

describe("login function", () => {
  it("returns a generic error for bad credentials and logs a failure", async () => {
    const { default: login } = await import("../../netlify/functions/login.mts");
    const res = await login(req({ email: "a@example.com", password: "nope" }), ctx);
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error).toMatch(/didn't work/);
    expect(state.inserts.authentication_events[0].event_type).toBe("login_failure");
  });
  it("signs in an active member", async () => {
    const { default: login } = await import("../../netlify/functions/login.mts");
    const res = await login(req({ email: "a@example.com", password: "Right-Pass-123" }), ctx);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).session.access_token).toBe("h.e30.s");
    expect(state.rpcCalls.find((c: any) => c[0] === "svc_record_login")[1].p_ip).toBe("198.51.100.20");
  });
  it("refuses and revokes the session of a suspended member", async () => {
    state.memberStatus = "suspended";
    const { default: login } = await import("../../netlify/functions/login.mts");
    const res = await login(req({ email: "a@example.com", password: "Right-Pass-123" }), ctx);
    expect(res.status).toBe(403);
    expect(state.client.auth.admin.signOut).toHaveBeenCalled();
  });
});
