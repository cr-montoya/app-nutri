import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, createHash } from "node:crypto";
import type { Session } from "next-auth";
import { adminDb } from "../helpers/admin-db";

/**
 * T2.3, closes REQ-014, REQ-016. Runs against the real local Postgres,
 * through revokeInviteAction's own withTenant call, so the conditional
 * updateMany and RLS are actually exercised. Same auth-mocking approach as
 * tests/integration/send-invite.test.ts.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
const { auth } = await import("@/lib/auth");
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

const runId = Date.now();
const createdEmails: string[] = [];
let emailCounter = 0;

function uniqueEmail(label: string) {
  emailCounter += 1;
  const email = `revoke-invite-${label}-${runId}-${emailCounter}@example.test`;
  createdEmails.push(email);
  return email;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

let org: { id: string };
let otherOrg: { id: string };
let adminUser: { id: string };

async function seedMembership(label: string, role: "ADMIN" | "NUTRITIONIST" | "FRONT_DESK", organizationId: string) {
  const user = await adminDb.user.create({
    data: { email: uniqueEmail(`actor-${label}`), passwordHash: "x", name: `Actor ${label}` },
  });
  await adminDb.membership.create({ data: { userId: user.id, organizationId, role } });
  return user;
}

async function seedInvite(organizationId: string, overrides: Partial<{ acceptedAt: Date; revokedAt: Date }> = {}) {
  return adminDb.invite.create({
    data: {
      email: uniqueEmail("invitee"),
      role: "NUTRITIONIST",
      tokenHash: hashToken(randomBytes(32).toString("hex")),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      organizationId,
      ...overrides,
    },
  });
}

function asAdmin() {
  mockAuth.mockResolvedValue({ user: { id: adminUser.id }, organizationId: org.id } as Session);
}

beforeEach(async () => {
  vi.clearAllMocks();
  org = await adminDb.organization.create({
    data: { name: `Revoke Invite Org ${runId}`, slug: `revoke-invite-org-${runId}-${Math.random()}` },
  });
  otherOrg = await adminDb.organization.create({
    data: { name: `Revoke Invite Other Org ${runId}`, slug: `revoke-invite-other-org-${runId}-${Math.random()}` },
  });
  adminUser = await seedMembership("admin", "ADMIN", org.id);
});

afterAll(async () => {
  await adminDb.invite.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.membership.deleteMany({ where: { user: { email: { in: createdEmails } } } });
  await adminDb.user.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.organization.deleteMany({
    where: { slug: { startsWith: `revoke-invite-org-${runId}` } },
  });
  await adminDb.organization.deleteMany({
    where: { slug: { startsWith: `revoke-invite-other-org-${runId}` } },
  });
  await adminDb.$disconnect();
});

describe("revokeInviteAction (REQ-014)", () => {
  it("sets revokedAt on a pending invite and reports success", async () => {
    asAdmin();
    const { revokeInviteAction } = await import("@/server/actions/team");

    const invite = await seedInvite(org.id);
    const result = await revokeInviteAction(invite.id);

    expect(result.success).toBe(true);
    const updated = await adminDb.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(updated.revokedAt).not.toBeNull();
  });

  it("fails without changing the row when the invite is already accepted", async () => {
    asAdmin();
    const { revokeInviteAction } = await import("@/server/actions/team");

    const invite = await seedInvite(org.id, { acceptedAt: new Date() });
    const result = await revokeInviteAction(invite.id);

    expect(result.success).toBe(false);
    const unchanged = await adminDb.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(unchanged.revokedAt).toBeNull();
  });

  it("fails without error when the invite is already revoked (idempotent no-op)", async () => {
    asAdmin();
    const { revokeInviteAction } = await import("@/server/actions/team");

    const firstRevokedAt = new Date();
    const invite = await seedInvite(org.id, { revokedAt: firstRevokedAt });
    const result = await revokeInviteAction(invite.id);

    expect(result.success).toBe(false);
    const unchanged = await adminDb.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(unchanged.revokedAt?.getTime()).toBe(firstRevokedAt.getTime());
  });

  it("cannot revoke another organization's invite", async () => {
    asAdmin();
    const { revokeInviteAction } = await import("@/server/actions/team");

    const foreignInvite = await seedInvite(otherOrg.id);
    const result = await revokeInviteAction(foreignInvite.id);

    expect(result.success).toBe(false);
    const unchanged = await adminDb.invite.findUniqueOrThrow({ where: { id: foreignInvite.id } });
    expect(unchanged.revokedAt).toBeNull();
  });
});

describe("revokeInviteAction (REQ-016)", () => {
  it("rejects a NUTRITIONIST attempting to revoke an invite", async () => {
    const nutritionist = await seedMembership("nutritionist", "NUTRITIONIST", org.id);
    mockAuth.mockResolvedValue({ user: { id: nutritionist.id }, organizationId: org.id } as Session);
    const { revokeInviteAction } = await import("@/server/actions/team");

    const invite = await seedInvite(org.id);
    const result = await revokeInviteAction(invite.id);

    expect(result.success).toBe(false);
    const unchanged = await adminDb.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(unchanged.revokedAt).toBeNull();
  });

  it("rejects an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null);
    const { revokeInviteAction } = await import("@/server/actions/team");

    const invite = await seedInvite(org.id);
    const result = await revokeInviteAction(invite.id);

    expect(result.success).toBe(false);
    const unchanged = await adminDb.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(unchanged.revokedAt).toBeNull();
  });
});
