import { describe, expect, it } from "vitest";
import { adminDb } from "../helpers/admin-db";
import {
  previewSeedOrganizationSlug,
  runPreviewSeed,
  usePreviewSeedTestLifecycle,
} from "../helpers/preview-seed";
const userSummaries = [
  ["admin@preview.example.com", "ADMIN"],
  ["frontdesk@preview.example.com", "FRONT_DESK"],
  ["nutri1@preview.example.com", "NUTRITIONIST"],
  ["nutri2@preview.example.com", "NUTRITIONIST"],
] as const;

describe("seed-preview-logging", () => {
  usePreviewSeedTestLifecycle();

  it("logs only the preview slug and user email/role summaries", async () => {
    const { stdout } = await runPreviewSeed();
    const organization = await adminDb.organization.findUniqueOrThrow({
      where: { slug: previewSeedOrganizationSlug },
    });
    const [users, patients, appointments] = await Promise.all([
      adminDb.user.findMany({ where: { membership: { organizationId: organization.id } } }),
      adminDb.patient.findMany({ where: { organizationId: organization.id } }),
      adminDb.appointment.findMany({ where: { organizationId: organization.id } }),
    ]);

    expect(stdout).toContain(previewSeedOrganizationSlug);
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
  }, 30_000);

  it("exits non-zero when the database cannot be reached", async () => {
    await expect(runPreviewSeed("postgresql://invalid:invalid@127.0.0.1:1/unreachable")).rejects.toMatchObject({
      code: 1,
    });
  }, 30_000);
});
