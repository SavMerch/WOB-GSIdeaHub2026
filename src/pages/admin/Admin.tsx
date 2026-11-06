import { NavLink, Navigate, Route, Routes } from "react-router";
import { cn } from "@/lib/utils";
import { Overview } from "./Overview";
import { People } from "./People";
import { Security } from "./Security";
import { Content } from "./Content";
import { Settings } from "./Settings";
import { Export } from "./Export";

const SECTIONS = [
  { path: "overview", label: "Overview", el: <Overview /> },
  { path: "people", label: "People", el: <People /> },
  { path: "security", label: "Access & Security", el: <Security /> },
  { path: "content", label: "Content", el: <Content /> },
  { path: "settings", label: "Workspace Settings", el: <Settings /> },
  { path: "export", label: "Export", el: <Export /> },
];

/**
 * Admin area. Hiding these screens is only a convenience: every admin
 * query and action is re-checked in the database (is_admin()) or in the
 * Netlify admin function.
 */
export default function Admin() {
  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow mb-2 text-brand">Administration</p>
        <h1 className="text-2xl font-semibold sm:text-3xl">Admin</h1>
      </header>
      <nav aria-label="Admin sections" className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1">
        {SECTIONS.map((s) => (
          <NavLink key={s.path} to={`/admin/${s.path}`}
            className={({ isActive }) => cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium", isActive ? "bg-ink text-white" : "text-muted hover:text-ink")}>
            {s.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="overview" replace />} />
        {SECTIONS.map((s) => <Route key={s.path} path={s.path} element={s.el} />)}
      </Routes>
    </div>
  );
}
