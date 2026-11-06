// Password reset request. Always answers the same way whether or not the
// email exists (no account enumeration). Supabase sends the email; the link
// returns to /reset-password where the user chooses a new password.
import type { Config, Context } from "@netlify/functions";
import { appUrl, json, logAuthEvent, publicClient, rateLimit, readJsonPost, safe, serviceClient, sleep } from "../lib/server";
import { EMAIL_RE, trustedIp, userAgent } from "../lib/security";

const OK = { ok: true, message: "If that email belongs to an account, a reset link is on its way." };

export default safe(async (req: Request, context: Context) => {
  const body = await readJsonPost(req);
  if (body instanceof Response) return body;
  const ip = trustedIp(context);
  const ua = userAgent(req);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const svc = serviceClient();

  const okIp = await rateLimit(svc, `reset:ip:${ip ?? "unknown"}`, 5, 60 * 60);
  const okEmail = await rateLimit(svc, `reset:email:${email}`, 3, 60 * 60);
  if (!okIp || !okEmail || !EMAIL_RE.test(email)) {
    await sleep(300);
    return json(OK);
  }
  await publicClient().auth.resetPasswordForEmail(email, { redirectTo: `${appUrl(req)}/reset-password` });
  await logAuthEvent(svc, { event_type: "password_reset_request", success: true, ip, user_agent: ua, email });
  return json(OK);
});

export const config: Config = { path: "/api/password-reset" };
