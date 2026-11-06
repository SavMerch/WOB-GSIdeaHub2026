import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, rejects, type TestDb } from "./helpers";

let db: TestDb;
let CS: string, GA: string, EM: string, CARIBE: string;
let admin: { id: string };
let exec: { id: string };
let cs1: { id: string }, cs2: { id: string }, cs3: { id: string };
let ga1: { id: string }, ga2: { id: string }, ga3: { id: string };
let em1: { id: string };
let both: { id: string };

const create = (who: { id: string }, unit: string, board: string, title: string, anon = false) =>
  db.as(who, "select public.create_contribution($1, $2, $3, '', null, '{}'::jsonb, $4) id", [unit, board, title, anon])
    .then((r) => r.rows[0].id as string);

beforeAll(async () => {
  db = await freshDb();
  CS = await db.unit("corporate-solutions");
  GA = await db.unit("government-advisory");
  EM = await db.unit("emergency-management");
  CARIBE = await db.unit("caribe");
  admin = await db.createUser("admin_amy", { role: "admin", units: [], allUnits: true });
  exec = await db.createUser("exec_ed", { units: [], allUnits: true });
  cs1 = await db.createUser("cs_one");
  cs2 = await db.createUser("cs_two");
  cs3 = await db.createUser("cs_three");
  ga1 = await db.createUser("ga_one", { units: ["government-advisory"] });
  ga2 = await db.createUser("ga_two", { units: ["government-advisory"] });
  ga3 = await db.createUser("ga_three", { units: ["government-advisory"] });
  em1 = await db.createUser("em_one", { units: ["emergency-management"] });
  both = await db.createUser("both_bo", { units: ["government-advisory", "caribe"] });
});
afterAll(async () => db?.close());

describe("Unit isolation", () => {
  it("members see only their own unit's units, content, roadmap and feed", async () => {
    const csItem = await create(cs1, CS, "barriers", "CS-only issue");
    const gaItem = await create(ga1, GA, "barriers", "GA-only issue");
    const units = await db.as(cs1, "select slug from public.business_units");
    expect(units.rows.map((r) => r.slug)).toEqual(["corporate-solutions"]);

    const seenByCs = (await db.as(cs2, "select id from public.contributions")).rows.map((r) => r.id);
    expect(seenByCs).toContain(csItem);
    expect(seenByCs).not.toContain(gaItem);
    const feed = await db.as(cs2, "select entity_id from public.activity_events");
    expect(feed.rows.map((r) => r.entity_id)).not.toContain(gaItem);
  });

  it("refuses writing into, reacting to, commenting on, or linking with another unit", async () => {
    const gaItem = await create(ga1, GA, "barriers", "GA private");
    const csItem = await create(cs1, CS, "barriers", "CS private");
    expect((await rejects(create(cs1, GA, "barriers", "sneak"))).code).toBe("LC403");
    expect((await rejects(db.as(cs1, "select public.toggle_reaction($1, 'resonates')", [gaItem]))).code).toBe("LC404");
    expect((await rejects(db.as(cs1, "select public.add_comment($1, null, 'hi')", [gaItem]))).code).toBe("LC404");
    expect((await rejects(db.as(cs1, "select public.create_link('contribution', $1, 'contribution', $2)", [csItem, gaItem]))).code).toBe("LC404");
    // Even a cross-cutting member can't link across units.
    expect((await rejects(db.as(exec, "select public.create_link('contribution', $1, 'contribution', $2)", [csItem, gaItem]))).code).toBe("LC422");
    expect((await rejects(db.as(cs1, "select * from public.get_home_summary($1)", [GA]))).code).toBe("LC403");
  });

  it("people in two units see both; profiles are limited to shared units", async () => {
    const u = await db.as(both, "select slug from public.business_units order by sort");
    expect(u.rows.map((r) => r.slug)).toEqual(["government-advisory", "caribe"]);
    const names = (await db.as(cs1, "select username from public.profiles")).rows.map((r) => r.username);
    expect(names).toEqual(expect.arrayContaining(["cs_one", "cs_two", "admin_amy", "exec_ed"]));
    expect(names).not.toContain("ga_one");
  });

  it("realtime topics are authorized per unit", async () => {
    const ok = await db.as(cs1, "select public.can_join_topic($1) a, public.can_join_topic($2) b, public.can_join_topic('workspace:main') c",
      [`unit:${CS}`, `unit:${GA}`]);
    expect(ok.rows[0]).toEqual({ a: true, b: false, c: false });
  });
});

