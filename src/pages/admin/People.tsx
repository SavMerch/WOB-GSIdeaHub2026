import * as React from "react";
import { Check, Copy, MailPlus, X } from "lucide-react";
import { toast } from "sonner";
import { callFunction, rpc } from "@/lib/api";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { useAction } from "@/hooks/data";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Notice, Select, Spinner } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Table, Td, Th, usePeople, type Person } from "./shared";

const ONLINE_MS = 5 * 60_000;

export function People() {
  const { data, isLoading } = usePeople();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  if (isLoading) return <Spinner />;
  const pending = (data ?? []).filter((p) => p.status === "pending");
  const others = (data ?? []).filter((p) => p.status !== "pending");
  return (
    <div className="flex flex-col gap-6">
      {pending.length > 0 && (
        <Card className="border-d2/40">
          <CardHeader><CardTitle>Waiting for approval ({pending.length})</CardTitle><CardDescription>New accounts can't see anything until approved.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {pending.map((p) => <PendingRow key={p.user_id} p={p} />)}
          </CardContent>
        </Card>
      )}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Everyone</h2>
        <Button variant="brand" onClick={() => setInviteOpen(true)}><MailPlus /> Invite or add someone</Button>
      </div>
      <Table>
        <thead>
          <tr><Th>Person</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th>Last sign-in</Th><Th>Last active</Th><Th>Last IP</Th><Th className="text-right">Actions</Th></tr>
        </thead>
        <tbody>{others.map((p) => <PersonRow key={p.user_id} p={p} />)}</tbody>
      </Table>
      <p className="text-xs text-muted">IP addresses identify networks, not people or devices. Offices, mobile carriers and VPNs share them.</p>
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}

function PendingRow({ p }: { p: Person }) {
  const [role, setRole] = React.useState("participant");
  const review = useAction((approve: boolean) => rpc("admin_review_registration", { p_user_id: p.user_id, p_approve: approve, p_role: role, p_note: null }), {
    invalidate: [["admin-people"], ["admin-overview"]],
  });
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{p.display_name} <span className="text-muted">@{p.username}</span></p>
        <p className="text-xs text-muted">{p.email} · requested {timeAgo(p.joined_at)}{p.last_ip ? ` · from ${p.last_ip}` : ""}</p>
      </div>
      <Select aria-label="Role" className="h-9 w-auto" value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="participant">Participant</option><option value="viewer">Viewer (read-only)</option><option value="admin">Administrator</option>
      </Select>
      <div className="flex gap-2">
        <Button size="sm" variant="brand" loading={review.isPending && review.variables === true} onClick={() => review.mutate(true, { onSuccess: () => toast.success(`${p.username} approved`) })}><Check /> Approve</Button>
        <Button size="sm" variant="outline" loading={review.isPending && review.variables === false} onClick={() => confirm(`Reject ${p.username}'s request?`) && review.mutate(false, { onSuccess: () => toast(`${p.username} rejected`) })}><X /> Reject</Button>
      </div>
    </div>
  );
}

