import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAction } from "@/server/actions/auth";
import { slugify } from "@/server/services/organization-slug";
import { adminDb } from "../helpers/admin-db";

/**
 * T4.2, closes REQ-001, REQ-002, REQ-007, REQ-020. Runs against the real
 * local Postgres (Docker, standing in for a Neon dev branch) so the
 * atomic transaction and the `User.email` unique constraint are exercised
 * for real, not mocked.
 */

vi.mock("@/validation/auth", async () => {
  const actual = await vi.importActual<typeof import("@/validation/auth")>("@/validation/auth");
  return {
    ...actual,
    // Skip the live HIBP network call in tests; REQ-005 itself is covered
    // by src/validation/auth.test.ts.
    checkPasswordNotBreached: vi.fn().mockResolvedValue(undefined),
  };
});

const runId = Date.now();
const createdEmails: string[] = [];
const createdSlugPrefixes = [`register-action-${runId}`];

function uniqueEmail(label: string) {
  const email = `register-action-${label}-${runId}@example.test`;
  createdEmails.push(email);
  return email;
}

afterAll(async () => {
  await adminDb.membership.deleteMany({
    where: { user: { email: { in: createdEmails } } },
  });
  await adminDb.user.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.organization.deleteMany({
    where: { slug: { startsWith: createdSlugPrefixes[0] } },
  });
  await adminDb.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerAction (REQ-001, REQ-002, REQ-020)", () => {
  it("creates User, Organization, and an ADMIN Membership atomically", async () => {
    const email = uniqueEmail("basic");
    const result = await registerAction({
      email,
      name: "Nutri One",
      password: "a-valid-password-123",
      organizationName: `Register Action ${runId} Basic`,
    });

    expect(result).toEqual({ success: true });

    const user = await adminDb.user.findUniqueOrThrow({ where: { email } });
    expect(user.name).toBe("Nutri One");
    expect(user.passwordHash).not.toBe("a-valid-password-123");

    const membership = await adminDb.membership.findUniqueOrThrow({
      where: { userId: user.id },
      include: { organization: true },
    });
    expect(membership.role).toBe("ADMIN");
    expect(membership.organization.name).toBe(`Register Action ${runId} Basic`);
  });

  it("rejects a second registration with the same email and creates nothing (REQ-002)", async () => {
    const email = uniqueEmail("dup");
    const first = await registerAction({
      email,
      name: "First User",
      password: "a-valid-password-123",
      organizationName: `Register Action ${runId} Dup First`,
    });
    expect(first.success).toBe(true);

    const usersBefore = await adminDb.user.count({ where: { email } });
    expect(usersBefore).toBe(1);

    const second = await registerAction({
      email,
      name: "Second User",
      password: "a-different-password-456",
      organizationName: `Register Action ${runId} Dup Second`,
    });

    expect(second.success).toBe(false);
    expect(second.error).toBeTruthy();

    // Still only one User row for this email, and no orphaned org from the
    // failed attempt.
    const usersAfter = await adminDb.user.count({ where: { email } });
    expect(usersAfter).toBe(1);
    const orphanOrg = await adminDb.organization.findUnique({
      where: { slug: slugify(`Register Action ${runId} Dup Second`) },
    });
    expect(orphanOrg).toBeNull();
  });

  it("rejects invalid input before creating any record", async () => {
    const email = uniqueEmail("invalid");
    const result = await registerAction({
      email,
      name: "",
      password: "too-short",
      organizationName: "x",
    });

    expect(result.success).toBe(false);
    const user = await adminDb.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });
});

describe("registerAction slug disambiguation (REQ-007)", () => {
  it("appends -2, -3 when the organization name's slug collides", async () => {
    const orgName = `Register Action ${runId} Slug Collide`;
    const baseSlug = slugify(orgName);

    const first = await registerAction({
      email: uniqueEmail("slug-1"),
      name: "User One",
      password: "a-valid-password-123",
      organizationName: orgName,
    });
    const second = await registerAction({
      email: uniqueEmail("slug-2"),
      name: "User Two",
      password: "a-valid-password-123",
      organizationName: orgName,
    });
    const third = await registerAction({
      email: uniqueEmail("slug-3"),
      name: "User Three",
      password: "a-valid-password-123",
      organizationName: orgName,
    });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(third.success).toBe(true);

    const orgs = await adminDb.organization.findMany({
      where: { name: orgName },
      orderBy: { createdAt: "asc" },
    });
    expect(orgs.map((o) => o.slug)).toEqual([baseSlug, `${baseSlug}-2`, `${baseSlug}-3`]);
  });
});
