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

describe("seed-preview-appointments", () => {
  afterAll(async () => {
    await cleanSeed();
    await adminDb.$disconnect();
  });

  it("creates a valid schedule covering every status and both professionals", async () => {
    const beforeSeed = new Date();
    await runSeed();

    const organization = await adminDb.organization.findUniqueOrThrow({
      where: { slug: organizationSlug },
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
  });
});
