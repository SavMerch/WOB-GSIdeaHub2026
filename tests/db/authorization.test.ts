import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, rejects, type TestDb } from "./helpers";

let db: TestDb;
let admin: { id: string };
let alice: { id: string };
let bob: { id: string };
let carol: { id: string };
let viewer: { id: string };
let pending: { id: string };

beforeAll(async () => {
  db = await freshDb();
  admin = await db.createUser("admin_amy", { role: "admin" });
  alice = await db.createUser("alice");
  bob = await db.createUser("bob");
  carol = await db.createUser("carol");
  viewer = await db.createUser("vic", { role: "viewer" });
  pending = await db.createUser("penny", { status: "pending" });
});
afterAll(async () => db?.close());

const create = (who: { id: string }, board: string, title: string, anon = false) =>
  db
    .as(who, "select public.create_contribution($1, $2, '', null, '{}'::jsonb, $3, null) as id", [board, title, anon])
    .then((r) => r.rows[0].id as string);

describe("Scenario 8: unauthenticated visitors", () => {
  it("anon cannot read any workspace table", async () => {
    for (const t of ["contributions", "profiles", "workspace_settings", "authentication_events", "health_ratings"]) {
      const err = await rejects(db.as("anon", `select * from public.${t}`));
      expect(err.message).toMatch(/permission denied/);
    }
  });
  it("anon cannot call any RPC", async () => {
    const err = await rejects(db.as("anon", "select public.create_contribution('barriers','x')"));
    expect(err.message).toMatch(/permission denied/);
  });
  it("anon and authenticated cannot read invitation code hashes or tokens", async () => {
    for (const who of ["anon", alice, admin] as const) {
      const err = await rejects(db.as(who, "select * from public.invitation_codes"));
      expect(err.message).toMatch(/permission denied/);
      const err2 = await rejects(db.as(who, "select * from public.registration_tokens"));
      expect(err2.message).toMatch(/permission denied/);
    }
  });
  it("no client role can write tables directly", async () => {
    const err = await rejects(
      db.as(alice, "insert into public.contributions (dashboard, board, title) values (2, 'barriers', 'x')"),
    );
    expect(err.message).toMatch(/permission denied/);
    const err2 = await rejects(
      db.as(alice, "update public.workspace_memberships set role = 'admin' where user_id = $1", [alice.id]),
    );
    expect(err2.message).toMatch(/permission denied/);
  });
});

describe("Scenario 1: pending users see nothing", () => {
  it("pending user reads zero rows and cannot contribute", async () => {
    await create(alice, "honest_working", "We answer the phone fast");
    const { rows } = await db.as(pending, "select * from public.contributions");
    expect(rows).toHaveLength(0);
    const err = await rejects(create(pending, "barriers", "sneaky"));
    expect(err.code).toBe("LC401");
    const own = await db.as(pending, "select status from public.workspace_memberships");
    expect(own.rows).toEqual([{ status: "pending" }]);
  });
  it("pending user cannot approve themselves", async () => {
    const err = await rejects(db.as(pending, "select public.admin_review_registration($1, true)", [pending.id]));
    expect(err.code).toBe("LC403");
  });
  it("active members cannot see pending applicants in profiles", async () => {
    const { rows } = await db.as(alice, "select username from public.profiles");
    expect(rows.map((r) => r.username)).not.toContain("penny");
  });
});

