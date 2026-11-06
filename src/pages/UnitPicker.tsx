import { Link, Navigate } from "react-router";
import { ArrowRight, BarChart3, Building2, Clock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SEGMENT_LABEL, lastUnit, unitPath, useMyUnitIds, useUnits, type Unit } from "@/hooks/useUnit";
import { Badge, Spinner } from "@/components/ui/primitives";
import { PresenceStrip } from "@/components/layout/AppShell";

/** Entry point after sign-in: choose which business unit to work in. */
export default function UnitPicker() {
  const { profile, isExec, signOut } = useAuth();
  const { data: units, isLoading } = useUnits();
  const { data: mine } = useMyUnitIds();
  if (isLoading || !units) return <Spinner />;

  if (units.length === 1 && !isExec) return <Navigate to={unitPath(units[0].slug)} replace />;

  if (units.length === 0) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-brand-soft text-brand"><Clock className="size-6" aria-hidden /></span>
        <h1 className="font-display text-xl font-semibold">You're almost in</h1>
        <p className="mt-3 text-ink-soft">Your account is approved, but you haven't been added to a business unit yet. An administrator will assign you shortly.</p>
        <button className="mt-6 text-sm text-brand hover:underline" onClick={() => signOut()}>Sign out</button>
      </div>
    );
  }

  const last = lastUnit();
  const bySegment = (seg: Unit["segment"]) => units.filter((u) => u.segment === seg);

  return (
    <div>
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="eyebrow mb-2 text-brand">Welcome back</p>
          <h1 className="text-2xl font-semibold sm:text-3xl">Where would you like to start, {profile?.username}?</h1>
          <p className="mt-2 text-ink-soft">Each business unit has its own conversation and its own 2027 plan. You can switch at any time from the sidebar.</p>
        </div>
        <PresenceStrip />
      </header>

      {isExec && (
        <Link to="/exec" className="mb-8 flex items-center gap-4 rounded-[var(--radius-card)] border border-ink bg-ink p-5 text-white transition-opacity hover:opacity-95">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/10"><BarChart3 className="size-5" aria-hidden /></span>
          <span className="flex-1">
            <span className="block font-display font-semibold">Executive View</span>
            <span className="block text-sm text-white/75">Corporate Solutions and Government Solutions, side by side, with each unit's results and 2027 plans.</span>
          </span>
          <ArrowRight className="size-5" aria-hidden />
        </Link>
      )}

      {(["corporate", "government"] as const).map((seg) => bySegment(seg).length > 0 && (
        <section key={seg} className="mb-8" aria-labelledby={`seg-${seg}`}>
          <h2 id={`seg-${seg}`} className="eyebrow mb-3 text-muted">{SEGMENT_LABEL[seg]}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {bySegment(seg).map((u) => (
              <Link
                key={u.id}
                to={unitPath(u.slug)}
                className="group flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5 transition-shadow hover:shadow-[var(--shadow-pop)]"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="grid size-9 place-items-center rounded-lg bg-brand-soft text-brand"><Building2 className="size-4" aria-hidden /></span>
                  <span className="flex gap-1">
                    {mine?.includes(u.id) && <Badge tone="brand">Your unit</Badge>}
                    {last === u.slug && <Badge>Last visited</Badge>}
                  </span>
                </span>
                <span className="font-medium leading-snug">{u.name}</span>
                <span className="mt-auto flex items-center gap-1 text-sm text-brand">
                  Open <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
