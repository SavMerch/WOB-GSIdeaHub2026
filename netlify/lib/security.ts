// Pure security helpers (no network access) — unit tested in tests/unit.
import { createHmac, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

// ---------------------------------------------------------------------
// Invitation code hashing (scrypt, per-code random salt)
// ---------------------------------------------------------------------
const N = 16384, R = 8, P = 1, KEYLEN = 32;

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(normalizeCode(secret), salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64url");
  const actual = await scrypt(normalizeCode(secret), Buffer.from(saltB64, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Codes are compared after trimming surrounding whitespace (but case-sensitively). */
export function normalizeCode(code: string): string {
  return code.normalize("NFKC").trim();
}

// ---------------------------------------------------------------------
// Short-lived, single-use registration authorization (HMAC-SHA256)
// ---------------------------------------------------------------------
export interface RegistrationClaims {
  jti: string;
  iat: number; // seconds
  exp: number; // seconds
  purpose: "register";
}

export const REGISTRATION_TOKEN_TTL_SECONDS = 15 * 60;

export function signRegistrationToken(secret: string, now = Date.now()): { token: string; claims: RegistrationClaims } {
  assertSecret(secret);
  const iat = Math.floor(now / 1000);
  const claims: RegistrationClaims = { jti: randomUUID(), iat, exp: iat + REGISTRATION_TOKEN_TTL_SECONDS, purpose: "register" };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return { token: `${body}.${sig}`, claims };
}

export function verifyRegistrationToken(secret: string, token: unknown, now = Date.now()): RegistrationClaims | null {
  assertSecret(secret);
  if (typeof token !== "string" || token.length > 1000) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let claims: RegistrationClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (claims.purpose !== "register" || typeof claims.jti !== "string" || typeof claims.exp !== "number") return null;
  if (claims.exp * 1000 <= now) return null;
  return claims;
}

function assertSecret(secret: string) {
  if (!secret || secret.length < 32) {
    throw new Error("REGISTRATION_TOKEN_SECRET must be set to at least 32 characters.");
  }
}

// ---------------------------------------------------------------------
// Request metadata
// ---------------------------------------------------------------------
/**
 * The client IP as reported by Netlify's edge (context.ip). We deliberately
 * ignore X-Forwarded-For and similar headers, which callers can spoof.
 */
export function trustedIp(context: { ip?: string } | undefined): string | null {
  const ip = context?.ip?.trim();
  if (!ip || ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip)) return null;
  return ip;
}

export function userAgent(req: Request): string | null {
  const ua = req.headers.get("user-agent");
  return ua ? ua.slice(0, 400) : null;
}

/** Reads the session_id claim from a Supabase access token without verifying it (verification happens separately). */
export function sessionIdFromJwt(jwt: string | undefined | null): string | null {
  if (!jwt) return null;
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.session_id === "string" ? payload.session_id : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------
export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,63}$/;

export interface RegistrationInput {
  displayName: string;
  email: string;
  username: string;
  password: string;
}

export function validateRegistration(raw: unknown): { ok: true; value: RegistrationInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Please fill in every field." };
  const r = raw as Record<string, unknown>;
  const displayName = typeof r.displayName === "string" ? r.displayName.trim() : "";
  const email = typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
  const username = typeof r.username === "string" ? r.username.trim() : "";
  const password = typeof r.password === "string" ? r.password : "";
  const confirm = typeof r.passwordConfirm === "string" ? r.passwordConfirm : "";
  if (displayName.length < 1 || displayName.length > 80) return { ok: false, error: "Please enter your name (up to 80 characters)." };
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, error: "Please enter a valid email address." };
  if (!USERNAME_RE.test(username))
    return { ok: false, error: "Usernames are 3–32 characters: letters, numbers, dots, dashes, or underscores." };
  const pw = passwordProblem(password);
  if (pw) return { ok: false, error: pw };
  if (password !== confirm) return { ok: false, error: "The passwords don't match." };
  return { ok: true, value: { displayName, email, username, password } };
}

export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters for your password.";
  if (password.length > 128) return "Passwords can be up to 128 characters.";
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) return "Mix at least three of: lowercase, uppercase, numbers, symbols.";
  return null;
}

export function validateInviteCode(code: unknown): string | null {
  if (typeof code !== "string") return "Enter an invitation code.";
  const c = normalizeCode(code);
  if (c.length < 8) return "Invitation codes must be at least 8 characters.";
  if (c.length > 128) return "Invitation codes can be up to 128 characters.";
  return null;
}
