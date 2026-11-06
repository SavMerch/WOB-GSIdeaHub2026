import * as React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import "./index.css";
import { configured, initialAuthLinkType } from "@/lib/supabase";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { RealtimeProvider } from "@/hooks/useRealtime";
import { UnitLayout } from "@/hooks/useUnit";
import { AppShell } from "@/components/layout/AppShell";
import { Spinner } from "@/components/ui/primitives";
import {
  ForgotPasswordPage, GatePage, LoginPage, PendingPage, RegisterPage, ResetPasswordPage,
} from "@/pages/public";
import { PrivacyContent, PublicPrivacyPage } from "@/pages/Privacy";

const Home = React.lazy(() => import("@/pages/Home"));
const Honest = React.lazy(() => import("@/pages/dashboards/Honest"));
const InOurWay = React.lazy(() => import("@/pages/dashboards/InOurWay"));
const Become = React.lazy(() => import("@/pages/dashboards/Become"));
const Matters = React.lazy(() => import("@/pages/dashboards/Matters"));
const Build = React.lazy(() => import("@/pages/dashboards/Build"));
const Admin = React.lazy(() => import("@/pages/admin/Admin"));
const UnitPicker = React.lazy(() => import("@/pages/UnitPicker"));
const Planning = React.lazy(() => import("@/pages/Planning"));
const Exec = React.lazy(() => import("@/pages/Exec"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 2, refetchOnWindowFocus: true, refetchOnReconnect: true },
  },
});

/** Frontend routing is a convenience — the database enforces every rule. */
function RequireMember({ admin = false, exec = false }: { admin?: boolean; exec?: boolean }) {
  const { session, loading, membership, isAdmin, isExec } = useAuth();
  const loc = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/welcome" replace state={{ from: loc.pathname }} />;
  if (!membership || membership.status !== "active") return <Navigate to="/pending" replace />;
  if (admin && !isAdmin) return <Navigate to="/units" replace />;
  if (exec && !isExec) return <Navigate to="/units" replace />;
  return <Outlet />;
}

function RequireSession() {
  const { session, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  return session ? <Outlet /> : <Navigate to="/login" replace />;
}

function Root() {
  const { session, loading, membership } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (session && (initialAuthLinkType === "recovery" || initialAuthLinkType === "invite")) {
    return <Navigate to="/reset-password" replace />;
  }
  if (!session) return <Navigate to="/welcome" replace />;
  return <Navigate to={membership?.status === "active" ? "/units" : "/pending"} replace />;
}

function FullPageSpinner() {
  return <div className="grid min-h-dvh place-items-center"><Spinner /></div>;
}

function NotConfigured() {
  return (
    <div className="mx-auto max-w-lg p-10 text-sm leading-relaxed">
      <h1 className="mb-2 font-display text-lg font-semibold">Setup needed</h1>
      <p>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see README → “Configure Netlify”), then rebuild.</p>
    </div>
  );
}

function App() {
  if (!configured) return <NotConfigured />;
  return (
    <Routes>
      <Route path="/" element={<Root />} />
      <Route path="/welcome" element={<GatePage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/privacy-notice" element={<PublicPrivacyPage />} />
      <Route element={<RequireSession />}>
        <Route path="/pending" element={<PendingPage />} />
      </Route>
      <Route element={<RequireMember />}>
        <Route element={<AppShell />}>
          <Route path="/units" element={<UnitPicker />} />
          <Route path="/privacy" element={<div className="max-w-3xl"><PrivacyContent /></div>} />
          <Route element={<RequireMember exec />}>
            <Route path="/exec" element={<Exec />} />
          </Route>
        </Route>
        {/* Business-unit pages: the unit layout provides the unit to the shell and pages. */}
        <Route path="/u/:unit" element={<UnitLayout />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="home" replace />} />
            <Route path="home" element={<Home />} />
            <Route path="honest" element={<Honest />} />
            <Route path="in-our-way" element={<InOurWay />} />
            <Route path="become" element={<Become />} />
            <Route path="matters" element={<Matters />} />
            <Route path="build" element={<Build />} />
            <Route path="planning" element={<Planning />} />
          </Route>
        </Route>
        <Route element={<AppShell />}>
          <Route element={<RequireMember admin />}>
            <Route path="/admin/*" element={<Admin />} />
          </Route>
        </Route>
      </Route>
      {["/home", "/honest", "/in-our-way", "/become", "/matters", "/build"].map((p) => (
        <Route key={p} path={p} element={<Navigate to="/units" replace />} />
      ))}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <RealtimeProvider>
            <React.Suspense fallback={<FullPageSpinner />}>
              <App />
            </React.Suspense>
          </RealtimeProvider>
        </AuthProvider>
      </BrowserRouter>
      <Toaster position="bottom-right" richColors closeButton />
    </QueryClientProvider>
  </React.StrictMode>,
);
