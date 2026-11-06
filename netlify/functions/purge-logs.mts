// Daily retention job: removes security events older than the configured
// retention period (Admin → Workspace Settings; default 30 days).
import type { Config } from "@netlify/functions";
import { serviceClient } from "../lib/server";

export default async () => {
  const { data, error } = await serviceClient().rpc("purge_security_logs");
  if (error) {
    console.error("purge failed", error.message);
    return new Response("error", { status: 500 });
  }
  console.log(`purged ${data} security events`);
  return new Response("ok");
};

export const config: Config = { schedule: "@daily" };
