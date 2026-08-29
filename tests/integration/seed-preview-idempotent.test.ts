import { describe, expect, it } from "vitest";
import { adminDb } from "../helpers/admin-db";
import {
  previewSeedOrganizationSlug,
  runPreviewSeed,
  usePreviewSeedTestLifecycle,
} from "../helpers/preview-seed";

async function seedCounts() {
  const organization = await adminDb.organization.findUniqueOrThrow({
    where: { slug: previewSeedOrganizationSlug },
  });
  const [organizations, users, patients, appointments] = await Promise.all([
    adminDb.organization.count({ where: { slug: previewSeedOrganizationSlug } }),
    adminDb.user.count({ where: { membership: { organizationId: organization.id } } }),
    adminDb.patient.count({ where: { organizationId: organization.id } }),
    adminDb.appointment.count({ where: { organizationId: organization.id } }),
  ]);

  return { organizations, users, patients, appointments };
}

describe("seed-preview-idempotent", () => {
  usePreviewSeedTestLifecycle();

  it("replaces the seed organization without accumulating rows", async () => {
    await runPreviewSeed();
    const firstRun = await seedCounts();

    await runPreviewSeed();
    const secondRun = await seedCounts();

    expect(firstRun).toEqual({ organizations: 1, users: 4, patients: 10, appointments: 7 });
    expect(secondRun).toEqual(firstRun);
  }, 30_000);
});
