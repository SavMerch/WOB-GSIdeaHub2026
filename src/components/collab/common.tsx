import * as React from "react";
import { Link } from "react-router";
import { EyeOff, Sparkles } from "lucide-react";
import type { DashboardMeta } from "@/lib/dashboards";
import { STATUS_LABEL } from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/primitives";
import { PresenceStrip } from "@/components/layout/AppShell";
import { useAuth } from "@/hooks/useAuth";

export function PageHeader({ dashboard, title, subtitle }: { dashboard?: DashboardMeta; title: string; subtitle: string }) {
  const { settings } = useAuth();
  const desc = dashboard ? settings?.dashboard_descriptions?.[String(dashboard.n)] : undefined;
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {dashboard && (
          <p className={cn("eyebrow mb-2 flex items-center gap-2", dashboard.accent.text)}>
            <dashboard.icon className="size-3.5" aria-hidden /> Question {dashboard.n} of 5
          </p>
        )}
        <h1 className="text-2xl font-semibold leading-tight text-ink sm:text-3xl">{title}</h1>
        <p className="mt-2 text-base text-ink-soft">{desc || subtitle}</p>
      </div>
      <PresenceStrip />
    </header>
  );
}

export function SectionHeader({ letter, title, prompt, action }: { letter?: string; title: string; prompt?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="flex items-baseline gap-2 text-lg font-semibold">
          {letter && <span className="font-display text-sm text-muted">{letter}.</span>}
          {title}
        </h2>
        {prompt && <p className="mt-1 text-sm text-ink-soft">{prompt}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon = Sparkles, title, children, action }: { icon?: React.ElementType; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center">
      <span className="mb-3 grid size-10 place-items-center rounded-full bg-brand-soft text-brand">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="font-display text-sm font-semibold">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "commitment" || status === "agreed" ? "brand"
    : status === "completed" || status === "addressed" ? "success"
    : status === "in_progress" || status === "discussing" ? "warn"
    : "neutral";
  return <Badge tone={tone}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export function AuthorLine({ anonymous, username, when }: { anonymous: boolean; username?: string | null; when: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      {anonymous ? (
        <span className="inline-flex items-center gap-1 font-medium text-ink-soft"><EyeOff className="size-3" aria-hidden /> Anonymous</span>
      ) : (
        <span className="font-medium text-ink-soft">{username ?? "Former member"}</span>
      )}
      <span aria-hidden>·</span>
      <time dateTime={when}>{when ? new Date(when).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}</time>
    </span>
  );
}

export function SuppressedNote({ n, threshold }: { n: number; threshold: number }) {
  return (
    <p className="text-sm text-muted">
      Group results appear once at least {threshold} people have responded, so no one's answers can be singled out.
      {n > 0 ? ` (${n} so far.)` : ""}
    </p>
  );
}

export function TextLink({ to, children }: { to: string; children: React.ReactNode }) {
  return <Link to={to} className="font-medium text-brand underline-offset-4 hover:underline">{children}</Link>;
}
