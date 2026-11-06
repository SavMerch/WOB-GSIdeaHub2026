// Stage A — invitation gate. Verifies the shared code server-side and, on
// success, issues a 15-minute, single-use registration authorization.
// The token grants NOTHING except the right to submit one account request.
import type { Config, Context } from "@netlify/functions";
import { fail, env, json, logAuthEvent, rateLimit, readJsonPost, safe, serviceClient, sleep } from "../lib/server";
import { signRegistrationToken, trustedIp, userAgent, verifySecret } from "../lib/security";

export default safe(async (req: Request, context: Context) => {
  const body = await readJsonPost(req);
  if (body instanceof Response) return body;
  const ip = trustedIp(context);
  const ua = userAgent(req);
  const svc = serviceClient();

  const okIp = await rateLimit(svc, `gate:ip:${ip ?? "unknown"}`, 8, 15 * 60);
  const okGlobal = await rateLimit(svc, "gate:global", 300, 60 * 60);
  if (!okIp || !okGlobal) {
    await logAuthEvent(svc, { event_type: "invite_code_rate_limited", success: false, ip, user_agent: ua });
    return fail(429, "Too many attempts. Please wait a few minutes and try again.");
  }

  const code = typeof body.code === "string" ? body.code : "";
  const { data: settings } = await svc
    .from("workspace_settings")
    .select("registration_open, invitation_code_enabled")
    .single();
  const { data: active } = await svc
    .from("invitation_codes")
    .select("id, code_hash, expires_at, max_uses, use_count")
    .eq("active", true)
    .maybeSingle();

  const usable =
    settings?.registration_open &&
    settings?.invitation_code_enabled &&
    active &&
    (!active.expires_at || new Date(active.expires_at) > new Date()) &&
    (active.max_uses == null || active.use_count < active.max_uses);

  // Always do the expensive comparison so timing doesn't reveal state.
  const matches = code.length > 0 && code.length <= 128
    ? await verifySecret(code, active?.code_hash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
    : false;

  if (!matches || !usable) {
    await sleep(250 + Math.random() * 250);
    await logAuthEvent(svc, {
      event_type: "invite_code_failure",
      success: false,
      ip,
      user_agent: ua,
      details: { reason: matches ? "registration_closed" : "wrong_code" },
    });
    if (matches && !usable) return fail(403, "New account requests are not being accepted right now.");
    return fail(401, "That invitation code didn't work. Please check it and try again.");
  }

  const { data: counted } = await svc.rpc("svc_use_invitation_code", { p_id: active!.id });
  if (counted !== true) return fail(403, "This invitation code is no longer valid.");

  const { token, claims } = signRegistrationToken(env("REGISTRATION_TOKEN_SECRET"));
  const { error } = await svc.from("registration_tokens").insert({
    jti: claims.jti,
    expires_at: new Date(claims.exp * 1000).toISOString(),
    ip,
  });
  if (error) throw error;
  await logAuthEvent(svc, { event_type: "invite_code_success", success: true, ip, user_agent: ua });
  return json({ registrationToken: token, expiresAt: claims.exp * 1000 });
});

export const config: Config = { path: "/api/gate" };