describe("Scenario 2: admin approval", () => {
  it("admin approves and the user gains access", async () => {
    await db.as(admin, "select public.admin_review_registration($1, true, 'participant', null)", [pending.id]);
    const { rows } = await db.as(pending, "select count(*)::int as n from public.contributions");
    expect(rows[0].n).toBeGreaterThan(0);
    const audit = await db.as(admin, "select action from public.administrative_audit_logs where target_id = $1", [
      pending.id,
    ]);
    expect(audit.rows.map((r) => r.action)).toContain("member.approve");
  });
  it("participants cannot use admin functions", async () => {
    for (const q of [
      ["select * from public.admin_list_people()", []],
      ["select public.admin_set_role($1, 'admin')", [alice.id]],
      ["select public.admin_set_status($1, 'suspended')", [bob.id]],
      ["select public.admin_update_settings('{\"allow_anonymous\":false}')", []],
      ["select public.admin_export('contributions')", []],
      ["select public.admin_overview()", []],
    ] as const) {
      const err = await rejects(db.as(alice, q[0], [...q[1]]));
      expect(err.code).toBe("LC403");
    }
  });
});

describe("Cross-user edits and conflicts", () => {
  it("only the author can edit; stale versions are rejected", async () => {
    const id = await create(alice, "barriers", "Approvals take weeks");
    const err = await rejects(
      db.as(bob, "select public.update_contribution($1, 1, 'hijacked', '', null, '{}')", [id]),
    );
    expect(err.code).toBe("LC403");
    const v2 = await db.as(alice, "select public.update_contribution($1, 1, 'Approvals take 3 weeks', '', null, '{}') v", [id]);
    expect(v2.rows[0].v).toBe(2);
    const conflict = await rejects(
      db.as(alice, "select public.update_contribution($1, 1, 'old copy', '', null, '{}')", [id]),
    );
    expect(conflict.code).toBe("LC409");
  });
  it("participants cannot delete others' contributions or comments", async () => {
    const id = await create(alice, "known_for", "Calm under pressure");
    const cid = (await db.as(alice, "select public.add_comment($1, null, 'agreed', 'comment', null) id", [id])).rows[0].id;
    expect((await rejects(db.as(bob, "select public.delete_contribution($1)", [id]))).code).toBe("LC403");
    expect((await rejects(db.as(bob, "select public.delete_comment($1)", [cid]))).code).toBe("LC403");
    expect((await rejects(db.as(bob, "select public.edit_comment($1, 'x')", [cid]))).code).toBe("LC403");
  });
  it("viewers are read-only", async () => {
    const { rows } = await db.as(viewer, "select count(*)::int n from public.contributions");
    expect(rows[0].n).toBeGreaterThan(0);
    expect((await rejects(create(viewer, "barriers", "x"))).code).toBe("LC403");
  });
  it("repeated clicks with the same request id create one record", async () => {
    const rid = "11111111-2222-3333-4444-555555555555";
    const q = "select public.create_contribution('known_for', 'Double click', '', null, '{}', false, $1) id";
    const a = await db.as(alice, q, [rid]);
    const b = await db.as(alice, q, [rid]);
    expect(a.rows[0].id).toBe(b.rows[0].id);
  });
  it("input is validated server-side", async () => {
    expect((await rejects(create(alice, "barriers", "   "))).code).toBe("LC422");
    expect((await rejects(create(alice, "barriers", "x".repeat(201)))).code).toBe("LC422");
    expect(
      (await rejects(db.as(alice, "select public.create_contribution('grow', 't', '', null, '{\"evil\":\"1\"}')"))).code,
    ).toBe("LC422");
  });
});

