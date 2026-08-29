import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { getBogotaDayRange } from "@/validation/appointments";

/**
 * T4.3, closes REQ-019, REQ-020, REQ-025, REQ-027. Seeds appointments
 * across two professionals with different statuses, then exercises the
 * calendar shell's rendering through the real UI -- same login pattern as
 * tests/e2e/patient-list.spec.ts.
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const email = `e2e-calendar-render-${runId}@example.test`;
const password = "a-valid-password-123";
let orgSlug: string;
let orgId: string;

// Reuses the exact production boundary function so this test can never
// drift out of sync with what the page itself considers "today" in
// America/Bogota, regardless of what time (UTC) the suite happens to run.
const { start: TODAY_BOGOTA_START_UTC } = getBogotaDayRange();

test.beforeAll(async () => {
  const passwordHash = await hash(password);
  const organization = await adminDb.organization.create({
    data: { name: `E2E Calendar Render ${runId}`, slug: `e2e-calendar-render-${runId}` },
  });
  orgSlug = organization.slug;
  orgId = organization.id;
  const user = await adminDb.user.create({
    data: { email, name: "Calendar Render E2E", passwordHash },
  });
  await adminDb.membership.create({ data: { userId: user.id, organizationId: orgId, role: "ADMIN" } });

  const userProf1 = await adminDb.user.create({
    data: { email: `e2e-calendar-render-prof1-${runId}@example.test`, name: "Dr. Alpha", passwordHash },
  });
  const membershipProf1 = await adminDb.membership.create({
    data: { userId: userProf1.id, organizationId: orgId, role: "NUTRITIONIST" },
  });
  const professional1 = await adminDb.professional.create({
    data: { membershipId: membershipProf1.id, organizationId: orgId, licenseNumber: `LIC-1-${runId}` },
  });

  const userProf2 = await adminDb.user.create({
    data: { email: `e2e-calendar-render-prof2-${runId}@example.test`, name: "Dr. Beta", passwordHash },
  });
  const membershipProf2 = await adminDb.membership.create({
    data: { userId: userProf2.id, organizationId: orgId, role: "NUTRITIONIST" },
  });
  const professional2 = await adminDb.professional.create({
    data: { membershipId: membershipProf2.id, organizationId: orgId, licenseNumber: `LIC-2-${runId}` },
  });

  const patient = await adminDb.patient.create({
    data: { organizationId: orgId, fullName: "Render Test Patient", phone: "+15550001111" },
  });

  const start = TODAY_BOGOTA_START_UTC;
  await adminDb.appointment.create({
    data: {
      organizationId: orgId,
      patientId: patient.id,
      professionalId: professional1.id,
      startAt: new Date(start.getTime() + 4 * 60 * 60_000),
      endAt: new Date(start.getTime() + 4.5 * 60 * 60_000),
      status: "SCHEDULED",
    },
  });
  await adminDb.appointment.create({
    data: {
      organizationId: orgId,
      patientId: patient.id,
      professionalId: professional2.id,
      startAt: new Date(start.getTime() + 6 * 60 * 60_000),
      endAt: new Date(start.getTime() + 6.5 * 60 * 60_000),
      status: "COMPLETED",
    },
  });
});

test.afterAll(async () => {
  await adminDb.appointment.deleteMany({ where: { organizationId: orgId } });
  await adminDb.patient.deleteMany({ where: { organizationId: orgId } });
  await adminDb.professional.deleteMany({ where: { organizationId: orgId } });
  await adminDb.membership.deleteMany({ where: { organizationId: orgId } });
  await adminDb.user.deleteMany({ where: { email: { contains: `e2e-calendar-render-${runId}` } } });
  await adminDb.organization.deleteMany({ where: { id: orgId } });
  await adminDb.$disconnect();
});

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("shows a column per professional with status-distinguishable appointments (REQ-019, REQ-020, REQ-025)", async ({
  page,
}) => {
  await login(page);
  await page.goto(`/${orgSlug}/appointments`);

  await expect(page.getByText("Dr. Alpha")).toBeVisible();
  await expect(page.getByText("Dr. Beta")).toBeVisible();

  const scheduledEvent = page.locator(".fc-event", { hasText: "Render Test Patient" }).first();
  await expect(scheduledEvent).toBeVisible();
  // REQ-025: status shown via icon + text label, not color alone.
  await expect(page.getByText("Scheduled")).toBeVisible();
  await expect(page.getByText("Completed")).toBeVisible();
});

test("shows an explicit empty state for a range with zero appointments (REQ-027)", async ({ page }) => {
  await login(page);
  // Navigate far enough forward that no fixture appointment falls in view.
  await page.goto(`/${orgSlug}/appointments`);
  for (let i = 0; i < 10; i++) {
    await page.getByRole("button", { name: "next" }).click();
  }
  await expect(page.getByTestId("calendar-empty-state")).toBeVisible();
});
