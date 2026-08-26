import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { adminDb } from "../helpers/admin-db";

/**
 * T3.3, closes REQ-009. Proves `acceptInviteAction` calls
 * `checkPasswordNotBreached` (src/validation/auth.ts, the same helper
 * `registerAction` already uses -- not reimplemented here) and rejects a
 * breached password before creating any record. REQ-005's actual HIBP
 * range-API format correctness is already covered by
 * src/validation/auth.test.ts; this only proves the accept flow wires the
 * check in and short-circuits on it, same mocking approach as
 * tests/integration/register-action.test.ts.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/validation/auth", async () => {
  const actual = await vi.importActual<typeof import("@/validation/auth")>("@/validation/auth");
  return {
    ...actual,
    checkPasswordNotBreached: vi.fn().mockResolvedValue(undefined),
  };
});

const { acceptInviteAction } = await import("@/server/actions/team");
const { checkPasswordNotBreached, BreachedPasswordError } = await import("@/validation/auth");
const mockCheckPasswordNotBreached = vi.mocked(checkPasswordNotBreached);

const runId = Date.now();
const createdEmails: string[] = [];
let emailCounter = 0;

function uniqueEmail(label: string) {
  emailCounter += 1;
  const email = `invite-hibp-${label}-${runId}-${emailCounter}@example.test`;
  createdEmails.push(email);
  return email;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

let org: { id: string };

beforeEach(async () => {
  vi.clearAllMocks();
  mockCheckPasswordNotBreached.mockResolvedValue(undefined);
  org = await adminDb.organization.create({
    data: { name: `Invite HIBP Org ${runId}`, slug: `invite-hibp-org-${runId}-${Math.random()}` },
  });
});

afterAll(async () => {
  await adminDb.membership.deleteMany({ where: { user: { email: { in: createdEmails } } } });
  await adminDb.invite.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.user.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.organization.deleteMany({ where: { slug: { startsWith: `invite-hibp-org-${runId}` } } });
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

describe("acceptInviteAction (REQ-009)", () => {
  it("rejects a breached password before creating any record", async () => {
    mockCheckPasswordNotBreached.mockRejectedValue(new BreachedPasswordError());
    const { rawToken, invite } = await seedInvite();

    const result = await acceptInviteAction(rawToken, {
      name: "Invited Nutritionist",
      password: "a-breached-password-123",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(mockCheckPasswordNotBreached).toHaveBeenCalledWith("a-breached-password-123");

    const user = await adminDb.user.findUnique({ where: { email: invite.email } });
    expect(user).toBeNull();
    const unchangedInvite = await adminDb.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(unchangedInvite.acceptedAt).toBeNull();
  });

  it("proceeds past the HIBP check for a password that passes it", async () => {
    mockCheckPasswordNotBreached.mockResolvedValue(undefined);
    const { rawToken, invite } = await seedInvite();

    const result = await acceptInviteAction(rawToken, {
      name: "Invited Nutritionist",
      password: "a-valid-password-123",
    });

    expect(result.success).toBe(true);
    const user = await adminDb.user.findUniqueOrThrow({ where: { email: invite.email } });
    expect(user.name).toBe("Invited Nutritionist");
  });
});
