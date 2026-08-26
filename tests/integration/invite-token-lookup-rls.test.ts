import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { adminDb } from "../helpers/admin-db";

/**
 * Token-scoped RLS test (T1.6, closes REQ-006, REQ-020): with
 * `app.invite_lookup_token_hash` set to a specific invite's hash and
 * `app.current_org_id` left unset, exactly that one row is visible; a
 * random 64-hex-char hash matching no invite returns zero rows. Proves the
 * token-scoped branch of the RLS policy from ADR-0002
 * (docs/adr/0002-token-scoped-rls-lookup.md), the pre-authentication lookup
 * path `acceptInviteAction` (T3.2, out of this task's scope) will rely on.
 *
 * Uses a raw `pg` client, not Prisma's extended `db`/`withTenant`: there is
 * no reusable wrapper for this session variable yet (a deliberate, narrow
 * exception per ADR-0002, not an oversight), so the test sets
 * `app.invite_lookup_token_hash` directly via `set_config`, the same shape
 * a future helper would use internally.
 */

const runId = Date.now();

let orgA: { id: string };
let orgB: { id: string };
let targetInvite: { id: string; tokenHash: string };
let otherInvite: { id: string; tokenHash: string };

beforeAll(async () => {
  orgA = await adminDb.organization.create({
    data: { name: "Invite Token Lookup Org A", slug: `invite-token-lookup-org-a-${runId}` },
  });
  orgB = await adminDb.organization.create({
    data: { name: "Invite Token Lookup Org B", slug: `invite-token-lookup-org-b-${runId}` },
  });
  targetInvite = await adminDb.invite.create({
    data: {
      email: `invite-token-lookup-target-${runId}@example.test`,
      role: "NUTRITIONIST",
      tokenHash: randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      organizationId: orgA.id,
    },
  });
  otherInvite = await adminDb.invite.create({
    data: {
      email: `invite-token-lookup-other-${runId}@example.test`,
      role: "FRONT_DESK",
      tokenHash: randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      organizationId: orgB.id,
    },
  });
});

afterAll(async () => {
  await adminDb.invite.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await adminDb.$disconnect();
});

async function queryByTokenHash(tokenHash: string) {
  // Raw `pg`, not Prisma: the non-superuser appnutri_app role, which is the
  // role RLS policies actually apply to. app.current_org_id is deliberately
  // never set in this connection, matching the pre-authentication moment
  // acceptInviteAction's token lookup runs at: no session, no org context.
  const client = new Client({ connectionString: process.env.APP_DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.invite_lookup_token_hash', $1, true)", [tokenHash]);
    const result = await client.query("SELECT * FROM invites");
    await client.query("COMMIT");
    return result.rows;
  } finally {
    await client.end();
  }
}

describe("Raw pg client: token-scoped RLS on invites", () => {
  it("returns exactly the one invite matching the token hash, with app.current_org_id unset", async () => {
    const rows = await queryByTokenHash(targetInvite.tokenHash);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(targetInvite.id);
    expect(rows[0].organizationId).toBe(orgA.id);
  });

  it("does not leak other invites while scoped to one token hash", async () => {
    const rows = await queryByTokenHash(targetInvite.tokenHash);
    expect(rows.some((row) => row.id === otherInvite.id)).toBe(false);
  });

  it("returns zero rows for a random 64-hex-char hash matching no invite", async () => {
    const randomHash = randomBytes(32).toString("hex");
    expect(randomHash).toHaveLength(64);
    const rows = await queryByTokenHash(randomHash);
    expect(rows).toHaveLength(0);
  });
});
