// Administrator operations that need the Supabase secret key (Auth admin
// API, invitation code hashing). Every action first proves the caller is a
// currently-active administrator using the database's own is_admin(), and
// status/role changes run through the audited SQL functions as that user.
import type { Config, Context } from "@netlify/functions";
import { randomBytes } from "node:crypto";
import {
  appUrl, bearer, fail, json, rateLimit, readJsonPost, safe, serviceClient, userClient,
} from "../lib/server";
import { EMAIL_RE, USERNAME_RE, hashSecret, validateInviteCode } from "../lib/security";

const ROLES = new Set(["admin", "participant", "viewer"]);

export default safe(async (req: Request, _context: Context) => {
  const body = await readJsonPost(req);
  if (body instanceof Response) return body;
  const token = bearer(req);
  if (!token) return fail(401, "Not signed in.");

  const svc = serviceClient();
  const { data: who, error: whoErr } = await svc.auth.getUser(token);
  if (whoErr || !who.user) return fail(401, "Your session has ended. Please sign in again.");
  const asUser = userClient(token);
  const { data: isAdmin } = await asUser.rpc("is_admin");
  if (isAdmin !== true) return fail(403, "Administrator access required.");
  if (!(await rateLimit(svc, `admin:${who.user.id}`, 120, 60))) return fail(429, "Slow down a little.");

  const adminId = who.user.id;
  const audit = (action: string, target_type: string, target_id: string | null, details: object = {}) =>
    svc.from("administrative_audit_logs").insert({ actor_id: adminId, action, target_type, target_id, details });
  const targetId = typeof body.userId === "string" ? body.userId : "";

  switch (body.action) {
    // ---------------- Invitation code ----------------
    case "invite_code_status": {
      const { data } = await svc
        .from("invitation_codes")
        .select("id, label, active, expires_at, max_uses, use_count, created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      return json({ codes: data ?? [] });
    }
    case "set_invite_code": {
      const problem = validateInviteCode(body.code);
      if (problem) return fail(400, problem);
      const maxUses = body.maxUses == null || body.maxUses === "" ? null : Number(body.maxUses);
      if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10000))
        return fail(400, "Maximum uses must be a whole number between 1 and 10,000.");
      const expiresAt = typeof body.expiresAt === "string" && body.expiresAt ? new Date(body.expiresAt) : null;
      if (expiresAt && (isNaN(expiresAt.getTime()) || expiresAt < new Date()))
        return fail(400, "The expiry date must be in the future.");
      const code_hash = await hashSecret(body.code as string);
      await svc.from("invitation_codes").update({ active: false }).eq("active", true);
      const { error } = await svc.from("invitation_codes").insert({
        code_hash,
        label: typeof body.label === "string" ? body.label.slice(0, 80) : null,
        expires_at: expiresAt?.toISOString() ?? null,
        max_uses: maxUses,
        created_by: adminId,
        active: true,
      });
      if (error) throw error;
      await svc.from("workspace_settings").update({ invitation_code_enabled: true }).eq("workspace_id", "00000000-0000-0000-0000-000000000001");
      await audit("invite_code.set", "invitation_code", null, { expires_at: expiresAt, max_uses: maxUses });
      return json({ ok: true });
    }
    case "disable_invite_code": {
      await svc.from("invitation_codes").update({ active: false }).eq("active", true);
      await audit("invite_code.disable", "invitation_code", null);
      return json({ ok: true });
    }

    // ---------------- People ----------------
    case "suspend":
    case "deprovision":
    case "reactivate": {
      if (!targetId) return fail(400, "Missing user.");
      const status = body.action === "reactivate" ? "active" : body.action === "suspend" ? "suspended" : "deprovisioned";
      const { error } = await asUser.rpc("admin_set_status", { p_user_id: targetId, p_status: status });
      if (error) return fail(400, error.message);
      // Ban at the Auth layer so refresh tokens stop working, then revoke
      // what we can. RLS already refuses the user's requests immediately.
      const { error: banErr } = await svc.auth.admin.updateUserById(targetId, {
        ban_duration: status === "active" ? "none" : "876000h",
      });
      let revoked: number | null = null;
      if (status !== "active") {
        const { data } = await asUser.rpc("admin_revoke_sessions", { p_user_id: targetId });
        revoked = typeof data === "number" ? data : null;
      }
      return json({ ok: true, status, authBanApplied: !banErr, sessionsRevoked: revoked });
    }
    case "revoke_sessions": {
      if (!targetId) return fail(400, "Missing user.");
      const { data, error } = await asUser.rpc("admin_revoke_sessions", { p_user_id: targetId });
      if (error) return fail(400, error.message);
      return json({ ok: true, sessionsRevoked: data });
    }
    case "invite":
    case "provision": {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const username = typeof body.username === "string" ? body.username.trim() : "";
      const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 80) : "";
      const role = typeof body.role === "string" && ROLES.has(body.role) ? body.role : "participant";
      if (!EMAIL_RE.test(email)) return fail(400, "Enter a valid email address.");
      if (!USERNAME_RE.test(username)) return fail(400, "Usernames are 3–32 letters, numbers, dots, dashes, or underscores.");
      if (!displayName) return fail(400, "Enter a display name.");
      const { data: taken } = await svc.from("profiles").select("id").ilike("username", username.replace(/[%_\\]/g, "\\$&")).maybeSingle();
      if (taken) return fail(409, "That username is taken.");

      const redirectTo = `${appUrl(req)}/reset-password`;
      let userId: string;
      let setupLink: string | null = null;
      if (body.action === "invite") {
        const { data, error } = await svc.auth.admin.inviteUserByEmail(email, {
          redirectTo,
          data: { username, display_name: displayName },
        });
        if (error || !data.user) return fail(400, error?.message ?? "Could not send the invitation.");
        userId = data.user.id;
      } else {
        const { data, error } = await svc.auth.admin.createUser({
          email,
          password: randomBytes(24).toString("base64url") + "aA1!",
          email_confirm: true,
          user_metadata: { username, display_name: displayName },
        });
        if (error || !data.user) return fail(400, error?.message ?? "Could not create the account.");
        userId = data.user.id;
        const { data: link } = await svc.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
        setupLink = link?.properties?.action_link ?? null;
      }
      const { error: pErr } = await svc.from("profiles").insert({ id: userId, username, display_name: displayName });
      if (pErr) {
        await svc.auth.admin.deleteUser(userId);
        return fail(409, "That username is taken.");
      }
      await svc.from("workspace_memberships").insert({
        user_id: userId,
        role,
        status: "active",
        approved_by: adminId,
        approved_at: new Date().toISOString(),
      });
      await svc.from("invitations").insert({ email, role, user_id: userId, invited_by: adminId, status: "accepted" });
      await audit(`member.${body.action}`, "user", userId, { role });
      return json({ ok: true, userId, setupLink });
    }
    default:
      return fail(400, "Unknown action.");
  }
});

export const config: Config = { path: "/api/admin" };
