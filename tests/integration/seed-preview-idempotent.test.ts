import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { adminDb } from "../helpers/admin-db";

const execFileAsync = promisify(execFile);
const organizationSlug = "preview-clinic";

async function runSeed() {
  await execFileAsync(process.execPath, ["prisma/seed-preview.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, SEED_PREVIEW_CONFIRM: "1" },
  });
}

async function seedCounts() {
  const organization = await adminDb.organization.findUniqueOrThrow({
    where: { slug: organizationSlug },
  });
  const [organizations, users, patients, appointments] = await Promise.all([
    adminDb.organization.count({ where: { slug: organizationSlug } }),
    adminDb.user.count({ where: { membership: { organizationId: organization.id } } }),
    adminDb.patient.count({ where: { organizationId: organization.id } }),
    adminDb.appointment.count({ where: { organizationId: organization.id } }),
  ]);

  return { organizations, users, patients, appointments };
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

describe("seed-preview-idempotent", () => {
  afterAll(async () => {
    await cleanSeed();
    await adminDb.$disconnect();
  });

  it("replaces the seed organization without accumulating rows", async () => {
    await runSeed();
    const firstRun = await seedCounts();

    await runSeed();
    const secondRun = await seedCounts();

    expect(firstRun).toEqual({ organizations: 1, users: 4, patients: 10, appointments: 7 });
    expect(secondRun).toEqual(firstRun);
  });
});
