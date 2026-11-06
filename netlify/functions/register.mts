// Stage B — individual account request. Requires a valid, unused
// registration token from the gate. Creates the Supabase Auth user and a
// membership that is PENDING by default (admin approval required).
import type { Config, Context } from "@netlify/functions";
import { env, fail, json, logAuthEvent, rateLimit, readJsonPost, safe, serviceClient } from "../lib/server";
import { trustedIp, userAgent, validateRegistration, verifyRegistrationToken } from "../lib/security";

export default safe(async (req: Request, context: Context) => {
  const body = await readJsonPost(req);
  if (body instanceof Response) return body;
  const ip = trustedIp(context);
  const ua = userAgent(req);
  const svc = serviceClient();

  if (!(await rateLimit(svc, `register:ip:${ip ?? "unknown"}`, 6, 60 * 60))) {
    return fail(429, "Too many account requests from this network. Please try again later.");
  }

  const claims = verifyRegistrationToken(env("REGISTRATION_TOKEN_SECRET"), body.registrationToken);
  if (!claims) return fail(401, "Your invitation has expired. Please enter the invitation code again.");

  const parsed = validateRegistration(body);
  if (!parsed.ok) {
    await logAuthEvent(svc, { event_type: "registration_rejected_input", success: false, ip, user_agent: ua });
    return fail(400, parsed.error);
  }
  const input = parsed.value;

  const requestedUnitId = typeof body.unitId === "string" ? body.unitId : "";
  const { data: unit } = requestedUnitId
    ? await svc.from("business_units").select("id").eq("id", requestedUnitId).eq("active", true).maybeSingle()
    : { data: null };
  if (!unit) return fail(400, "Please choose your business unit.");

  const { data: settings } = await svc.from("workspace_settings").select("registration_open, require_approval").single();
  if (!settings?.registration_open) return fail(403, "New account requests are not being accepted right now.");

  // Usernames are public inside the workspace, so saying one is taken is fine.
  const { data: taken } = await svc.from("profiles").select("id").ilike("username", input.username.replace(/[%_\\]/g, "\\$&")).maybeSingle();
  if (taken) return fail(409, "That username is taken. Please choose another.");

  // Single use: consume the token atomically before creating anything.
  const { data: consumed } = await svc.rpc("svc_consume_registration_token", { p_jti: claims.jti });
  if (consumed !== true) return fail(401, "This invitation has already been used. Please enter the invitation code again.");

  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { username: input.username, display_name: input.displayName },
  });
  if (createErr || !created.user) {
    await logAuthEvent(svc, {
      event_type: "registration_request",
      success: false,
      ip,
      user_agent: ua,
      email: input.email,
      details: { reason: "create_failed" },
    });
    // Do not confirm whether the email already has an account.
    return fail(
      400,
      "We couldn't create that account. If you already have one, sign in or reset your password. Otherwise, re-enter the invitation code and try again.",
    );
  }
  const userId = created.user.id;
  const status = settings.require_approval ? "pending" : "active";

  const rollback = async () => {
    await svc.auth.admin.deleteUser(userId);
  };
  const { error: pErr } = await svc
    .from("profiles")
    .insert({ id: userId, username: input.username, display_name: input.displayName });
  if (pErr) {
    await rollback();
    return fail(409, pErr.code === "23505" ? "That username is taken. Please choose another." : "We couldn't create that account.");
  }
  const { error: mErr } = await svc.from("workspace_memberships").insert({
    user_id: userId,
    role: "participant",
    status,
    approved_at: status === "active" ? new Date().toISOString() : null,
  });
  if (mErr) {
    await rollback();
    throw mErr;
  }
  if (status === "active") {
    await svc.from("unit_memberships").insert({ user_id: userId, unit_id: unit.id });
  }
  await svc.from("registration_requests").insert({
    user_id: userId,
    requested_unit_id: unit.id,
    email: input.email,
    username: input.username,
    display_name: input.displayName,
    ip,
    user_agent: ua,
    status: status === "active" ? "approved" : "pending",
  });
  await logAuthEvent(svc, {
    event_type: "registration_request",
    success: true,
    ip,
    user_agent: ua,
    user_id: userId,
    username: input.username,
    email: input.email,
    account_status: status,
  });
  return json({ ok: true, status });
});

export const config: Config = { path: "/api/register" };
