#!/usr/bin/env node
// Creates the FIRST administrator and (optionally) the first invitation
// password. Runs on your own computer with the Supabase secret key; it is
// never deployed. Refuses to run if an administrator already exists.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run bootstrap-admin
//
import { createClient } from "@supabase/supabase-js";
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import readline from "node:readline";

const scrypt = promisify(scryptCb);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your shell first (do not commit them).");
  process.exit(1);
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : "*");
    }
    rl.question(question, (a) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(a.trim());
    });
  });
}

const svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { count } = await svc.from("workspace_memberships").select("*", { count: "exact", head: true }).eq("role", "admin");
if (count > 0) {
  console.error("An administrator already exists. Manage roles from Admin → People.");
  process.exit(1);
}

const email = (await ask("Admin email: ")).toLowerCase();
const username = await ask("Username (3–32 letters, numbers, . _ -): ");
const displayName = await ask("Display name: ");
const password = await ask("Password (10+ chars, mix of 3 character types): ", { hidden: true });
if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw new Error("Invalid username.");
if (password.length < 10) throw new Error("Password too short.");

let userId;
const { data: created, error } = await svc.auth.admin.createUser({
  email, password, email_confirm: true, user_metadata: { username, display_name: displayName },
});
if (error) {
  if (!/already/i.test(error.message)) throw error;
  console.log("That email already has an auth account; promoting it.");
} else {
  userId = created.user.id;
}

const { data: adminId, error: bErr } = await svc.rpc("bootstrap_first_admin", {
  p_email: email, p_username: username, p_display_name: displayName,
});
if (bErr) throw bErr;
console.log(`\n✔ Administrator created (${adminId ?? userId}).`);

const code = await ask("\nSet the first invitation password now? Enter it, or leave blank to skip: ", { hidden: true });
if (code) {
  if (code.length < 8) throw new Error("Invitation passwords must be at least 8 characters.");
  const salt = randomBytes(16);
  const hash = await scrypt(code.normalize("NFKC").trim(), salt, 32, { N: 16384, r: 8, p: 1 });
  const code_hash = `scrypt$16384$8$1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
  await svc.from("invitation_codes").update({ active: false }).eq("active", true);
  const { error: cErr } = await svc.from("invitation_codes").insert({ code_hash, label: "Initial", created_by: adminId });
  if (cErr) throw cErr;
  console.log("✔ Invitation password set. You can change it any time in Admin → Access & Security.");
}
console.log("\nDone. Sign in at your site's /login page.");
