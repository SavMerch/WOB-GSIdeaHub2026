import * as React from "react";
import { rpc } from "@/lib/api";
import { DASHBOARDS } from "@/lib/dashboards";
import { useAction } from "@/hooks/data";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Switch, Textarea } from "@/components/ui/primitives";
import type { WorkspaceSettings } from "@/lib/types";

export function Settings() {
  const { settings } = useAuth();
  const [v, setV] = React.useState<WorkspaceSettings | null>(null);
  React.useEffect(() => { if (settings) setV(settings); }, [settings]);
  const save = useAction(() => rpc("admin_update_settings", {
    p_settings: {
      app_name: v!.app_name, organization_name: v!.organization_name, welcome_message: v!.welcome_message,
      dashboard_descriptions: v!.dashboard_descriptions, allow_anonymous: v!.allow_anonymous,
      privacy_threshold: Number(v!.privacy_threshold), log_retention_days: Number(v!.log_retention_days),
      idle_timeout_minutes: Number(v!.idle_timeout_minutes), roadmap_start_date: v!.roadmap_start_date,
    },
  }), { success: "Settings saved", invalidate: [["settings"]] });
  if (!v) return null;
  return (
    <form className="grid gap-4 lg:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
      <Card>
        <CardHeader><CardTitle>Workspace</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label="Application name" htmlFor="s-an"><Input id="s-an" value={v.app_name} maxLength={80} onChange={(e) => setV({ ...v, app_name: e.target.value })} /></Field>
          <Field label="Organization name" htmlFor="s-on"><Input id="s-on" value={v.organization_name} maxLength={80} onChange={(e) => setV({ ...v, organization_name: e.target.value })} /></Field>
          <Field label="Welcome message" htmlFor="s-wm" hint="Shown under “Welcome back” on the home page."><Textarea id="s-wm" value={v.welcome_message} maxLength={1000} onChange={(e) => setV({ ...v, welcome_message: e.target.value })} /></Field>
          <Field label="Roadmap start date" htmlFor="s-rs" hint="60/90/120-day checkpoints count from this date."><Input id="s-rs" type="date" value={v.roadmap_start_date} onChange={(e) => setV({ ...v, roadmap_start_date: e.target.value })} /></Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Dashboard descriptions</CardTitle><CardDescription>The line under each question. The questions themselves don't change.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {DASHBOARDS.map((d) => (
            <Field key={d.n} label={d.question} htmlFor={`s-d${d.n}`}>
              <Input id={`s-d${d.n}`} value={v.dashboard_descriptions?.[d.n] ?? ""} placeholder={d.subtitle} maxLength={200}
                onChange={(e) => setV({ ...v, dashboard_descriptions: { ...v.dashboard_descriptions, [d.n]: e.target.value } })} />
            </Field>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Privacy</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-sm font-medium">Allow anonymous submissions</p><p className="text-xs text-muted">On boards that support it. Existing anonymous posts stay anonymous either way.</p></div>
            <Switch checked={v.allow_anonymous} onCheckedChange={(c) => setV({ ...v, allow_anonymous: c })} aria-label="Allow anonymous submissions" />
          </div>
          <Field label="Minimum responses before showing group results" htmlFor="s-pt" hint="Never below 3. Higher is more private.">
            <Input id="s-pt" type="number" min={3} max={100} value={v.privacy_threshold} onChange={(e) => setV({ ...v, privacy_threshold: Number(e.target.value) })} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Sessions & logs</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label="Sign out after inactivity (minutes)" htmlFor="s-it" hint="0 turns this off."><Input id="s-it" type="number" min={0} max={10080} value={v.idle_timeout_minutes} onChange={(e) => setV({ ...v, idle_timeout_minutes: Number(e.target.value) })} /></Field>
          <Field label="Keep security logs for (days)" htmlFor="s-lr" hint="Older sign-in and access records are deleted daily."><Input id="s-lr" type="number" min={1} max={3650} value={v.log_retention_days} onChange={(e) => setV({ ...v, log_retention_days: Number(e.target.value) })} /></Field>
        </CardContent>
      </Card>
      <div className="lg:col-span-2"><Button type="submit" variant="brand" size="lg" loading={save.isPending}>Save settings</Button></div>
    </form>
  );
}
