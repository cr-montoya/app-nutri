import { describe, expect, it } from "vitest";
import { adminDb } from "../helpers/admin-db";
import {
  previewSeedOrganizationSlug,
  runPreviewSeed,
  usePreviewSeedTestLifecycle,
} from "../helpers/preview-seed";

describe("seed-preview-appointments", () => {
  usePreviewSeedTestLifecycle();

  it("creates a valid schedule covering every status and both professionals", async () => {
    const beforeSeed = new Date();
    await runPreviewSeed();

    const organization = await adminDb.organization.findUniqueOrThrow({
      where: { slug: previewSeedOrganizationSlug },
    });
    const appointments = await adminDb.appointment.findMany({
      where: { organizationId: organization.id },
      include: { patient: true },
    });

    expect(appointments).toHaveLength(7);
    expect(new Set(appointments.map(({ status }) => status))).toEqual(
      new Set(["SCHEDULED", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]),
    );
    expect(new Set(appointments.map(({ professionalId }) => professionalId))).toHaveLength(2);
    expect(appointments.every(({ patient }) => patient.documentId !== "PREVIEW-010")).toBe(true);
    expect(
      appointments
        .filter(({ status }) => status === "SCHEDULED" || status === "CONFIRMED")
        .every(({ startAt }) => startAt > beforeSeed),
    ).toBe(true);
    expect(
      appointments
        .filter(({ status }) => !["SCHEDULED", "CONFIRMED"].includes(status))
        .every(({ startAt }) => startAt < beforeSeed),
    ).toBe(true);
    expect(
      appointments.every(({ startAt, endAt }) => {
        const minutes = (endAt.getTime() - startAt.getTime()) / 60_000;
        return minutes >= 5 && minutes <= 480;
      }),
    ).toBe(true);
  }, 30_000);
});
