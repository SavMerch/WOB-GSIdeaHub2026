import * as React from "react";
import { Check, Copy, MailPlus, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { callFunction, rpc } from "@/lib/api";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { useAction } from "@/hooks/data";
import { useAuth } from "@/hooks/useAuth";
import { useUnits, type Unit } from "@/hooks/useUnit";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Notice, Select, Spinner, Switch } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Table, Td, Th, usePeople, type Person } from "./shared";

const ONLINE_MS = 5 * 60_000;

export function People() {
  const { data, isLoading } = usePeople();
  const { data: units } = useUnits();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [unitFilter, setUnitFilter] = React.useState("");
  if (isLoading) return <Spinner />;
  const pending = (data ?? []).filter((p) => p.status === "pending");
  const others = (data ?? []).filter((p) => p.status !== "pending").filter((p) =>
    !unitFilter || (unitFilter === "cross" ? p.all_units : unitFilter === "none" ? !p.all_units && p.unit_ids.length === 0 : p.unit_ids.includes(unitFilter)));
  const unassigned = (data ?? []).filter((p) => p.status === "active" && !p.all_units && p.role !== "admin" && p.unit_ids.length === 0).length;
  return (
    <div className="flex flex-col gap-6">
      {pending.length > 0 && (
        <Card className="border-d2/40">
          <CardHeader>
            <CardTitle>Waiting for approval ({pending.length})</CardTitle>
            <CardDescription>New accounts can't see anything until approved. Confirm each person's business unit as you approve them.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {pending.map((p) => <PendingRow key={p.user_id} p={p} units={units ?? []} />)}
          </CardContent>
        </Card>
      )}
      {unassigned > 0 && (
        <Notice tone="warn">{unassigned} active {unassigned === 1 ? "person isn't" : "people aren't"} assigned to a business unit yet, so they can't see any dashboards. Use the unit filter → “Not assigned” to find them.</Notice>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-display text-lg font-semibold">Everyone</h2>
        <Select aria-label="Filter by business unit" className="h-9 w-auto" value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)}>
          <option value="">All units</option>
          {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.short_name}</option>)}
          <option value="cross">Cross-cutting</option>
          <option value="none">Not assigned</option>
        </Select>
        <Button variant="brand" onClick={() => setInviteOpen(true)}><MailPlus /> Invite or add someone</Button>
      </div>
      <Table>
        <thead>
          <tr><Th>Person</Th><Th>Business unit(s)</Th><Th>Role</Th><Th>Status</Th><Th>Last sign-in</Th><Th>Last active</Th><Th>Last IP</Th><Th className="text-right">Actions</Th></tr>
        </thead>
        <tbody>{others.map((p) => <PersonRow key={p.user_id} p={p} units={units ?? []} />)}</tbody>
      </Table>
      <p className="text-xs text-muted">IP addresses identify networks, not people or devices. Offices, mobile carriers and VPNs share them.</p>
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} units={units ?? []} />
    </div>
  );
}

/** Checkbox list of units + the cross-cutting switch. */
function UnitChooser({ units, value, onChange, allUnits, onAllUnits }: {
  units: Unit[]; value: string[]; onChange: (v: string[]) => void; allUnits: boolean; onAllUnits: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">Business unit(s)</legend>
        {units.map((u) => (
          <label key={u.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-[var(--color-brand)]" checked={value.includes(u.id)}
              onChange={(e) => onChange(e.target.checked ? [...value, u.id] : value.filter((x) => x !== u.id))} />
            {u.name}
          </label>
        ))}
      </fieldset>
      <div className="flex items-start justify-between gap-3 rounded-lg border border-line bg-canvas p-3">
        <div>
          <p className="text-sm font-medium">Cross-cutting</p>
          <p className="text-xs text-muted">Sees and contributes in every unit, plus the Executive View. Survey answers are still given only in their assigned unit(s).</p>
        </div>
        <Switch checked={allUnits} onCheckedChange={onAllUnits} aria-label="Cross-cutting" />
      </div>
    </div>
  );
}

function PendingRow({ p, units }: { p: Person; units: Unit[] }) {
  const [role, setRole] = React.useState("participant");
  const [unitIds, setUnitIds] = React.useState<string[]>(p.requested_unit_id ? [p.requested_unit_id] : []);
  const requested = units.find((u) => u.id === p.requested_unit_id);
  const review = useAction((approve: boolean) => rpc("admin_review_registration", {
    p_user_id: p.user_id, p_approve: approve, p_role: role, p_note: null, p_unit_ids: unitIds, p_all_units: false,
  }), { invalidate: [["admin-people"], ["admin-overview"]] });
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line p-3 lg:flex-row lg:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{p.display_name} <span className="text-muted">@{p.username}</span></p>
        <p className="text-xs text-muted">{p.email} · requested {timeAgo(p.joined_at)}{requested ? ` · asked for ${requested.short_name}` : ""}{p.last_ip ? ` · from ${p.last_ip}` : ""}</p>
      </div>
      <Select aria-label="Business unit" className="h-9 w-auto" value={unitIds[0] ?? ""} onChange={(e) => setUnitIds(e.target.value ? [e.target.value] : [])}>
        <option value="">Business unit…</option>
        {units.map((u) => <option key={u.id} value={u.id}>{u.short_name}</option>)}
      </Select>
      <Select aria-label="Role" className="h-9 w-auto" value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="participant">Participant</option><option value="viewer">Viewer (read-only)</option><option value="admin">Administrator</option>
      </Select>
      <div className="flex gap-2">
        <Button size="sm" variant="brand" disabled={unitIds.length === 0} loading={review.isPending && review.variables === true}
          onClick={() => review.mutate(true, { onSuccess: () => toast.success(`${p.username} approved`) })}><Check /> Approve</Button>
        <Button size="sm" variant="outline" loading={review.isPending && review.variables === false}
          onClick={() => confirm(`Reject ${p.username}'s request?`) && review.mutate(false, { onSuccess: () => toast(`${p.username} rejected`) })}><X /> Reject</Button>
      </div>
    </div>
  );
}

