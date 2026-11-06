import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { callFunction, rpc } from "@/lib/api";
import { download, toCsv } from "@/lib/csv";
import { formatDateTime } from "@/lib/utils";
import { useAction } from "@/hooks/data";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Notice, Select, Switch } from "@/components/ui/primitives";
import { EVENT_LABEL, Table, Td, Th, useAuthEvents } from "./shared";

export function Security() {
  return (
    <div className="flex flex-col gap-6">
      <Notice>
        Security activity is visible only to administrators and is used for access management — not to monitor
        productivity. IP addresses come from the hosting provider's edge (client-supplied headers are ignored) and identify
        a network, not a device.
      </Notice>
      <div className="grid gap-4 lg:grid-cols-2">
        <InviteCodeCard />
        <RegistrationCard />
      </div>
      <ActivityLog />
    </div>
  );
}

function InviteCodeCard() {
  const status = useQuery({
    queryKey: ["admin-invite-code"],
    queryFn: () => callFunction<{ codes: { id: string; label: string | null; active: boolean; expires_at: string | null; max_uses: number | null; use_count: number; created_at: string }[] }>("admin", { action: "invite_code_status" }, { auth: true }),
  });
  const [v, setV] = React.useState({ code: "", label: "", expiresAt: "", maxUses: "" });
  const set = useAction(() => callFunction("admin", { action: "set_invite_code", ...v }, { auth: true }), {
    success: "New invitation password is active", invalidate: [["admin-invite-code"], ["settings"]],
  });
  const disable = useAction(() => callFunction("admin", { action: "disable_invite_code" }, { auth: true }), {
    success: "Invitation password disabled", invalidate: [["admin-invite-code"]],
  });
  const active = status.data?.codes.find((c) => c.active);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="size-4" aria-hidden /> Invitation password</CardTitle>
        <CardDescription>Stored only as a one-way hash — it can't be viewed, only replaced.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {active ? (
          <div className="rounded-lg bg-canvas p-3 text-sm">
            <Badge tone="success">Active</Badge> {active.label && <span className="ml-1 font-medium">{active.label}</span>}
            <p className="mt-1 text-xs text-muted">
              Set {formatDateTime(active.created_at)} · used {active.use_count}{active.max_uses ? ` of ${active.max_uses}` : ""} times
              {active.expires_at ? ` · expires ${formatDateTime(active.expires_at)}` : ""}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">No invitation password is active — the welcome gate is closed.</p>
        )}
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); set.mutate(undefined, { onSuccess: () => setV({ code: "", label: "", expiresAt: "", maxUses: "" }) }); }}>
          <Field label={active ? "Replace with a new password" : "Set a password"} htmlFor="ic" hint="At least 8 characters. Share it privately; changing it immediately invalidates the old one.">
            <Input id="ic" type="text" autoComplete="off" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} minLength={8} maxLength={128} required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Label (optional)" htmlFor="il"><Input id="il" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} maxLength={80} /></Field>
            <Field label="Expires (optional)" htmlFor="ie"><Input id="ie" type="datetime-local" value={v.expiresAt} onChange={(e) => setV({ ...v, expiresAt: e.target.value })} /></Field>
            <Field label="Max uses (optional)" htmlFor="im"><Input id="im" type="number" min={1} value={v.maxUses} onChange={(e) => setV({ ...v, maxUses: e.target.value })} /></Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="brand" loading={set.isPending}>Save password</Button>
            {active && <Button type="button" variant="outline" loading={disable.isPending} onClick={() => confirm("Disable the invitation password? Nobody new can request an account until you set another.") && disable.mutate(undefined)}>Disable</Button>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function RegistrationCard() {
  const { settings } = useAuth();
  const save = useAction((s: Record<string, unknown>) => rpc("admin_update_settings", { p_settings: s }), { success: "Saved", invalidate: [["settings"]] });
  if (!settings) return null;
  const row = (key: "registration_open" | "require_approval", label: string, hint: string) => (
    <div className="flex items-start justify-between gap-4">
      <div><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted">{hint}</p></div>
      <Switch checked={settings[key]} aria-label={label} onCheckedChange={(c) => {
        if (key === "require_approval" && !c && !confirm("Turn off approval? Anyone with the invitation password will get access immediately.")) return;
        save.mutate({ [key]: c });
      }} />
    </div>
  );
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="size-4" aria-hidden /> Registration</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-5">
        {row("registration_open", "Accept new account requests", "When off, the welcome gate refuses every code.")}
        {row("require_approval", "Require administrator approval", "Strongly recommended. New accounts stay on “Awaiting approval” until you approve them.")}
        <p className="text-xs text-muted">Security log retention: {settings.log_retention_days} days (change in Workspace Settings).</p>
      </CardContent>
    </Card>
  );
}

function ActivityLog() {
  const [filter, setFilter] = React.useState("all");
  const { data, isLoading } = useAuthEvents(filter, 200);
  const exportLog = async (fmt: "csv" | "json") => {
    try {
      const rows = await rpc<Record<string, unknown>[]>("admin_export", { p_kind: "security" });
      const stamp = new Date().toISOString().slice(0, 10);
      if (fmt === "csv") download(`security-log-${stamp}.csv`, toCsv(rows), "text/csv");
      else download(`security-log-${stamp}.json`, JSON.stringify(rows, null, 2), "application/json");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-display text-lg font-semibold">Access activity</h2>
        <Select aria-label="Filter events" className="h-9 w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All events</option>
          <option value="logins">Sign-ins</option>
          <option value="failed">Failed attempts</option>
          <option value="unusual">Unusual</option>
          <option value="invite">Invitation-code attempts</option>
          <option value="registration">Account requests</option>
          <option value="activity">Session activity</option>
        </Select>
        <Button size="sm" variant="outline" onClick={() => exportLog("csv")}>Export CSV</Button>
        <Button size="sm" variant="outline" onClick={() => exportLog("json")}>Export JSON</Button>
      </div>
      <Table>
        <thead><tr><Th>When</Th><Th>Event</Th><Th>Who</Th><Th>IP address</Th><Th>Browser</Th><Th>Account</Th></tr></thead>
        <tbody>
          {isLoading && <tr><Td className="text-muted">Loading…</Td></tr>}
          {(data ?? []).map((e) => (
            <tr key={e.id} className={e.unusual ? "bg-danger-soft/50" : undefined}>
              <Td className="whitespace-nowrap text-xs">{formatDateTime(e.created_at)}</Td>
              <Td>
                <span className={e.success ? "" : "text-danger"}>{EVENT_LABEL[e.event_type] ?? e.event_type}</span>
                {e.unusual && <Badge tone="danger" className="ml-1">Unusual{Array.isArray((e.details as any)?.reasons) && (e.details as any).reasons.length ? `: ${(e.details as any).reasons.join(", ")}` : ""}</Badge>}
              </Td>
              <Td className="text-xs">{e.username ?? e.email ?? <span className="text-muted">—</span>}</Td>
              <Td className="font-mono text-xs">{e.ip ?? "—"}</Td>
              <Td className="max-w-56 truncate text-xs text-muted" >{e.user_agent ?? "—"}</Td>
              <Td className="text-xs">{e.account_status ?? "—"}</Td>
            </tr>
          ))}
          {!isLoading && (data ?? []).length === 0 && <tr><Td className="text-muted">No events.</Td></tr>}
        </tbody>
      </Table>
    </div>
  );
}
