import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { adminDb } from "../helpers/admin-db";

/**
 * T3.2, closes REQ-006, REQ-013. Runs against the real local Postgres,
 * exercising `findPendingInviteByToken`'s raw-SQL, pre-authentication
 * lookup (ADR-0002) and its derived-pending check for real -- not mocked.
 * Invites are seeded directly via `adminDb` with a known raw token, whose
 * SHA-256 hash is stored as `tokenHash` the same way `sendInviteAction`
 * computes it.
 *
 * `@/lib/auth` is mocked (same as tests/integration/send-invite.test.ts)
 * purely so importing `@/server/actions/team` doesn't pull in Auth.js's
 * Next.js-runtime-only dependencies outside an actual request -- this test
 * never calls `auth()` itself, since `findPendingInviteByToken`/
 * `lookupInviteByToken` run before any session exists.
 */
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
const { findPendingInviteByToken, lookupInviteByToken } = await import("@/server/actions/team");

const runId = Date.now();
const createdEmails: string[] = [];
let emailCounter = 0;

function uniqueEmail(label: string) {
  emailCounter += 1;
  const email = `invite-lookup-${label}-${runId}-${emailCounter}@example.test`;
  createdEmails.push(email);
  return email;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

let org: { id: string };

async function seedInvite(
  overrides: Partial<{ acceptedAt: Date; revokedAt: Date; expiresAt: Date; role: "ADMIN" | "NUTRITIONIST" | "FRONT_DESK" }> = {}
) {
  const rawToken = randomBytes(32).toString("hex");
  const invite = await adminDb.invite.create({
    data: {
      email: uniqueEmail("invitee"),
      role: overrides.role ?? "NUTRITIONIST",
      tokenHash: hashToken(rawToken),
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      organizationId: org.id,
      acceptedAt: overrides.acceptedAt,
      revokedAt: overrides.revokedAt,
    },
  });
  return { rawToken, invite };
}

beforeAll(async () => {
  org = await adminDb.organization.create({
    data: { name: `Invite Lookup Org ${runId}`, slug: `invite-lookup-org-${runId}` },
  });
});

afterAll(async () => {
  await adminDb.invite.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.organization.deleteMany({ where: { id: org?.id } });
  await adminDb.$disconnect();
});

describe("findPendingInviteByToken (REQ-006)", () => {
  it("returns the invite for a valid, pending token", async () => {
    const { rawToken, invite } = await seedInvite();

    const result = await findPendingInviteByToken(rawToken);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(invite.id);
    expect(result?.email).toBe(invite.email);
    expect(result?.role).toBe("NUTRITIONIST");
    expect(result?.organizationId).toBe(org.id);
  });

  it("returns null for a random 64-hex-char token matching no invite", async () => {
    const randomToken = randomBytes(32).toString("hex");
    const result = await findPendingInviteByToken(randomToken);
    expect(result).toBeNull();
  });
});

describe("findPendingInviteByToken (REQ-013)", () => {
  it("returns null for an expired invite", async () => {
    const { rawToken } = await seedInvite({ expiresAt: new Date(Date.now() - 1000) });
    expect(await findPendingInviteByToken(rawToken)).toBeNull();
  });

  it("returns null for a revoked invite", async () => {
    const { rawToken } = await seedInvite({ revokedAt: new Date() });
    expect(await findPendingInviteByToken(rawToken)).toBeNull();
  });

  it("returns null for an already-accepted invite", async () => {
    const { rawToken } = await seedInvite({ acceptedAt: new Date() });
    expect(await findPendingInviteByToken(rawToken)).toBeNull();
  });
});

describe("lookupInviteByToken (REQ-006)", () => {
  it("returns only email and role for a valid, pending token", async () => {
    const { rawToken, invite } = await seedInvite({ role: "FRONT_DESK" });

    const result = await lookupInviteByToken(rawToken);

    expect(result).toEqual({ email: invite.email, role: "FRONT_DESK" });
  });

  it("returns null for an invalid token, same as findPendingInviteByToken", async () => {
    const result = await lookupInviteByToken(randomBytes(32).toString("hex"));
    expect(result).toBeNull();
  });
});
