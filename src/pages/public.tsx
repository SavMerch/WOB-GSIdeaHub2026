import * as React from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { ArrowRight, Clock, KeyRound, Lock, LogIn } from "lucide-react";
import { BRAND } from "@/brand";
import { callFunction } from "@/lib/api";
import { supabase, initialAuthLinkType } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Field, Input, Notice } from "@/components/ui/primitives";

export function AuthLayout({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className={wide ? "w-full max-w-2xl" : "w-full max-w-md"}>
          <img src={BRAND.logoDark} alt={BRAND.logoAlt} className="mx-auto mb-10 h-auto w-56" />
          {children}
        </div>
      </div>
      <footer className="border-t border-line px-4 py-4 text-center text-xs text-muted">
        <Link to="/privacy-notice" className="hover:text-ink hover:underline">Privacy & access</Link>
        <span className="mx-2" aria-hidden>·</span>
        Private workspace for invited members of {BRAND.organization}
      </footer>
    </div>
  );
}

function Title({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-8 text-center">
      <h1 className="font-display text-xl font-semibold uppercase tracking-[0.12em] text-ink sm:text-2xl">{children}</h1>
      {sub && <p className="mt-3 text-base text-ink-soft">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Stage A — Invitation gate
// ---------------------------------------------------------------------
export function GatePage() {
  const nav = useNavigate();
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await callFunction<{ registrationToken: string; expiresAt: number }>("gate", { code });
      // Kept in memory only (router state) — never persisted.
      nav("/register", { state: { token: r.registrationToken, expiresAt: r.expiresAt } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <Title sub="A space to share where we are, what matters, and what we build next.">The Leadership Collective</Title>
      <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
        <Field label="Invitation password" htmlFor="code">
          <Input id="code" type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={128} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" variant="brand" size="lg" loading={busy} disabled={!code}>
          Enter <ArrowRight />
        </Button>
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          This workspace is for invited members only. The invitation password lets you request an account; an
          administrator approves each person before they can see anything. Access attempts are logged for security.
        </p>
      </form>
      <p className="mt-6 text-center text-sm text-ink-soft">
        Already have an account? <Link to="/login" className="font-medium text-brand hover:underline">Sign in</Link>
      </p>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------
// Stage B — Request an individual account
// ---------------------------------------------------------------------
export function RegisterPage() {
  const loc = useLocation();
  const nav = useNavigate();
  const { signIn } = useAuth();
  const state = loc.state as { token?: string; expiresAt?: number } | null;
  const [form, setForm] = React.useState({ displayName: "", email: "", username: "", password: "", passwordConfirm: "" });
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  if (!state?.token || (state.expiresAt && state.expiresAt < Date.now())) return <Navigate to="/welcome" replace />;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (form.password !== form.passwordConfirm) return setError("The passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await callFunction("register", { ...form, registrationToken: state.token });
      await signIn(form.email, form.password);
      nav("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      if (/expired|already been used/i.test((err as Error).message)) setTimeout(() => nav("/welcome"), 2500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <Title sub="Create your account. An administrator will confirm it before you can join in.">Request an account</Title>
      <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
        <Field label="Your name" htmlFor="dn"><Input id="dn" autoComplete="name" value={form.displayName} onChange={set("displayName")} required maxLength={80} /></Field>
        <Field label="Email address" htmlFor="em"><Input id="em" type="email" autoComplete="email" value={form.email} onChange={set("email")} required /></Field>
        <Field label="Username" htmlFor="un" hint="This is how you'll appear to others. 3–32 letters, numbers, dots, dashes or underscores.">
          <Input id="un" autoComplete="username" value={form.username} onChange={set("username")} required pattern="[A-Za-z0-9_.\-]{3,32}" maxLength={32} />
        </Field>
        <Field label="Password" htmlFor="pw" hint="At least 10 characters, mixing three of: lowercase, uppercase, numbers, symbols.">
          <Input id="pw" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} required minLength={10} maxLength={128} />
        </Field>
        <Field label="Confirm password" htmlFor="pw2"><Input id="pw2" type="password" autoComplete="new-password" value={form.passwordConfirm} onChange={set("passwordConfirm")} required /></Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" variant="brand" size="lg" loading={busy}>Request my account</Button>
      </form>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------
// Sign in (approved users return here without the invitation password)
// ---------------------------------------------------------------------
export function LoginPage() {
  const { signIn, endedReason } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      nav("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <Title sub="Welcome back.">Sign in</Title>
      {endedReason && <Notice tone="warn" className="mb-4">{endedReason}</Notice>}
      <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
        <Field label="Email address" htmlFor="em"><Input id="em" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password" htmlFor="pw"><Input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" variant="brand" size="lg" loading={busy}><LogIn /> Sign in</Button>
        <Link to="/forgot-password" className="text-center text-sm text-brand hover:underline">Forgot your password?</Link>
      </form>
      <p className="mt-6 text-center text-sm text-ink-soft">
        New here? <Link to="/welcome" className="font-medium text-brand hover:underline">Enter an invitation password</Link>
      </p>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <AuthLayout>
      <Title sub="We'll email you a link to choose a new password.">Reset your password</Title>
      <form
        className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await callFunction<{ message: string }>("password-reset", { email });
            setMsg(r.message);
          } catch (err) {
            setMsg((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Email address" htmlFor="em"><Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        {msg && <Notice>{msg}</Notice>}
        <Button type="submit" variant="brand" loading={busy}><KeyRound /> Send reset link</Button>
        <Link to="/login" className="text-center text-sm text-brand hover:underline">Back to sign in</Link>
      </form>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { session } = useAuth();
  const nav = useNavigate();
  const [pw, setPw] = React.useState("");
  const [pw2, setPw2] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const invited = initialAuthLinkType === "invite";

  if (!session) {
    return (
      <AuthLayout>
        <Title>Link expired</Title>
        <Notice>This link is no longer valid. <Link className="font-medium text-brand underline" to="/forgot-password">Request a new one</Link>.</Notice>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout>
      <Title sub={invited ? "Welcome! Choose a password to finish setting up your account." : "Choose a new password."}>
        {invited ? "Set your password" : "New password"}
      </Title>
      <form
        className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw !== pw2) return setError("The passwords don't match.");
          if (pw.length < 10) return setError("Use at least 10 characters.");
          setBusy(true);
          const { error } = await supabase.auth.updateUser({ password: pw });
          setBusy(false);
          if (error) return setError(error.message);
          window.history.replaceState(null, "", "/");
          nav("/", { replace: true });
        }}
      >
        <Field label="New password" htmlFor="pw" hint="At least 10 characters, mixing three of: lowercase, uppercase, numbers, symbols.">
          <Input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        </Field>
        <Field label="Confirm password" htmlFor="pw2"><Input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" variant="brand" loading={busy}>Save password</Button>
      </form>
    </AuthLayout>
  );
}

export function PendingPage() {
  const { profile, membership, refresh, signOut } = useAuth();
  React.useEffect(() => {
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);
  if (membership?.status === "active") return <Navigate to="/home" replace />;
  const rejected = membership?.status === "rejected";
  return (
    <AuthLayout>
      <div className="rounded-2xl border border-line bg-surface p-8 text-center shadow-[var(--shadow-card)]">
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-brand-soft text-brand"><Clock className="size-6" aria-hidden /></span>
        <h1 className="font-display text-xl font-semibold">{rejected ? "Request not approved" : "Awaiting approval"}</h1>
        <p className="mt-3 text-ink-soft">
          {rejected
            ? "Your account request wasn't approved. If you think this is a mistake, please contact an administrator."
            : <>Thanks{profile ? `, ${profile.username}` : ""}! An administrator will review your request soon. This page will update by itself once you're in.</>}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" onClick={() => refresh()}>Check again</Button>
          <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
        </div>
      </div>
    </AuthLayout>
  );
}