describe("Reactions", () => {
  it("toggle is idempotent per user and counts are maintained", async () => {
    const id = await create(alice, "barriers", "Too many tools");
    await db.as(bob, "select public.toggle_reaction($1, 'resonates')", [id]);
    await db.as(carol, "select public.toggle_reaction($1, 'resonates')", [id]);
    let r = await db.as(alice, "select resonates_count from public.contributions where id = $1", [id]);
    expect(r.rows[0].resonates_count).toBe(2);
    await db.as(bob, "select public.toggle_reaction($1, 'resonates')", [id]); // un-react
    r = await db.as(alice, "select resonates_count from public.contributions where id = $1", [id]);
    expect(r.rows[0].resonates_count).toBe(1);
  });
  it("the database refuses duplicate reactions", async () => {
    const id = await create(alice, "barriers", "Dup check");
    await db.sql("insert into public.contribution_reactions values ($1, $2, 'resonates')", [id, bob.id]);
    const err = await rejects(db.sql("insert into public.contribution_reactions values ($1, $2, 'resonates')", [id, bob.id]));
    expect(err.code).toBe("23505");
  });
  it("users see only their own reaction rows", async () => {
    const { rows } = await db.as(alice, "select distinct user_id from public.contribution_reactions");
    expect(rows.every((r) => r.user_id === alice.id)).toBe(true);
  });
  it("at most three 'most significant' marks per board", async () => {
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await create(alice, "barriers", `Issue ${i}`));
    for (let i = 0; i < 3; i++) await db.as(carol, "select public.toggle_reaction($1, 'top')", [ids[i]]);
    expect((await rejects(db.as(carol, "select public.toggle_reaction($1, 'top')", [ids[3]]))).code).toBe("LC429");
  });
});

describe("Scenario 4: anonymous contributions", () => {
  it("stores no author and exposes none to peers, admins, feed, or exports", async () => {
    const id = await create(bob, "honest_unsaid", "We avoid hard conversations", true);
    const raw = await db.sql("select * from public.contributions where id = $1", [id]);
    expect(raw.rows[0].author_id).toBeNull();
    expect(raw.rows[0].is_anonymous).toBe(true);
    // No foreign key, log row, or audit entry references Bob for this item
    const feed = await db.sql("select actor_id from public.activity_events where entity_id = $1", [id]);
    expect(feed.rows.every((r) => r.actor_id === null)).toBe(true);
    const leaks = await db.sql(
      `select count(*)::int n from public.administrative_audit_logs where target_id = $1::text
       union all select count(*)::int from public.contribution_reactions where contribution_id = $1::uuid and user_id = $2`,
      [id, bob.id],
    );
    expect(leaks.rows.every((r) => r.n === 0)).toBe(true);
    const exp = await db.as(admin, "select public.admin_export('contributions') e");
    const row = exp.rows[0].e.find((x: any) => x.id === id);
    expect(row.author).toBe("Anonymous");
    expect(JSON.stringify(row)).not.toContain(bob.id);
  });
  it("the anonymous author cannot later edit it (nothing links it to them)", async () => {
    const id = await create(bob, "honest_unsaid", "Anonymous edit attempt", true);
    expect((await rejects(db.as(bob, "select public.update_contribution($1, 1, 'x', '', null, '{}')", [id]))).code).toBe("LC403");
  });
  it("boards that do not allow anonymity refuse it", async () => {
    expect((await rejects(create(bob, "honest_working", "anon here", true))).code).toBe("LC403");
  });
  it("admin can switch anonymity off workspace-wide", async () => {
    await db.as(admin, "select public.admin_update_settings('{\"allow_anonymous\": false}')");
    expect((await rejects(create(bob, "honest_unsaid", "blocked", true))).code).toBe("LC403");
    await db.as(admin, "select public.admin_update_settings('{\"allow_anonymous\": true}')");
  });
});

