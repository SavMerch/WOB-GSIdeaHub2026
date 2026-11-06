// Called by signed-in browsers every ~2 minutes. Verifies the access token
// with Supabase, updates last-seen (for "who's online"), logs authenticated
// activity with the trusted IP (sparingly), and tells the client its
// current membership status so a suspension takes effect in the UI at once.
import type { Config, Context } from "@netlify/functions";
import { bearer, fail, json, logAuthEvent, rateLimit, readJsonPost, safe, serviceClient } from "../lib/server";
import { sessionIdFromJwt, trustedIp, userAgent } from "../lib/security";

export default safe(async (req: Request, context: Context) => {
  const body = await readJsonPost(req);
  if (body instanceof Response) return body;
  const token = bearer(req);
  if (!token) return fail(401, "Not signed in.");
  const svc = serviceClient();
  const { data, error } = await svc.auth.getUser(token);
  if (error || !data.user) return fail(401, "Your session has ended. Please sign in again.");

  if (!(await rateLimit(svc, `hb:${data.user.id}`, 40, 10 * 60))) return json({ status: "unknown" });

  const ip = trustedIp(context);
  const ua = userAgent(req);
  const sessionId = sessionIdFromJwt(token);

  if (body.event === "logout") {
    await logAuthEvent(svc, {
      event_type: "logout",
      success: true,
      ip,
      user_agent: ua,
      user_id: data.user.id,
      session_id: sessionId,
    });
    return json({ ok: true });
  }

  const { data: res, error: hbErr } = await svc.rpc("svc_heartbeat", {
    p_user_id: data.user.id,
    p_ip: ip,
    p_user_agent: ua,
    p_session_id: sessionId,
  });
  if (hbErr) throw hbErr;
  return json(res);
});

export const config: Config = { path: "/api/heartbeat" };