function PersonRow({ p, units }: { p: Person; units: Unit[] }) {
  const { profile } = useAuth();
  const self = p.user_id === profile?.id;
  const [editing, setEditing] = React.useState(false);
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
  const names = p.unit_ids.map((id) => units.find((u) => u.id === id)?.short_name).filter(Boolean);
  return (
    <tr>
      <Td><span className="font-medium">{p.username}</span>{self && <span className="text-muted"> (you)</span>}<span className="block text-xs text-muted">{p.display_name} · {p.email}</span></Td>
      <Td>
        <div className="flex flex-wrap items-center gap-1">
          {p.all_units && <Badge tone="brand">Cross-cutting</Badge>}
          {names.map((n) => <Badge key={n} tone="outline">{n}</Badge>)}
          {!p.all_units && names.length === 0 && <Badge tone="warn">Not assigned</Badge>}
          <button className="rounded p-1 text-muted hover:bg-canvas hover:text-ink" aria-label={`Change business units for ${p.username}`} onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
          </button>
        </div>
      </Td>
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
        <UnitsDialog open={editing} onOpenChange={setEditing} p={p} units={units} />
      </Td>
    </tr>
  );
}

function UnitsDialog({ open, onOpenChange, p, units }: { open: boolean; onOpenChange: (o: boolean) => void; p: Person; units: Unit[] }) {
  const [ids, setIds] = React.useState<string[]>(p.unit_ids);
  const [all, setAll] = React.useState(p.all_units);
  React.useEffect(() => { if (open) { setIds(p.unit_ids); setAll(p.all_units); } }, [open, p]);
  const save = useAction(() => rpc("admin_set_units", { p_user_id: p.user_id, p_unit_ids: ids, p_all_units: all }), {
    success: "Business units updated", invalidate: [["admin-people"], ["admin-overview"]],
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="text-left">
        <DialogHeader title={`Business units for ${p.username}`} description="They'll see only the units checked here (or everything, if cross-cutting). Changes apply immediately." />
        <UnitChooser units={units} value={ids} onChange={setIds} allUnits={all} onAllUnits={setAll} />
        {p.role === "admin" && <p className="mt-3 text-xs text-muted">Administrators can always see every unit, for moderation.</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="brand" loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => onOpenChange(false) })}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({ open, onOpenChange, units }: { open: boolean; onOpenChange: (o: boolean) => void; units: Unit[] }) {
  const blank = { email: "", username: "", displayName: "", role: "participant", mode: "invite" };
  const [v, setV] = React.useState(blank);
  const [unitIds, setUnitIds] = React.useState<string[]>([]);
  const [allUnits, setAllUnits] = React.useState(false);
  const [link, setLink] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setLink(null); setV(blank); setUnitIds([]); setAllUnits(false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = useAction(
    () => callFunction<{ setupLink: string | null }>("admin", {
      action: v.mode, email: v.email, username: v.username, displayName: v.displayName, role: v.role, unitIds, allUnits,
    }, { auth: true }),
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
            <UnitChooser units={units} value={unitIds} onChange={setUnitIds} allUnits={allUnits} onAllUnits={setAllUnits} />
            <Button type="submit" variant="brand" loading={go.isPending} disabled={!allUnits && unitIds.length === 0}>
              {v.mode === "invite" ? "Send invitation" : "Create account"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
