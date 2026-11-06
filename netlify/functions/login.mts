// Email + password sign-in, performed server-side so that every attempt
// is rate limited and logged with Netlify's trusted client IP. Returns the
// Supabase session to the browser, which installs it with setSession().
import type { Config, Context } from "@netlify/functions";
import { fail, json, logAuthEvent, publicClient, rateLimit, readJsonPost, safe, serviceClient, sleep } from "../lib/server";
import { EMAIL_RE, sessionIdFromJwt, trustedIp, userAgent } from "../lib/security";

const GENERIC = "That email and password combination didn't work.";

export default safe(async (req: Request, context: Context) => {
  const body = await readJsonPost(req);
  if (body instanceof Response) return body;
  const ip = trustedIp(context);
  const ua = userAgent(req);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const svc = serviceClient();

  const okIp = await rateLimit(svc, `login:ip:${ip ?? "unknown"}`, 20, 15 * 60);
  const okEmail = await rateLimit(svc, `login:email:${email}`, 8, 15 * 60);
  if (!okIp || !okEmail) {
    await logAuthEvent(svc, { event_type: "login_rate_limited", success: false, ip, user_agent: ua, email });
    return fail(429, "Too many sign-in attempts. Please wait 15 minutes, or reset your password.");
  }
  if (!EMAIL_RE.test(email) || password.length === 0 || password.length > 128) return fail(401, GENERIC);

  const { data, error } = await publicClient().auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    await sleep(200 + Math.random() * 300);
    const { data: matches } = await svc.rpc("svc_lookup_user_by_email", { p_email: email });
    const prof = (matches as { id: string; username: string }[] | null)?.[0];
    await logAuthEvent(svc, {
      event_type: "login_failure",
      success: false,
      ip,
      user_agent: ua,
      email,
      user_id: prof?.id ?? null,
      username: prof?.username ?? null,
      details: { reason: error?.code ?? "unknown" },
    });
    return fail(401, GENERIC);
  }

  const sessionId = sessionIdFromJwt(data.session.access_token);
  const { data: rec, error: recErr } = await svc.rpc("svc_record_login", {
    p_user_id: data.user.id,
    p_ip: ip,
    p_user_agent: ua,
    p_session_id: sessionId,
  });
  if (recErr) throw recErr;
  const status = (rec as { status: string }).status;

  if (status !== "active" && status !== "pending") {
    // Suspended, removed, rejected, or never registered through the gate:
    // revoke the session that Supabase just issued.
    await svc.auth.admin.signOut(data.session.access_token, "global");
    const msg =
      status === "rejected"
        ? "Your account request wasn't approved. Please contact an administrator."
        : "This account doesn't currently have access. Please contact an administrator.";
    return fail(403, msg);
  }

  return json({
    status,
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
  });
});

export const config: Config = { path: "/api/login" };