function PersonRow({ p }: { p: Person }) {
  const { profile } = useAuth();
  const self = p.user_id === profile?.id;
  const setRole = useAction((role: string) => rpc("admin_set_role", { p_user_id: p.user_id, p_role: role }), { success: "Role updated", invalidate: [["admin-people"]] });
  const act = useAction(
    async (action: string) => {
      const r = await callFunction<{ authBanApplied?: boolean; sessionsRevoked?: number | null }>("admin", { action, userId: p.user_id }, { auth: true });
      if (action !== "reactivate" && r.sessionsRevoked === -1) toast.info("Access is blocked now. Existing refresh tokens will stop working when the Auth ban takes effect.");
      return r;
    },
    { success: "Done", invalidate: [["admin-people"], ["admin-overview"]] },
  );
  const online = p.last_seen_at && Date.now() - new Date(p.last_seen_at).getTime() < ONLINE_MS && p.status === "active";
  const tone = p.status === "active" ? "success" : p.status === "suspended" || p.status === "deprovisioned" ? "danger" : "neutral";
  return (
    <tr>
      <Td><span className="font-medium">{p.username}</span>{self && <span className="text-muted"> (you)</span>}<span className="block text-xs text-muted">{p.display_name}</span></Td>
      <Td className="text-ink-soft">{p.email}</Td>
      <Td>
        <Select aria-label={`Role for ${p.username}`} className="h-8 w-auto text-xs" value={p.role} disabled={setRole.isPending} onChange={(e) => setRole.mutate(e.target.value)}>
          <option value="admin">Administrator</option><option value="participant">Participant</option><option value="viewer">Viewer</option>
        </Select>
      </Td>
      <Td><Badge tone={tone}>{p.status}</Badge>{online && <Badge tone="brand" className="ml-1">Online</Badge>}</Td>
      <Td className="text-xs">{formatDateTime(p.last_login_at)}</Td>
      <Td className="text-xs">{p.last_seen_at ? timeAgo(p.last_seen_at) : "—"}</Td>
      <Td className="font-mono text-xs">{p.last_ip ?? "—"}</Td>
      <Td className="text-right">
        {!self && (
          <div className="flex justify-end gap-1">
            {p.status === "active" ? (
              <>
                <Button size="sm" variant="outline" onClick={() => confirm(`Suspend ${p.username}? They lose access immediately.`) && act.mutate("suspend")}>Suspend</Button>
                <Button size="sm" variant="ghost" title="Sign them out everywhere" onClick={() => act.mutate("revoke_sessions")}>Sign out</Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => act.mutate("reactivate")}>Reactivate</Button>
            )}
            {p.status !== "deprovisioned" && (
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => confirm(`Remove ${p.username}'s access permanently? Their past named contributions remain.`) && act.mutate("deprovision")}>Remove</Button>
            )}
          </div>
        )}
      </Td>
    </tr>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [v, setV] = React.useState({ email: "", username: "", displayName: "", role: "participant", mode: "invite" });
  const [link, setLink] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setLink(null); setV({ email: "", username: "", displayName: "", role: "participant", mode: "invite" }); } }, [open]);
  const go = useAction(
    () => callFunction<{ setupLink: string | null }>("admin", { action: v.mode, email: v.email, username: v.username, displayName: v.displayName, role: v.role }, { auth: true }),
    { invalidate: [["admin-people"]] },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title="Invite or add someone" description="People added here are approved immediately." />
        {link ? (
          <div className="flex flex-col gap-3">
            <Notice>Account created. Send this one-time setup link to them privately — it lets them choose a password and expires.</Notice>
            <Input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Setup link" />
            <Button onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Copied"))}><Copy /> Copy link</Button>
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={(e) => {
            e.preventDefault();
            go.mutate(undefined, {
              onSuccess: (r) => {
                if (v.mode === "provision" && r.setupLink) setLink(r.setupLink);
                else { toast.success("Invitation sent"); onOpenChange(false); }
              },
            });
          }}>
            <Field label="How" htmlFor="i-mode">
              <Select id="i-mode" value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })}>
                <option value="invite">Email them an invitation (uses Supabase email)</option>
                <option value="provision">Create the account and give me a setup link</option>
              </Select>
            </Field>
            <Field label="Email" htmlFor="i-em"><Input id="i-em" type="email" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
            <Field label="Display name" htmlFor="i-dn"><Input id="i-dn" required value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} /></Field>
            <Field label="Username" htmlFor="i-un"><Input id="i-un" required pattern="[A-Za-z0-9_.\-]{3,32}" value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} /></Field>
            <Field label="Role" htmlFor="i-role">
              <Select id="i-role" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>
                <option value="participant">Participant</option><option value="viewer">Viewer (read-only)</option><option value="admin">Administrator</option>
              </Select>
            </Field>
            <Button type="submit" variant="brand" loading={go.isPending}>{v.mode === "invite" ? "Send invitation" : "Create account"}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
