import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../helpers/admin-db";
import { acquirePreviewSeedTestLock } from "../helpers/preview-seed-lock";

const execFileAsync = promisify(execFile);
const organizationSlug = "preview-clinic";
let releaseLock: () => Promise<void>;
const userSummaries = [
  ["admin@preview.example.com", "ADMIN"],
  ["frontdesk@preview.example.com", "FRONT_DESK"],
  ["nutri1@preview.example.com", "NUTRITIONIST"],
  ["nutri2@preview.example.com", "NUTRITIONIST"],
] as const;

async function runSeed(databaseUrl = process.env.DATABASE_URL) {
  return execFileAsync(process.execPath, ["prisma/seed-preview.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl, SEED_PREVIEW_CONFIRM: "1" },
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

describe("seed-preview-logging", () => {
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

  it("logs only the preview slug and user email/role summaries", async () => {
    const { stdout } = await runSeed();
    const organization = await adminDb.organization.findUniqueOrThrow({
      where: { slug: organizationSlug },
    });
    const [users, patients, appointments] = await Promise.all([
      adminDb.user.findMany({ where: { membership: { organizationId: organization.id } } }),
      adminDb.patient.findMany({ where: { organizationId: organization.id } }),
      adminDb.appointment.findMany({ where: { organizationId: organization.id } }),
    ]);

    expect(stdout).toContain(organizationSlug);
    for (const [email, role] of userSummaries) {
      expect(stdout).toContain(`${email} — ${role}`);
    }
    expect(stdout).not.toContain("Preview1234!");
    for (const { passwordHash } of users) {
      expect(stdout).not.toContain(passwordHash);
    }

    const forbiddenValues = [
      ...patients.flatMap(({ fullName, phone, documentId, email, address }) => [
        fullName,
        phone,
        documentId,
        email,
        address,
      ]),
      ...appointments.flatMap(({ reason, notes }) => [reason, notes]),
    ].filter((value): value is string => Boolean(value));
    for (const value of forbiddenValues) {
      expect(stdout).not.toContain(value);
    }
  });

  it("exits non-zero when the database cannot be reached", async () => {
    await expect(runSeed("postgresql://invalid:invalid@127.0.0.1:1/unreachable")).rejects.toMatchObject({
      code: 1,
    });
  });
});
