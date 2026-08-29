import { describe, expect, it } from "vitest";
import { adminDb } from "../helpers/admin-db";
import {
  previewSeedOrganizationSlug,
  runPreviewSeed,
  usePreviewSeedTestLifecycle,
} from "../helpers/preview-seed";

describe("seed-preview-patients", () => {
  usePreviewSeedTestLifecycle();

  it("creates ten clearly synthetic patients with one archived record", async () => {
    await runPreviewSeed();

    const organization = await adminDb.organization.findUniqueOrThrow({
      where: { slug: previewSeedOrganizationSlug },
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
  }, 30_000);
});
