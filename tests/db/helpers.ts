import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const BASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:54329/postgres";

export type Who = { id: string } | "anon" | "service";

export class TestDb {
  constructor(public client: pg.Client, public name: string, private root: pg.Client) {}

  /** Run a query as a given identity inside its own transaction, mimicking PostgREST. */
  async as<T extends pg.QueryResultRow = any>(who: Who, sql: string, params: unknown[] = []) {
    const c = this.client;
    await c.query("begin");
    try {
      if (who === "anon") {
        await c.query("set local role anon");
        await c.query("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)");
      } else if (who === "service") {
        await c.query("set local role service_role");
        await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
      } else {
        await c.query("set local role authenticated");
        await c.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: who.id, role: "authenticated" }),
        ]);
      }
      const res = await c.query<T>(sql, params);
      await c.query("commit");
      return res;
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  }

  /** Superuser access for arranging test fixtures. */
  async sql<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []) {
    return this.client.query<T>(sql, params);
  }

  async createUser(username: string, opts: { role?: string; status?: string } = {}) {
    const { rows } = await this.sql<{ id: string }>(
      "insert into auth.users (email) values ($1) returning id",
      [`${username}@example.test`],
    );
    const id = rows[0].id;
    await this.sql("insert into public.profiles (id, username, display_name) values ($1, $2, $3)", [
      id,
      username,
      username.toUpperCase(),
    ]);
    await this.sql(
      "insert into public.workspace_memberships (user_id, role, status) values ($1, $2, $3)",
      [id, opts.role ?? "participant", opts.status ?? "active"],
    );
    return { id };
  }

  async close() {
    await this.client.end();
    await this.root.query(`drop database if exists ${this.name} with (force)`);
    await this.root.end();
  }
}

export async function freshDb(): Promise<TestDb> {
  const root = new pg.Client({ connectionString: BASE_URL });
  await root.connect();
  const name = `lc_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await root.query(`create database ${name}`);
  const url = new URL(BASE_URL);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  await client.query("set client_min_messages = warning");
  await client.query(readFileSync(path.join(ROOT, "tests/db/supabase-shim.sql"), "utf8"));
  const dir = path.join(ROOT, "supabase/migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await client.query(readFileSync(path.join(dir, f), "utf8"));
  }
  return new TestDb(client, name, root);
}

/** Expect a promise to fail with a Postgres error; returns the error. */
export async function rejects(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("Expected the operation to be rejected, but it succeeded");
}