describe("Cross-cutting members", () => {
  it("see and contribute in every unit, and can open the Executive View", async () => {
    const units = await db.as(exec, "select count(*)::int n from public.business_units");
    expect(units.rows[0].n).toBe(5);
    await create(exec, CARIBE, "known_for", "Caribe idea from exec");
    const s = await db.as(exec, "select public.get_exec_summary() s");
    expect(s.rows[0].s.units).toHaveLength(5);
  });
  it("participants cannot open the Executive View", async () => {
    expect((await rejects(db.as(cs1, "select public.get_exec_summary()"))).code).toBe("LC403");
  });
  it("only people assigned to a unit can give survey answers there", async () => {
    const cats = (await db.sql("select id from public.health_categories order by sort")).rows.map((r) => r.id);
    const err = await rejects(db.as(exec, "select public.submit_health_ratings($1, $2)", [GA, JSON.stringify([{ category_id: cats[0], score: 7 }])]));
    expect(err.code).toBe("LC403");
  });
});

describe("Executive roll-ups protect small units", () => {
  it("segment averages include only units that meet the threshold, and name the excluded ones", async () => {
    const cat = (await db.sql("select id, key from public.health_categories order by sort limit 1")).rows[0];
    const rate = (who: { id: string }, unit: string, score: number) =>
      db.as(who, "select public.submit_health_ratings($1, $2)", [unit, JSON.stringify([{ category_id: cat.id, score }])]);
    for (const [u, s] of [[ga1, 8], [ga2, 6], [ga3, 4]] as const) await rate(u, GA, s); // GA avg 6, n=3
    await rate(em1, EM, 1); // EM n=1 → suppressed, and must not leak into the segment
    for (const [u, s] of [[cs1, 9], [cs2, 9], [cs3, 6]] as const) await rate(u, CS, s); // CS avg 8

    const ex = (await db.as(exec, "select public.get_exec_summary() s")).rows[0].s;
    const h = (scope: string, key: string) => ex.health.find((x: any) => x.scope === scope && x.key === key && x.category_key === cat.key);
    expect(Number(h("segment", "government").avg)).toBe(6); // EM's 1 excluded
    expect(h("segment", "government").excluded_units).toContain("EM & Disaster Recovery");
    expect(Number(h("segment", "corporate").avg)).toBe(8);
    expect(h("unit", EM).suppressed).toBe(true);
    expect(h("unit", EM).avg).toBeNull();
  });
});

