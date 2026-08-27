import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { getBogotaDayRange } from "@/validation/appointments";

/**
 * T4.5, closes REQ-011, REQ-024, REQ-026 (form path). Opens the detail
 * sheet by clicking a calendar event, edits it through the non-drag form
 * (REQ-024), and confirms both a successful save and a rejected one
 * (double-booking) surface inline (REQ-026) without a full navigation.
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const email = `e2e-appointment-edit-${runId}@example.test`;
const password = "a-valid-password-123";
let orgSlug: string;
let orgId: string;
let appointmentId: string;
let conflictingAppointmentId: string;

const { start: TODAY_START } = getBogotaDayRange();

test.beforeAll(async () => {
  const passwordHash = await hash(password);
  const organization = await adminDb.organization.create({
    data: { name: `E2E Appointment Edit ${runId}`, slug: `e2e-appointment-edit-${runId}` },
  });
  orgSlug = organization.slug;
  orgId = organization.id;
  const user = await adminDb.user.create({ data: { email, name: "Edit E2E", passwordHash } });
  await adminDb.membership.create({ data: { userId: user.id, organizationId: orgId, role: "ADMIN" } });

  const profUser = await adminDb.user.create({
    data: { email: `e2e-appointment-edit-prof-${runId}@example.test`, name: "Dr. Editor", passwordHash },
  });
  const membership = await adminDb.membership.create({
    data: { userId: profUser.id, organizationId: orgId, role: "NUTRITIONIST" },
  });
  const professional = await adminDb.professional.create({
    data: { membershipId: membership.id, organizationId: orgId, licenseNumber: `LIC-${runId}` },
  });
  const patient = await adminDb.patient.create({
    data: { organizationId: orgId, fullName: "Edit Sheet Patient", phone: "+15550009999" },
  });

  const appointment = await adminDb.appointment.create({
    data: {
      organizationId: orgId,
      patientId: patient.id,
      professionalId: professional.id,
      startAt: new Date(TODAY_START.getTime() + 4 * 60 * 60_000),
      endAt: new Date(TODAY_START.getTime() + 4.5 * 60 * 60_000),
      status: "SCHEDULED",
    },
  });
  appointmentId = appointment.id;

  const conflicting = await adminDb.appointment.create({
    data: {
      organizationId: orgId,
      patientId: patient.id,
      professionalId: professional.id,
      startAt: new Date(TODAY_START.getTime() + 8 * 60 * 60_000),
      endAt: new Date(TODAY_START.getTime() + 8.5 * 60 * 60_000),
      status: "SCHEDULED",
    },
  });
  conflictingAppointmentId = conflicting.id;
});

test.afterAll(async () => {
  await adminDb.appointment.deleteMany({ where: { organizationId: orgId } });
  await adminDb.patient.deleteMany({ where: { organizationId: orgId } });
  await adminDb.professional.deleteMany({ where: { organizationId: orgId } });
  await adminDb.membership.deleteMany({ where: { organizationId: orgId } });
  await adminDb.user.deleteMany({ where: { email: { contains: `e2e-appointment-edit-${runId}` } } });
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

test("edits an appointment's reason through the detail sheet's non-drag form", async ({ page }) => {
  await login(page);
  await page.goto(`/${orgSlug}/appointments`);

  await page.locator(".fc-event", { hasText: "Edit Sheet Patient" }).first().click();
  await expect(page.getByRole("heading", { name: "Edit Sheet Patient" })).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Reason").fill("Follow-up consultation");
  await page.getByRole("button", { name: /save changes/i }).click();

  await expect(page.getByText("Reason: Follow-up consultation")).toBeVisible();

  const updated = await adminDb.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  expect(updated.reason).toBe("Follow-up consultation");
});

test("opens the detail sheet via keyboard activation of a focused calendar event (REQ-024, WCAG 2.5.7)", async ({ page }) => {
  await login(page);
  await page.goto(`/${orgSlug}/appointments`);

  const eventChip = page.locator(".fc-event", { hasText: "Edit Sheet Patient" }).first();
  await expect(eventChip).toBeVisible();

  // Focus the event chip directly (calendar.tsx's eventDidMount sets
  // tabindex="0"/role="button" on it) rather than repeatedly pressing Tab
  // from the top of the page, which would be brittle against unrelated
  // focus-order changes elsewhere on the page.
  await eventChip.focus();
  await expect(eventChip).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Edit Sheet Patient" })).toBeVisible();

  // Close and repeat with Space, proving both activation keys work, not
  // just Enter.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Edit Sheet Patient" })).not.toBeVisible();

  await eventChip.focus();
  await page.keyboard.press(" ");
  await expect(page.getByRole("heading", { name: "Edit Sheet Patient" })).toBeVisible();
});

test("shows the specific rejection reason inline for a double-booking conflict (REQ-026)", async ({ page }) => {
  await login(page);
  await page.goto(`/${orgSlug}/appointments`);

  await page.locator(".fc-event", { hasText: "Edit Sheet Patient" }).first().click();
  await page.getByRole("button", { name: "Edit" }).click();

  // Reschedule the first appointment onto the second's slot.
  const conflictingStart = await adminDb.appointment.findUniqueOrThrow({
    where: { id: conflictingAppointmentId },
  });
  const bogotaHour = (conflictingStart.startAt.getUTCHours() - 5 + 24) % 24;
  await page.getByLabel("Date").fill(conflictingStart.startAt.toISOString().slice(0, 10));
  await page.getByLabel("Time").fill(`${String(bogotaHour).padStart(2, "0")}:00`);
  await page.getByRole("button", { name: /save changes/i }).click();

  await expect(page.getByTestId("appointment-form-error")).toBeVisible();

  const unchanged = await adminDb.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  expect(unchanged.startAt.getTime()).toBe(TODAY_START.getTime() + 4 * 60 * 60_000);
});
