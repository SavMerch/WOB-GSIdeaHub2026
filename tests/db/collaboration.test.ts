import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, rejects, type TestDb } from "./helpers";

let db: TestDb;
let admin: { id: string };
let alice: { id: string };
let bob: { id: string };

beforeAll(async () => {
  db = await freshDb();
  admin = await db.createUser("admin_amy", { role: "admin" });
  alice = await db.createUser("alice");
  bob = await db.createUser("bob");
});
afterAll(async () => db?.close());

const create = (who: { id: string }, board: string, title: string) =>
  db
    .as(who, "select public.create_contribution((select id from public.business_units where slug = 'corporate-solutions'), $1, $2) as id", [board, title])
    .then((r) => r.rows[0].id as string);

describe("Comments", () => {
  it("first comment moves an open item to discussing and counts update", async () => {
    const id = await create(alice, "barriers", "Hiring is slow");
    await db.as(bob, "select public.add_comment($1, null, 'Agreed — six weeks last time', 'comment', null)", [id]);
    await db.as(bob, "select public.add_comment($1, null, 'Pre-approve two roles', 'solution', null)", [id]);
    const r = await db.as(alice, "select status, comment_count from public.contributions where id = $1", [id]);
    expect(r.rows[0]).toEqual({ status: "discussing", comment_count: 2 });
  });
  it("hidden comments are invisible to others and leave the count", async () => {
    const id = await create(alice, "known_for", "Straight talk");
    const cid = (await db.as(bob, "select public.add_comment($1, null, 'rude remark', 'comment', null) id", [id])).rows[0].id;
    await db.as(admin, "select public.admin_moderate('comment', $1, true, null, 'tone')", [cid]);
    const seen = await db.as(alice, "select * from public.contribution_comments where id = $1", [cid]);
    expect(seen.rows).toHaveLength(0);
    const c = await db.as(alice, "select comment_count from public.contributions where id = $1", [id]);
    expect(c.rows[0].comment_count).toBe(0);
  });
});

describe("Cross-dashboard links (Section 14)", () => {
  it("links an issue, an opportunity, and a roadmap action without duplicating records", async () => {
    const issue = await create(alice, "barriers", "Slow decision-making");
    const opp = await create(bob, "grow", "Faster proposal turnaround");
    await db.as(bob, "select public.create_link('contribution', $1, 'contribution', $2)", [issue, opp]);
    // the same pair in reverse is not stored twice
    const dup = await db.as(alice, "select public.create_link('contribution', $1, 'contribution', $2) id", [opp, issue]);
    expect(dup.rows[0].id).toBeNull();

    const action = (
      await db.as(
        alice,
        "select public.create_roadmap_item((select id from public.business_units where slug = 'corporate-solutions'), 'Set a 48-hour decision rule', '', 60::smallint, 'Decisions within two days', null, $1, null) id",
        [issue],
      )
    ).rows[0].id;

    const rel = await db.as(alice, "select kind, title from public.get_related('contribution', $1) order by kind", [issue]);
    expect(rel.rows).toEqual([
      { kind: "contribution", title: "Faster proposal turnaround" },
      { kind: "roadmap", title: "Set a 48-hour decision rule" },
    ]);
    const back = await db.as(bob, "select title from public.get_related('roadmap', $1)", [action]);
    expect(back.rows[0].title).toBe("Slow decision-making");
  });
  it("refuses self-links", async () => {
    const id = await create(alice, "barriers", "Self");
    expect((await rejects(db.as(alice, "select public.create_link('contribution', $1, 'contribution', $1)", [id]))).code).toBe("LC422");
  });
});

describe("Roadmap (Dashboard 5)", () => {
  it("suggesting never assigns ownership; only admins/owners can agree or complete", async () => {
    const id = (
      await db.as(alice, "select public.create_roadmap_item((select id from public.business_units where slug = 'corporate-solutions'), 'Weekly ops huddle', '', 60::smallint, '', null, null, null) id")
    ).rows[0].id;
    const row = await db.as(alice, "select owner_id, status from public.roadmap_items where id = $1", [id]);
    expect(row.rows[0]).toEqual({ owner_id: null, status: "suggested" });

    await db.as(bob, "select public.set_roadmap_status($1, 'discussing')", [id]);
    expect((await rejects(db.as(alice, "select public.set_roadmap_status($1, 'agreed')", [id]))).code).toBe("LC403");

    await db.as(bob, "select public.set_roadmap_volunteer($1, 'offered_to_lead')", [id]);
    expect((await rejects(db.as(bob, "select public.set_roadmap_owner($1, $2)", [id, bob.id]))).code).toBe("LC403");
    await db.as(admin, "select public.set_roadmap_owner($1, $2)", [id, bob.id]);
    await db.as(bob, "select public.set_roadmap_status($1, 'agreed')", [id]); // owner may
    await db.as(bob, "select public.set_roadmap_status($1, 'completed')", [id]);
    expect((await db.sql("select status from public.roadmap_items where id = $1", [id])).rows[0].status).toBe("completed");
  });
  it("version conflicts are detected on roadmap edits", async () => {
    const id = (
      await db.as(alice, "select public.create_roadmap_item((select id from public.business_units where slug = 'corporate-solutions'), 'Client survey', '', 90::smallint, '', null, null, null) id")
    ).rows[0].id;
    await db.as(alice, "select public.update_roadmap_item($1, 1, 'Client survey v2', '', 90::smallint, '', null)", [id]);
    const err = await rejects(
      db.as(alice, "select public.update_roadmap_item($1, 1, 'stale', '', 90::smallint, '', null)", [id]),
    );
    expect(err.code).toBe("LC409");
  });
  it("only admins confirm shared commitments", async () => {
    const id = await create(alice, "expectations", "Share decisions within a week");
    expect((await rejects(db.as(alice, "select public.set_contribution_status($1, 'commitment')", [id]))).code).toBe("LC403");
    await db.as(admin, "select public.set_contribution_status($1, 'commitment')", [id]);
  });
});

describe("Home summary", () => {
  it("returns counts without individual data", async () => {
    const r = await db.as(alice, "select public.get_home_summary((select id from public.business_units where slug = 'corporate-solutions')) s");
    const s = r.rows[0].s;
    expect(s.members).toBe(3);
    expect(Object.keys(s)).toEqual(
      expect.arrayContaining(["active_participants", "contributions_by_dashboard", "roadmap_by_status", "themes"]),
    );
  });
});
