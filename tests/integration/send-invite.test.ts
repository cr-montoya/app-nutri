import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Session } from "next-auth";
import { adminDb } from "../helpers/admin-db";

/**
 * T2.2, closes REQ-001, REQ-003, REQ-004, REQ-005, REQ-016. Runs against the
 * real local Postgres (Docker, standing in for a Neon dev branch) through
 * sendInviteAction's own withTenant calls, so RLS and the tenant-context
 * extension are actually exercised, not mocked.
 *
 * `@/lib/auth`'s `auth()` reads the Next.js request context (cookies via
 * next/headers), unavailable outside an actual request -- mocked here to
 * return a fixed session for each seeded membership, the same shape
 * src/lib/auth.ts's `session` callback produces (`{ user: { id },
 * organizationId }`), never a client-supplied role.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
const { auth } = await import("@/lib/auth");
// `auth` carries next-auth's overloaded signature (session-read vs.
// middleware-wrapping); this test only ever calls the session-read form, so
// it's narrowed to that single shape through `unknown` for mocking.
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

const runId = Date.now();
const createdEmails: string[] = [];
let emailCounter = 0;

function uniqueEmail(label: string) {
  emailCounter += 1;
  const email = `send-invite-${label}-${runId}-${emailCounter}@example.test`;
  createdEmails.push(email);
  return email;
}

let org: { id: string };
let adminUser: { id: string };
let nutritionistUser: { id: string };

async function seedMembership(label: string, role: "ADMIN" | "NUTRITIONIST" | "FRONT_DESK") {
  const user = await adminDb.user.create({
    data: { email: uniqueEmail(`actor-${label}`), passwordHash: "x", name: `Actor ${label}` },
  });
  await adminDb.membership.create({
    data: { userId: user.id, organizationId: org.id, role },
  });
  return user;
}

beforeEach(async () => {
  vi.clearAllMocks();
  org = await adminDb.organization.create({
    data: { name: `Send Invite Org ${runId}`, slug: `send-invite-org-${runId}-${Math.random()}` },
  });
  adminUser = await seedMembership("admin", "ADMIN");
});

afterAll(async () => {
  await adminDb.invite.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.membership.deleteMany({ where: { user: { email: { in: createdEmails } } } });
  await adminDb.user.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.organization.deleteMany({ where: { slug: { startsWith: `send-invite-org-${runId}` } } });
  await adminDb.$disconnect();
});

function asAdmin() {
  mockAuth.mockResolvedValue({
    user: { id: adminUser.id },
    organizationId: org.id,
  } as Session);
}

describe("sendInviteAction (REQ-001, REQ-005)", () => {
  it("creates a pending Invite with a hashed token and a 7-day expiry, and returns the raw token in inviteUrl", async () => {
    asAdmin();
    const { sendInviteAction } = await import("@/server/actions/team");

    const email = uniqueEmail("valid");
    const before = Date.now();
    const result = await sendInviteAction({ email, role: "NUTRITIONIST" });
    const after = Date.now();

    expect(result.success).toBe(true);
    expect(result.inviteUrl).toMatch(/^\/invite\/[0-9a-f]{64}$/);

    const rawToken = result.inviteUrl!.split("/invite/")[1];
    const expectedHash = createHash("sha256").update(rawToken).digest("hex");

    const invite = await adminDb.invite.findUniqueOrThrow({ where: { tokenHash: expectedHash } });
    expect(invite.email).toBe(email);
    expect(invite.role).toBe("NUTRITIONIST");
    expect(invite.organizationId).toBe(org.id);
    expect(invite.acceptedAt).toBeNull();
    expect(invite.revokedAt).toBeNull();

    const expiryMs = invite.expiresAt.getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(expiryMs).toBeGreaterThanOrEqual(before + sevenDays - 5000);
    expect(expiryMs).toBeLessThanOrEqual(after + sevenDays + 5000);
  });
});

describe("sendInviteAction (REQ-003)", () => {
  it("rejects an invite for an email that already has a User account anywhere", async () => {
    asAdmin();
    const { sendInviteAction } = await import("@/server/actions/team");

    const email = uniqueEmail("existing-user");
    await adminDb.user.create({ data: { email, passwordHash: "x", name: "Existing" } });

    const result = await sendInviteAction({ email, role: "FRONT_DESK" });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    const invites = await adminDb.invite.count({ where: { email } });
    expect(invites).toBe(0);
  });
});

describe("sendInviteAction (REQ-004)", () => {
  it("rejects a second invite while a pending one already exists for the same email and org", async () => {
    asAdmin();
    const { sendInviteAction } = await import("@/server/actions/team");

    const email = uniqueEmail("dup-pending");
    const first = await sendInviteAction({ email, role: "NUTRITIONIST" });
    expect(first.success).toBe(true);

    const second = await sendInviteAction({ email, role: "FRONT_DESK" });
    expect(second.success).toBe(false);

    const invites = await adminDb.invite.count({ where: { email } });
    expect(invites).toBe(1);
  });

  it("allows a new invite once the previous one for the same email was revoked", async () => {
    asAdmin();
    const { sendInviteAction } = await import("@/server/actions/team");

    const email = uniqueEmail("revoked-then-new");
    const first = await sendInviteAction({ email, role: "NUTRITIONIST" });
    expect(first.success).toBe(true);

    await adminDb.invite.updateMany({ where: { email }, data: { revokedAt: new Date() } });

    const second = await sendInviteAction({ email, role: "FRONT_DESK" });
    expect(second.success).toBe(true);

    const invites = await adminDb.invite.count({ where: { email } });
    expect(invites).toBe(2);
  });
});

describe("sendInviteAction (REQ-016)", () => {
  it("rejects a NUTRITIONIST attempting to send an invite", async () => {
    nutritionistUser = await seedMembership("nutritionist", "NUTRITIONIST");
    mockAuth.mockResolvedValue({
      user: { id: nutritionistUser.id },
      organizationId: org.id,
    } as Session);
    const { sendInviteAction } = await import("@/server/actions/team");

    const email = uniqueEmail("blocked-by-role");
    const result = await sendInviteAction({ email, role: "FRONT_DESK" });

    expect(result.success).toBe(false);
    const invites = await adminDb.invite.count({ where: { email } });
    expect(invites).toBe(0);
  });

  it("rejects an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null);
    const { sendInviteAction } = await import("@/server/actions/team");

    const email = uniqueEmail("no-session");
    const result = await sendInviteAction({ email, role: "ADMIN" });

    expect(result.success).toBe(false);
    const invites = await adminDb.invite.count({ where: { email } });
    expect(invites).toBe(0);
  });
});
