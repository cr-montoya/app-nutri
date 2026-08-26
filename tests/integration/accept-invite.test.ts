import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { adminDb } from "../helpers/admin-db";

/**
 * T3.4, closes REQ-010, REQ-012. Runs against the real local Postgres,
 * through `acceptInviteAction`'s own `$transaction`, so the conditional
 * UPDATE and RLS are actually exercised, not mocked. The HIBP network call
 * is mocked (REQ-009 itself is covered by tests/integration/invite-hibp.test.ts).
 * REQ-011's true concurrent-race proof lives in
 * tests/integration/accept-invite-race.test.ts (T3.5); REQ-012's in
 * tests/integration/revoke-accept-race.test.ts (T3.6) -- this file proves
 * the accept transaction's mechanics for the straightforward pending case.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/validation/auth", async () => {
  const actual = await vi.importActual<typeof import("@/validation/auth")>("@/validation/auth");
  return { ...actual, checkPasswordNotBreached: vi.fn().mockResolvedValue(undefined) };
});

const { acceptInviteAction } = await import("@/server/actions/team");

const runId = Date.now();
const createdEmails: string[] = [];
let emailCounter = 0;

function uniqueEmail(label: string) {
  emailCounter += 1;
  const email = `accept-invite-${label}-${runId}-${emailCounter}@example.test`;
  createdEmails.push(email);
  return email;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

let org: { id: string };

beforeEach(async () => {
  vi.clearAllMocks();
  org = await adminDb.organization.create({
    data: { name: `Accept Invite Org ${runId}`, slug: `accept-invite-org-${runId}-${Math.random()}` },
  });
});

afterAll(async () => {
  await adminDb.membership.deleteMany({ where: { user: { email: { in: createdEmails } } } });
  await adminDb.invite.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.user.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.organization.deleteMany({ where: { slug: { startsWith: `accept-invite-org-${runId}` } } });
  await adminDb.$disconnect();
});

async function seedInvite(role: "ADMIN" | "NUTRITIONIST" | "FRONT_DESK" = "NUTRITIONIST") {
  const rawToken = randomBytes(32).toString("hex");
  const invite = await adminDb.invite.create({
    data: {
      email: uniqueEmail("invitee"),
      role,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      organizationId: org.id,
    },
  });
  return { rawToken, invite };
}

describe("acceptInviteAction (REQ-010)", () => {
  it("creates a User and a Membership with the invited role, and marks the invite accepted", async () => {
    const { rawToken, invite } = await seedInvite("NUTRITIONIST");

    const result = await acceptInviteAction(rawToken, {
      name: "  Invited Nutritionist  ",
      password: "a-valid-password-123",
    });

    expect(result).toEqual({ success: true });

    const user = await adminDb.user.findUniqueOrThrow({ where: { email: invite.email } });
    expect(user.name).toBe("Invited Nutritionist");
    expect(user.passwordHash).not.toBe("a-valid-password-123");

    const membership = await adminDb.membership.findUniqueOrThrow({ where: { userId: user.id } });
    expect(membership.organizationId).toBe(org.id);
    expect(membership.role).toBe("NUTRITIONIST");

    const updatedInvite = await adminDb.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(updatedInvite.acceptedAt).not.toBeNull();
  });

  it("carries through the invited role for each Role value", async () => {
    for (const role of ["ADMIN", "NUTRITIONIST", "FRONT_DESK"] as const) {
      const { rawToken, invite } = await seedInvite(role);

      const result = await acceptInviteAction(rawToken, {
        name: `Invited ${role}`,
        password: "a-valid-password-123",
      });

      expect(result.success).toBe(true);
      const user = await adminDb.user.findUniqueOrThrow({ where: { email: invite.email } });
      const membership = await adminDb.membership.findUniqueOrThrow({ where: { userId: user.id } });
      expect(membership.role).toBe(role);
    }
  });

  it("rejects a password shorter than 12 characters and creates nothing", async () => {
    const { rawToken, invite } = await seedInvite();

    const result = await acceptInviteAction(rawToken, {
      name: "Invited Nutritionist",
      password: "too-short",
    });

    expect(result.success).toBe(false);
    const user = await adminDb.user.findUnique({ where: { email: invite.email } });
    expect(user).toBeNull();
    const unchangedInvite = await adminDb.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(unchangedInvite.acceptedAt).toBeNull();
  });
});

describe("acceptInviteAction (REQ-013)", () => {
  it("rejects an invalid token with the same generic error and creates nothing", async () => {
    const result = await acceptInviteAction(randomBytes(32).toString("hex"), {
      name: "Nobody",
      password: "a-valid-password-123",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("rejects an already-accepted invite and creates no second User", async () => {
    const { rawToken, invite } = await seedInvite();
    const first = await acceptInviteAction(rawToken, {
      name: "Invited Nutritionist",
      password: "a-valid-password-123",
    });
    expect(first.success).toBe(true);

    const second = await acceptInviteAction(rawToken, {
      name: "Second Attempt",
      password: "a-different-password-456",
    });
    expect(second.success).toBe(false);

    const users = await adminDb.user.count({ where: { email: invite.email } });
    expect(users).toBe(1);
  });
});
