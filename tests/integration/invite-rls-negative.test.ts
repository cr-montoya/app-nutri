import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createHash, randomBytes } from "node:crypto";
import { adminDb } from "../helpers/admin-db";

/**
 * Negative RLS test (T1.5, closes REQ-021 db-layer half): a raw `pg` client
 * -- bypassing Prisma and the `withTenant` extension entirely -- with
 * `app.current_org_id` set to org A must still get zero rows querying org
 * B's invites directly through the org-scoped branch of the policy. Same
 * pattern as rls-negative.test.ts for memberships/professionals.
 */

const runId = Date.now();

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

let orgA: { id: string };
let orgB: { id: string };
let inviteA: { id: string; tokenHash: string };
let inviteB: { id: string; tokenHash: string };

beforeAll(async () => {
  orgA = await adminDb.organization.create({
    data: { name: "Invite RLS Negative Org A", slug: `invite-rls-negative-org-a-${runId}` },
  });
  orgB = await adminDb.organization.create({
    data: { name: "Invite RLS Negative Org B", slug: `invite-rls-negative-org-b-${runId}` },
  });
  inviteA = await adminDb.invite.create({
    data: {
      email: `invite-negative-a-${runId}@example.test`,
      role: "ADMIN",
      tokenHash: hashToken(randomBytes(32).toString("hex")),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      organizationId: orgA.id,
    },
  });
  inviteB = await adminDb.invite.create({
    data: {
      email: `invite-negative-b-${runId}@example.test`,
      role: "ADMIN",
      tokenHash: hashToken(randomBytes(32).toString("hex")),
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

async function queryAsOrg(organizationId: string, sql: string, params: string[]) {
  // Raw `pg`, not Prisma: the non-superuser appnutri_app role, which is the
  // role RLS policies actually apply to.
  const client = new Client({ connectionString: process.env.APP_DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [organizationId]);
    const result = await client.query(sql, params);
    await client.query("COMMIT");
    return result.rows;
  } finally {
    await client.end();
  }
}

describe("Raw pg client: negative RLS on invites", () => {
  it("returns zero invites rows for org B when scoped to org A", async () => {
    const rows = await queryAsOrg(orgA.id, "SELECT * FROM invites WHERE id = $1", [inviteB.id]);
    expect(rows).toHaveLength(0);
  });

  it("still returns org A's own invites when scoped to org A (RLS isn't blocking everything)", async () => {
    const rows = await queryAsOrg(orgA.id, "SELECT * FROM invites WHERE id = $1", [inviteA.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].organizationId).toBe(orgA.id);
  });

  it("returns zero rows for either org with no app.current_org_id set at all", async () => {
    const client = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await client.connect();
    try {
      const result = await client.query("SELECT * FROM invites WHERE id IN ($1, $2)", [
        inviteA.id,
        inviteB.id,
      ]);
      expect(result.rows).toHaveLength(0);
    } finally {
      await client.end();
    }
  });
});
