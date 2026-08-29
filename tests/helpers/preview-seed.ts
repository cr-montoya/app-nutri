import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll } from "vitest";
import { adminDb } from "./admin-db";
import { acquirePreviewSeedTestLock } from "./preview-seed-lock";

const execFileAsync = promisify(execFile);
export const previewSeedOrganizationSlug = "preview-clinic";

export function runPreviewSeed(databaseUrl = process.env.DATABASE_URL) {
  return execFileAsync(process.execPath, ["prisma/seed-preview.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl, SEED_PREVIEW_CONFIRM: "1" },
  });
}

async function cleanPreviewSeed() {
  const organization = await adminDb.organization.findUnique({
    where: { slug: previewSeedOrganizationSlug },
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

export function usePreviewSeedTestLifecycle() {
  let releaseLock: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    releaseLock = await acquirePreviewSeedTestLock();
  }, 60_000);

  afterAll(async () => {
    try {
      await cleanPreviewSeed();
      await adminDb.$disconnect();
    } finally {
      await releaseLock?.();
    }
  }, 30_000);
}
