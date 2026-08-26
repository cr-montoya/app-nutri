import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { adminDb } from "../helpers/admin-db";

/**
 * T4.1, closes REQ-017, REQ-018, REQ-019. Runs against the real local
 * Postgres through updateProfessionalProfileAction's own withTenant call, so
 * RLS and the tenant-context extension are actually exercised, not mocked.
 * Same auth-mocking approach as tests/integration/send-invite.test.ts.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
const { auth } = await import("@/lib/auth");
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

const runId = Date.now();
const createdEmails: string[] = [];
let emailCounter = 0;

function uniqueEmail(label: string) {
  emailCounter += 1;
  const email = `professional-profile-${label}-${runId}-${emailCounter}@example.test`;
  createdEmails.push(email);
  return email;
}

let org: { id: string };

async function seedMembership(label: string, role: "ADMIN" | "NUTRITIONIST" | "FRONT_DESK") {
  const user = await adminDb.user.create({
    data: { email: uniqueEmail(`actor-${label}`), passwordHash: "x", name: `Actor ${label}` },
  });
  const membership = await adminDb.membership.create({
    data: { userId: user.id, organizationId: org.id, role },
  });
  return { user, membership };
}

function asUser(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId }, organizationId: org.id } as Session);
}

beforeEach(async () => {
  vi.clearAllMocks();
  org = await adminDb.organization.create({
    data: {
      name: `Professional Profile Org ${runId}`,
      slug: `professional-profile-org-${runId}-${Math.random()}`,
    },
  });
});

afterAll(async () => {
  await adminDb.professional.deleteMany({
    where: { membership: { user: { email: { in: createdEmails } } } },
  });
  await adminDb.membership.deleteMany({ where: { user: { email: { in: createdEmails } } } });
  await adminDb.user.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.organization.deleteMany({
    where: { slug: { startsWith: `professional-profile-org-${runId}` } },
  });
  await adminDb.$disconnect();
});

describe("updateProfessionalProfileAction (REQ-017)", () => {
  it("creates a Professional linked to the caller's own membership on first submission", async () => {
    const { user, membership } = await seedMembership("admin", "ADMIN");
    asUser(user.id);
    const { updateProfessionalProfileAction } = await import("@/server/actions/team");

    const result = await updateProfessionalProfileAction({
      licenseNumber: "LIC-001",
      specialty: "Sports nutrition",
    });

    expect(result.success).toBe(true);
    const professional = await adminDb.professional.findUniqueOrThrow({
      where: { membershipId: membership.id },
    });
    expect(professional.licenseNumber).toBe("LIC-001");
    expect(professional.specialty).toBe("Sports nutrition");
    expect(professional.organizationId).toBe(org.id);
  });

  it("updates the existing Professional on a second submission (upsert), for a NUTRITIONIST too", async () => {
    const { user, membership } = await seedMembership("nutritionist", "NUTRITIONIST");
    asUser(user.id);
    const { updateProfessionalProfileAction } = await import("@/server/actions/team");

    const first = await updateProfessionalProfileAction({ licenseNumber: "LIC-100" });
    expect(first.success).toBe(true);

    const second = await updateProfessionalProfileAction({
      licenseNumber: "LIC-200",
      specialty: "Pediatric nutrition",
    });
    expect(second.success).toBe(true);

    const rows = await adminDb.professional.findMany({ where: { membershipId: membership.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].licenseNumber).toBe("LIC-200");
    expect(rows[0].specialty).toBe("Pediatric nutrition");
  });
});

describe("updateProfessionalProfileAction (REQ-018)", () => {
  it("rejects a FRONT_DESK membership and creates no Professional row", async () => {
    const { user, membership } = await seedMembership("front-desk", "FRONT_DESK");
    asUser(user.id);
    const { updateProfessionalProfileAction } = await import("@/server/actions/team");

    const result = await updateProfessionalProfileAction({ licenseNumber: "LIC-999" });

    expect(result.success).toBe(false);
    const count = await adminDb.professional.count({ where: { membershipId: membership.id } });
    expect(count).toBe(0);
  });

  it("rejects an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null);
    const { updateProfessionalProfileAction } = await import("@/server/actions/team");

    const result = await updateProfessionalProfileAction({ licenseNumber: "LIC-000" });

    expect(result.success).toBe(false);
  });
});

describe("updateProfessionalProfileAction (REQ-019)", () => {
  it("never affects another membership's Professional -- the action takes no id, so it structurally can only ever touch the caller's own row", async () => {
    const admin = await seedMembership("admin-isolation", "ADMIN");
    const other = await seedMembership("nutritionist-isolation", "NUTRITIONIST");

    // Seed the other membership's Professional first, with known values, so
    // we can prove it's untouched after the admin acts.
    await adminDb.professional.create({
      data: {
        membershipId: other.membership.id,
        organizationId: org.id,
        licenseNumber: "OTHER-LIC",
        specialty: "Other specialty",
      },
    });

    asUser(admin.user.id);
    const { updateProfessionalProfileAction } = await import("@/server/actions/team");

    // updateProfessionalProfileSchema (T4.1) has no id field of any kind, so
    // there is no input shape that could target `other`'s profile even if a
    // caller tried; this call can only ever create/update the caller's own
    // row (admin.membership.id). This is the structural proof REQ-019
    // requires -- see src/validation/team.ts's updateProfessionalProfileSchema
    // doc comment for why the schema was designed this way.
    const result = await updateProfessionalProfileAction({
      licenseNumber: "ADMIN-LIC",
      specialty: "Admin specialty",
    });
    expect(result.success).toBe(true);

    const adminProfessional = await adminDb.professional.findUniqueOrThrow({
      where: { membershipId: admin.membership.id },
    });
    expect(adminProfessional.licenseNumber).toBe("ADMIN-LIC");

    const otherProfessional = await adminDb.professional.findUniqueOrThrow({
      where: { membershipId: other.membership.id },
    });
    expect(otherProfessional.licenseNumber).toBe("OTHER-LIC");
    expect(otherProfessional.specialty).toBe("Other specialty");
  });
});