describe("2027 Business Development", () => {
  let item: string;
  it("adds a row with category and sponsor/owner; validates kind ↔ category", async () => {
    item = (await db.as(cs1, "select public.create_bd_item($1, 'client', 'grow', 'Acme Energy', $2, 'high', null) id", [CS, cs2.id])).rows[0].id;
    const r = await db.as(cs3, "select name, category, priority, owner_id from public.bd_items where id = $1", [item]);
    expect(r.rows[0]).toMatchObject({ name: "Acme Energy", category: "grow", priority: "high", owner_id: cs2.id });
    expect((await rejects(db.as(cs1, "select public.create_bd_item($1, 'client', 'booth', 'Bad')", [CS]))).code).toBe("LC422");
  });
  it("owner must be someone in the unit", async () => {
    expect((await rejects(db.as(cs1, "select public.create_bd_item($1, 'conference', 'attend', 'Expo', $2)", [CS, ga1.id]))).code).toBe("LC422");
  });
  it("detail edits are validated, merged, and version-checked", async () => {
    await db.as(cs2, "select public.update_bd_item($1, $2, 1)", [item, JSON.stringify({ value_2027: "250000", details: { rationale: "Expanding fleet", key_contacts: "J. Ruiz (COO)" } })]);
    await db.as(cs3, "select public.update_bd_item($1, $2)", [item, JSON.stringify({ details: { next_steps: "Intro meeting in Q1" } })]);
    const r = await db.sql("select value_2027, details, version from public.bd_items where id = $1", [item]);
    expect(Number(r.rows[0].value_2027)).toBe(250000);
    expect(r.rows[0].details).toEqual({ rationale: "Expanding fleet", key_contacts: "J. Ruiz (COO)", next_steps: "Intro meeting in Q1" });
    expect((await rejects(db.as(cs1, "select public.update_bd_item($1, '{\"name\":\"x\"}', 1)", [item]))).code).toBe("LC409");
    expect((await rejects(db.as(cs1, "select public.update_bd_item($1, '{\"details\":{\"booth_size\":\"x\"}}')", [item]))).code).toBe("LC422");
    expect((await rejects(db.as(cs1, "select public.update_bd_item($1, '{\"value_2026\":\"lots\"}')", [item]))).code).toBe("LC422");
  });
  it("is invisible to other units and supports comments", async () => {
    expect((await db.as(ga1, "select * from public.bd_items where id = $1", [item])).rows).toHaveLength(0);
    expect((await rejects(db.as(ga1, "select public.update_bd_item($1, '{\"name\":\"x\"}')", [item]))).code).toBe("LC404");
    await db.as(cs1, "select public.add_comment(null, null, 'Ask about 2027 budget cycle', 'comment', null, $1)", [item]);
    expect((await db.sql("select comment_count from public.bd_items where id = $1", [item])).rows[0].comment_count).toBe(1);
  });
  it("only the creator, owner, or an admin may delete", async () => {
    expect((await rejects(db.as(cs3, "select public.delete_bd_item($1)", [item]))).code).toBe("LC403");
  });
  it("the Executive View totals BD by unit and flags shared names across units", async () => {
    await db.as(ga1, "select public.create_bd_item($1, 'client', 'retain', '  acme   energy ')", [GA]);
    await db.as(ga1, "select public.create_bd_item($1, 'association', 'member', 'NEMA')", [GA]);
    const ex = (await db.as(exec, "select public.get_exec_summary() s")).rows[0].s;
    const csGrow = ex.bd.find((b: any) => b.unit_id === CS && b.kind === "client" && b.category === "grow");
    expect(csGrow).toMatchObject({ n: 1, value_2027: 250000 });
    expect(ex.bd_overlaps).toEqual([expect.objectContaining({ kind: "client", units: expect.arrayContaining(["Corporate Solutions", "Government Advisory"]) })]);
  });
  it("BD export lists items with unit and flattened details; admin only", async () => {
    const rows = (await db.as(admin, "select public.admin_export('bd') e")).rows[0].e;
    const acme = rows.find((r: any) => r.name === "Acme Energy");
    expect(acme).toMatchObject({ business_unit: "WOB Corporate Solutions", sponsor_owner: "cs_two", rationale: "Expanding fleet" });
    expect((await rejects(db.as(exec, "select public.admin_export('bd')"))).code).toBe("LC403");
  });
});

describe("Assigning people to units", () => {
  it("approval requires a unit, and admins can reassign", async () => {
    const pat = await db.createUser("pat_pending", { status: "pending", units: [] });
    expect((await rejects(db.as(admin, "select public.admin_review_registration($1, true)", [pat.id]))).code).toBe("LC422");
    await db.as(admin, "select public.admin_review_registration($1, true, 'participant', null, array[$2]::uuid[])", [pat.id, CARIBE]);
    expect((await db.as(pat, "select slug from public.business_units")).rows.map((r) => r.slug)).toEqual(["caribe"]);
    await db.as(admin, "select public.admin_set_units($1, array[$2]::uuid[], false)", [pat.id, EM]);
    expect((await db.as(pat, "select slug from public.business_units")).rows.map((r) => r.slug)).toEqual(["emergency-management"]);
    expect((await rejects(db.as(cs1, "select public.admin_set_units($1, '{}', true)", [cs1.id]))).code).toBe("LC403");
  });
  it("a participant cannot make themselves cross-cutting", async () => {
    const err = await rejects(db.as(cs1, "update public.workspace_memberships set all_units = true where user_id = $1", [cs1.id]));
    expect(err.message).toMatch(/permission denied/);
    const err2 = await rejects(db.as(cs1, "insert into public.unit_memberships values ($1, $2)", [cs1.id, GA]));
    expect(err2.message).toMatch(/permission denied/);
  });
});