describe("Scenario 5: private rankings and ratings", () => {
  const factorIds = async () =>
    (await db.sql("select id from public.priority_factors where active order by sort")).rows.map((r) => r.id);

  it("rejects invalid rankings", async () => {
    const ids = await factorIds();
    expect((await rejects(db.as(alice, "select public.submit_priority_ranking($1)", [ids.slice(1)]))).code).toBe("LC422");
    expect(
      (await rejects(db.as(alice, "select public.submit_priority_ranking($1)", [[ids[0], ...ids.slice(0, -1)]]))).code,
    ).toBe("LC422");
  });

  it("aggregates are suppressed below the threshold and appear at it", async () => {
    const ids = await factorIds();
    await db.as(alice, "select public.submit_priority_ranking($1)", [ids]);
    await db.as(bob, "select public.submit_priority_ranking($1)", [[...ids].reverse()]);
    let s = await db.as(carol, "select * from public.get_priority_summary()");
    expect(s.rows[0].rank_suppressed).toBe(true);
    expect(s.rows[0].avg_rank).toBeNull();
    expect(s.rows[0].rank_distribution).toBeNull();

    await db.as(carol, "select public.submit_priority_ranking($1)", [ids]);
    s = await db.as(alice, "select * from public.get_priority_summary()");
    expect(s.rows[0].rank_suppressed).toBe(false);
    expect(Number(s.rows[0].avg_rank)).toBeCloseTo((1 + 9 + 1) / 3, 1);
  });

  it("nobody — including admins — can read another person's answers", async () => {
    for (const who of [bob, admin]) {
      const r = await db.as(who, "select * from public.priority_rankings where user_id = $1", [alice.id]);
      expect(r.rows).toHaveLength(0);
    }
    const mine = await db.as(alice, "select count(*)::int n from public.priority_rankings");
    expect(mine.rows[0].n).toBe(9);
  });

  it("health ratings: range enforced, own-only, thresholded", async () => {
    const cats = (await db.sql("select id from public.health_categories order by sort")).rows.map((r) => r.id);
    expect(
      (await rejects(db.as(alice, "select public.submit_health_ratings($1)", [JSON.stringify([{ category_id: cats[0], score: 11 }])])))
        .code,
    ).toBe("LC422");
    await db.as(alice, "select public.submit_health_ratings($1)", [JSON.stringify([{ category_id: cats[0], score: 8 }])]);
    let s = await db.as(bob, "select * from public.get_health_summary() where category_id = $1", [cats[0]]);
    expect(s.rows[0].suppressed).toBe(true);
    expect(s.rows[0].avg_score).toBeNull();
    await db.as(bob, "select public.submit_health_ratings($1)", [JSON.stringify([{ category_id: cats[0], score: 6 }])]);
    await db.as(carol, "select public.submit_health_ratings($1)", [JSON.stringify([{ category_id: cats[0], score: 4 }])]);
    s = await db.as(bob, "select * from public.get_health_summary() where category_id = $1", [cats[0]]);
    expect(Number(s.rows[0].avg_score)).toBe(6);
    const peek = await db.as(admin, "select * from public.health_ratings where user_id <> $1", [admin.id]);
    expect(peek.rows).toHaveLength(0);
  });

  it("threshold can never be set below 3", async () => {
    const err = await rejects(db.as(admin, "select public.admin_update_settings('{\"privacy_threshold\": 2}')"));
    expect(err.code).toBe("23514");
  });
});

describe("Scenario 6: suspension takes effect immediately", () => {
  it("a suspended user with a still-valid session is refused at once", async () => {
    const dave = await db.createUser("dave");
    await create(dave, "known_for", "Before suspension");
    await db.as(admin, "select public.admin_set_status($1, 'suspended')", [dave.id]);
    const r = await db.as(dave, "select * from public.contributions");
    expect(r.rows).toHaveLength(0);
    expect((await rejects(create(dave, "known_for", "After suspension"))).code).toBe("LC401");
    expect((await rejects(db.as(dave, "select * from public.get_home_summary()"))).code).toBe("LC401");
    // reactivation restores access
    await db.as(admin, "select public.admin_set_status($1, 'active')", [dave.id]);
    expect((await db.as(dave, "select count(*)::int n from public.contributions")).rows[0].n).toBeGreaterThan(0);
  });
  it("admins cannot lock themselves out or remove the last admin", async () => {
    expect((await rejects(db.as(admin, "select public.admin_set_status($1, 'suspended')", [admin.id]))).code).toBe("LC422");
    expect((await rejects(db.as(admin, "select public.admin_set_role($1, 'participant')", [admin.id]))).code).toBe("LC422");
  });
});

