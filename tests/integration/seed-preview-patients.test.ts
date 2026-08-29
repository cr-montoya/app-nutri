import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../helpers/admin-db";
import { acquirePreviewSeedTestLock } from "../helpers/preview-seed-lock";

const execFileAsync = promisify(execFile);
const organizationSlug = "preview-clinic";
let releaseLock: () => Promise<void>;

async function runSeed() {
  await execFileAsync(process.execPath, ["prisma/seed-preview.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, SEED_PREVIEW_CONFIRM: "1" },
  });
}

async function cleanSeed() {
  const organization = await adminDb.organization.findUnique({
    where: { slug: organizationSlug },
    include: { memberships: { select: { userId: true } } },
  });
  if (!organization) return;

  const userIds = organization.memberships.map(({ userId }) => userId);
  await adminDb.$transaction([
    adminDb.appointment.deleteMany({ where: { organizationId: organization.id } }),
    adminDb.patient.deleteMany({ where: { organizationId: organization.id } }),
    adminDb.professional.deleteMany({ where: { organizationId: organization.id } }),
    adminDb.membership.deleteMany({ where: { organizationId: organization.id } }),
    adminDb.user.deleteMany({ where: { id: { in: userIds } } }),
    adminDb.organization.delete({ where: { id: organization.id } }),
  ]);
}

describe("seed-preview-patients", () => {
  beforeAll(async () => {
    releaseLock = await acquirePreviewSeedTestLock();
  });

  afterAll(async () => {
    try {
      await cleanSeed();
      await adminDb.$disconnect();
    } finally {
      await releaseLock();
    }
  });

  it("creates ten clearly synthetic patients with one archived record", async () => {
    await runSeed();

    const organization = await adminDb.organization.findUniqueOrThrow({
      where: { slug: organizationSlug },
    });
    const patients = await adminDb.patient.findMany({
      where: { organizationId: organization.id },
      orderBy: { fullName: "asc" },
    });

    expect(patients).toHaveLength(10);
    expect(patients.filter(({ archivedAt }) => archivedAt !== null)).toHaveLength(1);
    expect(patients.every(({ fullName }) => fullName.startsWith("Test Patient"))).toBe(true);
    expect(patients.every(({ phone }) => phone.startsWith("+1555"))).toBe(true);
    expect(patients.every(({ email }) => email?.endsWith("@example.com"))).toBe(true);
  });
});
