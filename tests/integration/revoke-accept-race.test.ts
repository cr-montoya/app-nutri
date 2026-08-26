import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import type { Session } from "next-auth";
import { adminDb } from "../helpers/admin-db";

/**
 * T3.6, closes REQ-012. `revokeInviteAction` and `acceptInviteAction` race
 * on the same invite via `Promise.all`. REQ-012 only guarantees exactly one
 * of the two operations wins -- either ordering is a valid outcome of a
 * real race, so this asserts the invariant (never both, never neither),
 * not which one always wins.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/validation/auth", async () => {
  const actual = await vi.importActual<typeof import("@/validation/auth")>("@/validation/auth");
  return { ...actual, checkPasswordNotBreached: vi.fn().mockResolvedValue(undefined) };
});

const { acceptInviteAction, revokeInviteAction } = await import("@/server/actions/team");
const { auth } = await import("@/lib/auth");
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

const runId = Date.now();
const createdEmails: string[] = [];
let emailCounter = 0;

function uniqueEmail(label: string) {
  emailCounter += 1;
  const email = `revoke-accept-race-${runId}-${emailCounter}@example.test`;
  createdEmails.push(email);
  return email;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

let org: { id: string };
let adminUser: { id: string };

beforeEach(async () => {
  vi.clearAllMocks();
  org = await adminDb.organization.create({
    data: { name: `Revoke Accept Race Org ${runId}`, slug: `revoke-accept-race-org-${runId}-${Math.random()}` },
  });
  const user = await adminDb.user.create({
    data: { email: uniqueEmail("actor-admin"), passwordHash: "x", name: "Actor Admin" },
  });
  await adminDb.membership.create({ data: { userId: user.id, organizationId: org.id, role: "ADMIN" } });
  adminUser = user;
  mockAuth.mockResolvedValue({ user: { id: adminUser.id }, organizationId: org.id } as Session);
});

afterAll(async () => {
  await adminDb.membership.deleteMany({ where: { user: { email: { in: createdEmails } } } });
  await adminDb.invite.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.user.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.organization.deleteMany({
    where: { slug: { startsWith: `revoke-accept-race-org-${runId}` } },
  });
  await adminDb.$disconnect();
});

async function seedInvite() {
  const rawToken = randomBytes(32).toString("hex");
  const invite = await adminDb.invite.create({
    data: {
      email: uniqueEmail("invitee"),
      role: "NUTRITIONIST",
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      organizationId: org.id,
    },
  });
  return { rawToken, invite };
}

describe("revokeInviteAction vs. acceptInviteAction concurrency (REQ-012)", () => {
  it("lets exactly one of a racing revoke and accept win, never both, never neither", async () => {
    const { rawToken, invite } = await seedInvite();

    const [revokeResult, acceptResult] = await Promise.all([
      revokeInviteAction(invite.id),
      acceptInviteAction(rawToken, { name: "Racer", password: "a-valid-password-123" }),
    ]);

    const finalInvite = await adminDb.invite.findUniqueOrThrow({ where: { id: invite.id } });
    const user = await adminDb.user.findUnique({ where: { email: invite.email } });

    if (revokeResult.success) {
      // Revoke won: the invite is revoked, accept must have failed and
      // created no User.
      expect(acceptResult.success).toBe(false);
      expect(finalInvite.revokedAt).not.toBeNull();
      expect(finalInvite.acceptedAt).toBeNull();
      expect(user).toBeNull();
    } else {
      // Accept won: the invite is accepted, revoke must have failed and no
      // revokedAt was ever set.
      expect(acceptResult.success).toBe(true);
      expect(finalInvite.acceptedAt).not.toBeNull();
      expect(finalInvite.revokedAt).toBeNull();
      expect(user).not.toBeNull();
    }

    // Never both, never neither.
    expect(revokeResult.success !== acceptResult.success).toBe(true);
  });
});
