import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { adminDb } from "../helpers/admin-db";

/**
 * T3.5, closes REQ-011. Two invite-acceptance attempts for the same email
 * race via `Promise.all`. REQ-011 is specifically about two invites for the
 * *same email* racing (not the same invite twice -- REQ-010 already makes a
 * second accept of the same invite trivially fail once the first one sets
 * `acceptedAt`, which isn't a genuine race on the email-uniqueness
 * mechanism this task closes). Two separate, independently pending `Invite`
 * rows are seeded for the same email -- a state `sendInviteAction`'s own
 * REQ-004 duplicate-pending check wouldn't produce through the UI, but
 * valid at the database level and exactly what's needed to exercise the
 * `User.email` unique constraint (REQ-011's actual enforcement mechanism)
 * under real concurrency, not the `acceptedAt` conditional update REQ-010
 * already covers.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/validation/auth", async () => {
  const actual = await vi.importActual<typeof import("@/validation/auth")>("@/validation/auth");
  return { ...actual, checkPasswordNotBreached: vi.fn().mockResolvedValue(undefined) };
});

const { acceptInviteAction } = await import("@/server/actions/team");

const runId = Date.now();
const createdEmails: string[] = [];

function raceEmail() {
  const email = `accept-invite-race-${runId}@example.test`;
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
    data: { name: `Accept Invite Race Org ${runId}`, slug: `accept-invite-race-org-${runId}-${Math.random()}` },
  });
});

afterAll(async () => {
  await adminDb.membership.deleteMany({ where: { user: { email: { in: createdEmails } } } });
  await adminDb.invite.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.user.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.organization.deleteMany({
    where: { slug: { startsWith: `accept-invite-race-org-${runId}` } },
  });
  await adminDb.$disconnect();
});

async function seedInvite(email: string) {
  const rawToken = randomBytes(32).toString("hex");
  const invite = await adminDb.invite.create({
    data: {
      email,
      role: "NUTRITIONIST",
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      organizationId: org.id,
    },
  });
  return { rawToken, invite };
}

describe("acceptInviteAction concurrency (REQ-011)", () => {
  it("lets exactly one of two racing accepts for the same email succeed, no duplicate User", async () => {
    const email = raceEmail();
    const [{ rawToken: tokenA }, { rawToken: tokenB }] = await Promise.all([
      seedInvite(email),
      seedInvite(email),
    ]);

    const [resultA, resultB] = await Promise.all([
      acceptInviteAction(tokenA, { name: "Racer A", password: "a-valid-password-123" }),
      acceptInviteAction(tokenB, { name: "Racer B", password: "a-different-password-456" }),
    ]);

    const successes = [resultA, resultB].filter((r) => r.success);
    const failures = [resultA, resultB].filter((r) => !r.success);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].error).toBeTruthy();

    const users = await adminDb.user.findMany({ where: { email } });
    expect(users).toHaveLength(1);

    const memberships = await adminDb.membership.count({ where: { user: { email } } });
    expect(memberships).toBe(1);
  });
});
