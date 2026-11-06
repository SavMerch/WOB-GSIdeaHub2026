#!/usr/bin/env node
// Production readiness checks against a deployed site. Uses only public
// information (no secrets needed).
//
//   SITE_URL=https://your-site.netlify.app \
//   VITE_SUPABASE_URL=https://xyz.supabase.co VITE_SUPABASE_ANON_KEY=sb_publishable_… \
//   npm run check:prod
//
const site = process.env.SITE_URL?.replace(/\/$/, "");
const supa = process.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const anon = process.env.VITE_SUPABASE_ANON_KEY;
if (!site || !supa || !anon) {
  console.error("Set SITE_URL, VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  process.exit(1);
}
let failed = 0;
const check = async (name, fn) => {
  try {
    const r = await fn();
    console.log(`${r === true ? "✔" : "✖"} ${name}${r === true ? "" : ` — ${r}`}`);
    if (r !== true) failed++;
  } catch (e) {
    console.log(`✖ ${name} — ${e.message}`);
    failed++;
  }
};

await check("Public sign-up is disabled in Supabase Auth", async () => {
  const s = await (await fetch(`${supa}/auth/v1/settings`, { headers: { apikey: anon } })).json();
  return s.disable_signup === true || "Auth → Sign In / Providers → turn OFF “Allow new users to sign up”";
});
for (const table of ["contributions", "profiles", "authentication_events", "health_ratings", "invitation_codes"]) {
  await check(`Anonymous visitors cannot read ${table}`, async () => {
    const r = await fetch(`${supa}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: anon } });
    const body = await r.text();
    return (r.status === 401 || r.status === 403 || r.status === 404 || body === "[]") || `got HTTP ${r.status}: ${body.slice(0, 80)}`;
  });
}
await check("Anonymous visitors cannot call workspace RPCs", async () => {
  const r = await fetch(`${supa}/rest/v1/rpc/get_home_summary`, { method: "POST", headers: { apikey: anon, "content-type": "application/json" }, body: "{}" });
  return r.status >= 400 || `got HTTP ${r.status}`;
});
await check("Site serves the app with SPA fallback", async () => {
  const r = await fetch(`${site}/home`);
  return (r.ok && (await r.text()).includes('id="root"')) || `HTTP ${r.status}`;
});
await check("Security headers are present", async () => {
  const h = (await fetch(site)).headers;
  const missing = ["content-security-policy", "x-frame-options", "x-content-type-options", "strict-transport-security"].filter((k) => !h.get(k));
  return missing.length === 0 || `missing ${missing.join(", ")}`;
});
await check("Invitation gate function is deployed and rejects a wrong code", async () => {
  const r = await fetch(`${site}/api/gate`, { method: "POST", headers: { "content-type": "application/json", origin: site }, body: JSON.stringify({ code: "definitely-wrong-code" }) });
  return [401, 403, 429].includes(r.status) || `HTTP ${r.status} ${(await r.text()).slice(0, 120)}`;
});
await check("Functions are configured (no missing environment variables)", async () => {
  const r = await fetch(`${site}/api/heartbeat`, { method: "POST", headers: { "content-type": "application/json", origin: site }, body: "{}" });
  return r.status === 401 || `HTTP ${r.status} — check Netlify environment variables`;
});
await check("No secret key in the frontend bundle", async () => {
  const html = await (await fetch(site)).text();
  const scripts = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  for (const s of scripts) {
    const js = await (await fetch(site + s)).text();
    if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(js)) return `found a secret key in ${s}`;
    for (const jwt of js.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? []) {
      try {
        const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
        if (payload.role === "service_role") return `found a service_role key in ${s}`;
      } catch { /* not a JWT */ }
    }
  }
  return true;
});

console.log(failed ? `\n${failed} check(s) need attention.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
