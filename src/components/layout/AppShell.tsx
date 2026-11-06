import * as React from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { BarChart3, Briefcase, Home, LayoutGrid, LogOut, Menu, Shield, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { BRAND } from "@/brand";
import { DASHBOARDS } from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useRealtime } from "@/hooks/useRealtime";
import { unitPath, useOptionalUnit, useUnits } from "@/hooks/useUnit";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const { settings } = useAuth();
  return (
    <div className="flex flex-col gap-2">
      <img src={BRAND.logoDark} alt={BRAND.logoAlt} className={cn("h-auto", compact ? "w-36" : "w-44")} />
      <span className="eyebrow text-brand">{settings?.app_name ?? "The Leadership Collective"}</span>
    </div>
  );
}

/** Switch business unit, keeping the same page when possible. */
function UnitSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const unit = useOptionalUnit();
  const { data: units } = useUnits();
  const { isExec } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  if (!units || units.length === 0) return null;
  if (units.length === 1 && !isExec) {
    return (
      <div className="rounded-lg border border-line bg-canvas px-3 py-2">
        <p className="text-[11px] text-muted">Business unit</p>
        <p className="text-sm font-medium leading-snug">{units[0].name}</p>
      </div>
    );
  }
  const sub = loc.pathname.match(/^\/u\/[^/]+\/([^/?]+)/)?.[1] ?? "home";
  return (
    <div>
      <label htmlFor="unit-switch" className="mb-1 block px-1 text-[11px] text-muted">Business unit</label>
      <select
        id="unit-switch"
        className="h-10 w-full rounded-lg border border-line-strong bg-surface px-2 text-sm font-medium"
        value={unit?.slug ?? ""}
        onChange={(e) => {
          if (e.target.value) nav(unitPath(e.target.value, unit ? sub : "home"));
          onNavigate?.();
        }}
      >
        {!unit && <option value="">Choose a business unit…</option>}
        {units.map((u) => <option key={u.id} value={u.slug}>{u.name}</option>)}
      </select>
    </div>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { isAdmin, isExec } = useAuth();
  const unit = useOptionalUnit();
  const { data: units } = useUnits();
  const link = ({ isActive }: { isActive: boolean }) =>
    cn(
      "group flex items-start gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
      isActive ? "bg-ink text-white" : "text-ink-soft hover:bg-canvas hover:text-ink",
    );
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {unit && (
        <>
          <NavLink to={unitPath(unit.slug, "home")} className={link} onClick={onNavigate}>
            <Home className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="font-medium">Where We're Headed</span>
          </NavLink>
          <p className="eyebrow mt-4 mb-1 px-3 text-muted">Five questions</p>
          {DASHBOARDS.map((d) => (
            <NavLink key={d.n} to={unitPath(unit.slug, d.path)} className={link} onClick={onNavigate}>
              {({ isActive }) => (
                <>
                  <span
                    className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-md text-[11px] font-semibold",
                      isActive ? "bg-white/15 text-white" : cn(d.accent.soft, d.accent.text))}
                    aria-hidden
                  >
                    {d.n}
                  </span>
                  <span className="leading-snug">{d.question}</span>
                </>
              )}
            </NavLink>
          ))}
          <p className="eyebrow mt-4 mb-1 px-3 text-muted">Strategic planning</p>
          <NavLink to={unitPath(unit.slug, "planning")} className={link} onClick={onNavigate}>
            <Briefcase className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="font-medium">2027 Business Development</span>
          </NavLink>
        </>
      )}
      {(isExec || (units && units.length > 1)) && (
        <p className="eyebrow mt-4 mb-1 px-3 text-muted">Across units</p>
      )}
      {units && units.length > 1 && (
        <NavLink to="/units" end className={link} onClick={onNavigate}>
          <LayoutGrid className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="font-medium">All business units</span>
        </NavLink>
      )}
      {isExec && (
        <NavLink to="/exec" className={link} onClick={onNavigate}>
          <BarChart3 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="font-medium">Executive View</span>
        </NavLink>
      )}
      {isAdmin && (
        <NavLink to="/admin" className={link} onClick={onNavigate}>
          <Shield className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="font-medium">Admin</span>
        </NavLink>
      )}
    </nav>
  );
}

function ConnectionBadge() {
  const { state } = useRealtime();
  if (state === "idle") return null;
  const map = {
    live: { label: "Live", cls: "text-success", Icon: Wifi },
    connecting: { label: "Connecting…", cls: "text-muted", Icon: Wifi },
    reconnecting: { label: "Reconnecting…", cls: "text-warning", Icon: WifiOff },
    offline: { label: "Offline — changes won't save", cls: "text-danger", Icon: WifiOff },
  }[state];
  return (
    <span role="status" className={cn("inline-flex items-center gap-1.5 text-xs font-medium", map.cls)}>
      <map.Icon className="size-3.5" aria-hidden />
      {map.label}
    </span>
  );
}

export function PresenceStrip() {
  const { online } = useRealtime();
  const shown = online.slice(0, 6);
  if (online.length === 0) return null;
  return (
    <div className="flex items-center gap-2" aria-label={`${online.length} people online in this unit`}>
      <div className="flex -space-x-2">
        {shown.map((p) => (
          <span
            key={p.user_id}
            title={p.username}
            className="grid size-7 place-items-center rounded-full border-2 border-surface bg-brand-soft text-[11px] font-semibold uppercase text-brand-dark"
          >
            {p.username.slice(0, 2)}
          </span>
        ))}
      </div>
      <span className="text-xs text-muted">{online.length} online</span>
    </div>
  );
}

function UserFooter() {
  const { profile, signOut, membership, isExec } = useAuth();
  return (
    <div className="mt-auto border-t border-line pt-4">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{profile?.username}</p>
          <p className="text-xs capitalize text-muted">{membership?.role}{isExec ? " · cross-cutting" : ""}</p>
        </div>
        <ConnectionBadge />
      </div>
      <div className="flex flex-col gap-1">
        <NavLink to="/privacy" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-canvas">
          <ShieldCheck className="size-4" aria-hidden /> Privacy & trust
        </NavLink>
        <button onClick={() => signOut()} className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-soft hover:bg-canvas">
          <LogOut className="size-4" aria-hidden /> Sign out
        </button>
      </div>
    </div>
  );
}

export function AppShell() {
  const [open, setOpen] = React.useState(false);
  const loc = useLocation();
  React.useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-72 flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
        <div className="mb-6 px-2"><BrandMark /></div>
        <div className="mb-4"><UnitSwitcher /></div>
        <div className="flex-1 overflow-y-auto"><NavItems /></div>
        <UserFooter />
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
        <img src={BRAND.logoDark} alt={BRAND.logoAlt} className="h-auto w-32" />
        <div className="flex items-center gap-3">
          <ConnectionBadge />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogPrimitive.Trigger className="rounded-lg p-2 hover:bg-canvas" aria-label="Open menu">
              <Menu className="size-5" />
            </DialogPrimitive.Trigger>
            <DialogContent side="left" className="flex flex-col p-5">
              <DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">Navigate the workspace</DialogPrimitive.Description>
              <div className="mb-5"><BrandMark compact /></div>
              <div className="mb-4"><UnitSwitcher onNavigate={() => setOpen(false)} /></div>
              <NavItems onNavigate={() => setOpen(false)} />
              <div className="mt-6"><UserFooter /></div>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main id="main" className="lg:pl-72">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
