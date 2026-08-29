import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { getBogotaDayRange } from "@/validation/appointments";

/**
 * T4.6, closes REQ-014 through REQ-017 (UI surface; server enforcement
 * already closed by T3.2/T3.3). Confirms the detail sheet renders only the
 * transitions `allowedNextStatuses` allows, and that clicking one actually
 * updates the appointment through `transitionAppointmentStatusAction`.
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const email = `e2e-status-ui-${runId}@example.test`;
const password = "a-valid-password-123";
let orgSlug: string;
let orgId: string;
let scheduledAppointmentId: string;
let completedAppointmentId: string;

const { start: TODAY_START } = getBogotaDayRange();

test.beforeAll(async () => {
  const passwordHash = await hash(password);
  const organization = await adminDb.organization.create({
    data: { name: `E2E Status UI ${runId}`, slug: `e2e-status-ui-${runId}` },
  });
  orgSlug = organization.slug;
  orgId = organization.id;
  const user = await adminDb.user.create({ data: { email, name: "Status UI E2E", passwordHash } });
  await adminDb.membership.create({ data: { userId: user.id, organizationId: orgId, role: "ADMIN" } });

  const profUser = await adminDb.user.create({
    data: { email: `e2e-status-ui-prof-${runId}@example.test`, name: "Dr. Status", passwordHash },
  });
  const membership = await adminDb.membership.create({
    data: { userId: profUser.id, organizationId: orgId, role: "NUTRITIONIST" },
  });
  const professional = await adminDb.professional.create({
    data: { membershipId: membership.id, organizationId: orgId, licenseNumber: `LIC-${runId}` },
  });

  const patient = await adminDb.patient.create({
    data: { organizationId: orgId, fullName: "Status UI Patient", phone: "+15550001234" },
  });

  const scheduled = await adminDb.appointment.create({
    data: {
      organizationId: orgId,
      patientId: patient.id,
      professionalId: professional.id,
      startAt: new Date(TODAY_START.getTime() + 4 * 60 * 60_000),
      endAt: new Date(TODAY_START.getTime() + 4.5 * 60 * 60_000),
      status: "SCHEDULED",
    },
  });
  scheduledAppointmentId = scheduled.id;

  const completed = await adminDb.appointment.create({
    data: {
      organizationId: orgId,
      patientId: patient.id,
      professionalId: professional.id,
      startAt: new Date(TODAY_START.getTime() + 8 * 60 * 60_000),
      endAt: new Date(TODAY_START.getTime() + 8.5 * 60 * 60_000),
      status: "COMPLETED",
    },
  });
  completedAppointmentId = completed.id;
});

test.afterAll(async () => {
  await adminDb.appointment.deleteMany({ where: { organizationId: orgId } });
  await adminDb.patient.deleteMany({ where: { organizationId: orgId } });
  await adminDb.professional.deleteMany({ where: { organizationId: orgId } });
  await adminDb.membership.deleteMany({ where: { organizationId: orgId } });
  await adminDb.user.deleteMany({ where: { email: { contains: `e2e-status-ui-${runId}` } } });
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

test("shows only the allowed transitions and applies one on click (REQ-014, REQ-015, REQ-016)", async ({
  page,
}) => {
  await login(page);
  await page.goto(`/${orgSlug}/appointments`);

  await page.locator(".fc-event", { hasText: "Status UI Patient" }).first().click();
  await expect(page.getByRole("heading", { name: "Status UI Patient" })).toBeVisible();

  // REQ-014/015/016: from SCHEDULED, exactly Confirmed/Completed/Cancelled/No-show.
  const changeStatusSection = page.getByText("Change status").locator("..");
  await expect(changeStatusSection.getByRole("button", { name: "Confirmed" })).toBeVisible();
  await expect(changeStatusSection.getByRole("button", { name: "Completed" })).toBeVisible();
  await expect(changeStatusSection.getByRole("button", { name: "Cancelled" })).toBeVisible();
  await expect(changeStatusSection.getByRole("button", { name: "No-show" })).toBeVisible();

  await changeStatusSection.getByRole("button", { name: "Confirmed" }).click();

  // Wait for the round trip to complete: the status chip re-renders to
  // "Confirmed" and the button list drops it as a no-longer-valid target.
  await expect(page.getByTestId("appointment-status-chip")).toHaveText("Confirmed");
  await expect(changeStatusSection.getByRole("button", { name: "Confirmed" })).toHaveCount(0);

  const updated = await adminDb.appointment.findUniqueOrThrow({ where: { id: scheduledAppointmentId } });
  expect(updated.status).toBe("CONFIRMED");
});

test("shows no status-transition buttons for a terminal-status appointment (REQ-017)", async ({ page }) => {
  await login(page);
  await page.goto(`/${orgSlug}/appointments`);

  await page.locator(".fc-event", { hasText: "Status UI Patient" }).nth(1).click();
  await expect(page.getByTestId("appointment-status-chip")).toHaveText("Completed");
  await expect(page.getByText("Change status")).not.toBeVisible();

  const stillCompleted = await adminDb.appointment.findUniqueOrThrow({
    where: { id: completedAppointmentId },
  });
  expect(stillCompleted.status).toBe("COMPLETED");
});