describe("Scenario 9: security logs are admin-only", () => {
  it("login events are visible to admins only", async () => {
    await db.as("service", "select public.svc_record_login($1, '203.0.113.5', 'Vitest', 'sess-1')", [alice.id]);
    const a = await db.as(admin, "select ip, event_type from public.authentication_events where user_id = $1", [alice.id]);
    expect(a.rows[0]).toMatchObject({ ip: "203.0.113.5", event_type: "login_success" });
    const p = await db.as(alice, "select * from public.authentication_events");
    expect(p.rows).toHaveLength(0);
    const people = await rejects(db.as(alice, "select * from public.admin_list_people()"));
    expect(people.code).toBe("LC403");
  });
  it("flags a login from a new network address", async () => {
    await db.as("service", "select public.svc_record_login($1, '198.51.100.7', 'Vitest', 'sess-2')", [alice.id]);
    const r = await db.sql("select unusual from public.authentication_events where ip = '198.51.100.7'");
    expect(r.rows[0].unusual).toBe(true);
  });
  it("general exports exclude IPs; the security export is separate", async () => {
    const c = await db.as(admin, "select public.admin_export('participation') e");
    expect(JSON.stringify(c.rows[0].e)).not.toMatch(/203\.0\.113/);
    const s = await db.as(admin, "select public.admin_export('security') e");
    expect(JSON.stringify(s.rows[0].e)).toMatch(/203\.0\.113\.5/);
  });
  it("retention purge removes old events", async () => {
    await db.sql("update public.authentication_events set created_at = now() - interval '40 days' where session_id = 'sess-1'");
    await db.as("service", "select public.purge_security_logs()");
    const r = await db.sql("select count(*)::int n from public.authentication_events where session_id = 'sess-1'");
    expect(r.rows[0].n).toBe(0);
  });
  it("audit log cannot be altered by anyone through the API", async () => {
    expect((await rejects(db.as(admin, "delete from public.administrative_audit_logs"))).message).toMatch(/permission denied/);
  });
});

describe("Server-only helpers", () => {
  it("registration tokens are single-use", async () => {
    await db.sql("insert into public.registration_tokens (jti, expires_at) values ('aaaaaaaa-0000-0000-0000-000000000001', now() + interval '10 minutes')");
    const first = await db.as("service", "select public.svc_consume_registration_token('aaaaaaaa-0000-0000-0000-000000000001') ok");
    const second = await db.as("service", "select public.svc_consume_registration_token('aaaaaaaa-0000-0000-0000-000000000001') ok");
    expect(first.rows[0].ok).toBe(true);
    expect(second.rows[0].ok).toBe(false);
  });
  it("expired tokens are refused", async () => {
    await db.sql("insert into public.registration_tokens (jti, expires_at) values ('aaaaaaaa-0000-0000-0000-000000000002', now() - interval '1 minute')");
    const r = await db.as("service", "select public.svc_consume_registration_token('aaaaaaaa-0000-0000-0000-000000000002') ok");
    expect(r.rows[0].ok).toBe(false);
  });
  it("rate limiter blocks after the limit", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push((await db.as("service", "select public.svc_rate_limit_hit('test:ip', 3, 600) ok")).rows[0].ok);
    }
    expect(results).toEqual([true, true, true, false]);
  });
  it("authenticated users cannot call server-only helpers", async () => {
    expect((await rejects(db.as(alice, "select public.svc_record_login($1, '1.1.1.1', 'x', 'y')", [alice.id]))).message)
      .toMatch(/permission denied/);
    expect((await rejects(db.as(alice, "select public.bootstrap_first_admin('a','b','c')"))).message).toMatch(/permission denied/);
  });
  it("bootstrap refuses once an admin exists", async () => {
    const err = await rejects(db.sql("select public.bootstrap_first_admin('alice@example.test', 'alice', 'A')"));
    expect(err.message).toMatch(/already exists/);
  });
});
