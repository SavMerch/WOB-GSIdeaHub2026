import { describe, expect, it } from "vitest";
import {
  hashSecret, passwordProblem, sessionIdFromJwt, signRegistrationToken, trustedIp, validateInviteCode,
  validateRegistration, verifyRegistrationToken, verifySecret,
} from "../../netlify/lib/security";
import { toCsv } from "../../src/lib/csv";

const SECRET = "x".repeat(48);

describe("invitation code hashing", () => {
  it("verifies the right code and rejects others", async () => {
    const h = await hashSecret("Harbor-Lights-2026");
    expect(h).toMatch(/^scrypt\$/);
    expect(h).not.toContain("Harbor");
    expect(await verifySecret("Harbor-Lights-2026", h)).toBe(true);
    expect(await verifySecret("  Harbor-Lights-2026 ", h)).toBe(true); // surrounding spaces ignored
    expect(await verifySecret("harbor-lights-2026", h)).toBe(false);
    expect(await verifySecret("anything", "garbage")).toBe(false);
  });
  it("uses a fresh salt each time", async () => {
    expect(await hashSecret("same-code-123")).not.toBe(await hashSecret("same-code-123"));
  });
  it("enforces code length", () => {
    expect(validateInviteCode("short")).toMatch(/at least 8/);
    expect(validateInviteCode("long-enough")).toBeNull();
  });
});

describe("registration token", () => {
  it("round-trips and carries a unique id", () => {
    const { token, claims } = signRegistrationToken(SECRET);
    expect(verifyRegistrationToken(SECRET, token)?.jti).toBe(claims.jti);
    expect(signRegistrationToken(SECRET).claims.jti).not.toBe(claims.jti);
  });
  it("rejects tampering, wrong secret, and expiry", () => {
    const { token } = signRegistrationToken(SECRET);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), exp: 9e9 })).toString("base64url");
    expect(verifyRegistrationToken(SECRET, `${forged}.${sig}`)).toBeNull();
    expect(verifyRegistrationToken("y".repeat(48), token)).toBeNull();
    expect(verifyRegistrationToken(SECRET, token, Date.now() + 16 * 60_000)).toBeNull();
    expect(verifyRegistrationToken(SECRET, "nonsense")).toBeNull();
    expect(verifyRegistrationToken(SECRET, 42)).toBeNull();
  });
  it("refuses a weak signing secret", () => {
    expect(() => signRegistrationToken("short")).toThrow();
  });
});

describe("request metadata", () => {
  it("uses only Netlify's context.ip and validates its shape", () => {
    expect(trustedIp({ ip: "203.0.113.4" })).toBe("203.0.113.4");
    expect(trustedIp({ ip: "2001:db8::1" })).toBe("2001:db8::1");
    expect(trustedIp({ ip: "1.2.3.4, 5.6.7.8" })).toBeNull();
    expect(trustedIp({ ip: "<script>" })).toBeNull();
    expect(trustedIp(undefined)).toBeNull();
  });
  it("reads session_id from a JWT payload", () => {
    const p = Buffer.from(JSON.stringify({ session_id: "abc" })).toString("base64url");
    expect(sessionIdFromJwt(`h.${p}.s`)).toBe("abc");
    expect(sessionIdFromJwt("bad")).toBeNull();
  });
});

describe("registration validation", () => {
  const ok = { displayName: "Ana", email: "Ana@Example.com", username: "ana.b", password: "Correct-Horse9", passwordConfirm: "Correct-Horse9" };
  it("accepts and normalizes valid input", () => {
    const r = validateRegistration(ok);
    expect(r.ok && r.value.email).toBe("ana@example.com");
  });
  it("rejects bad usernames, emails, weak or mismatched passwords", () => {
    expect(validateRegistration({ ...ok, username: "a b" }).ok).toBe(false);
    expect(validateRegistration({ ...ok, username: "<img>" }).ok).toBe(false);
    expect(validateRegistration({ ...ok, email: "nope" }).ok).toBe(false);
    expect(validateRegistration({ ...ok, passwordConfirm: "x" }).ok).toBe(false);
    expect(passwordProblem("short")).toBeTruthy();
    expect(passwordProblem("alllowercaseletters")).toBeTruthy();
    expect(passwordProblem("Mixed-Case-123")).toBeNull();
  });
});

describe("CSV export", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(toCsv([{ a: 'He said "hi", then\nleft' }])).toBe('a\r\n"He said ""hi"", then\nleft"');
  });
  it("neutralizes spreadsheet formulas", () => {
    const csv = toCsv([{ a: "=HYPERLINK(\"http://x\")" }, { a: "+1" }, { a: "-2" }, { a: "@SUM(A1)" }]);
    expect(csv.split("\r\n").slice(1).every((l) => l.replace(/^"/, "").startsWith("'"))).toBe(true);
  });
  it("unions columns across rows", () => {
    expect(toCsv([{ a: 1 }, { b: 2 }]).split("\r\n")[0]).toBe("a,b");
  });
});
