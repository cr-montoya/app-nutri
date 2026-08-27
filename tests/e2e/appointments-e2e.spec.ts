import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { formatBogotaDateAndTime } from "@/validation/appointments";

/**
 * T5.1: end-to-end proof, as FRONT_DESK, confirming REQ-001 through
 * REQ-027 hold together in the real UI (REQ-028 is covered separately by
 * tests/e2e/appointment-touch-targets.spec.ts, per design.md's
 * `## Deviations`). A tall viewport, same reason as
 * calendar-drag-reschedule.spec.ts: the full-day grid can exceed the
 * default 720px viewport height, which breaks drag-drop hit-testing.
 *
 * Appointment times are computed relative to "now" (guaranteed to pass
 * REQ-004's past-time check regardless of when the suite runs), not fixed
 * clock times -- and, since that can land on Bogota's next calendar day
 * relative to the page's default "today" view, the test advances one day
 * when it detects that happened, the same fix
 * tests/e2e/appointment-rbac-open.spec.ts already established.
 */
test.use({ viewport: { width: 1280, height: 1400 } });

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const email = `e2e-appointments-full-${runId}@example.test`;
const password = "a-valid-password-123";
let orgSlug: string;
let orgId: string;
let professionalId: string;
let patientId: string;

test.beforeAll(async () => {
  const passwordHash = await hash(password);
  const organization = await adminDb.organization.create({
    data: { name: `E2E Appointments Full ${runId}`, slug: `e2e-appointments-full-${runId}` },
  });
  orgSlug = organization.slug;
  orgId = organization.id;

  const user = await adminDb.user.create({
    data: { email, name: "Front Desk E2E", passwordHash },
  });
  await adminDb.membership.create({ data: { userId: user.id, organizationId: orgId, role: "FRONT_DESK" } });

  const profUser = await adminDb.user.create({
    data: { email: `e2e-appointments-full-prof-${runId}@example.test`, name: "Dr. Full E2E", passwordHash },
  });
  const membership = await adminDb.membership.create({
    data: { userId: profUser.id, organizationId: orgId, role: "NUTRITIONIST" },
  });
  const professional = await adminDb.professional.create({
    data: { membershipId: membership.id, organizationId: orgId, licenseNumber: `LIC-${runId}` },
  });
  professionalId = professional.id;

  const patient = await adminDb.patient.create({
    data: { organizationId: orgId, fullName: "Full E2E Patient", phone: "+15550001111" },
  });
  patientId = patient.id;
});

test.afterAll(async () => {
  await adminDb.appointment.deleteMany({ where: { organizationId: orgId } });
  await adminDb.patient.deleteMany({ where: { organizationId: orgId } });
  await adminDb.professional.deleteMany({ where: { organizationId: orgId } });
  await adminDb.membership.deleteMany({ where: { organizationId: orgId } });
  await adminDb.user.deleteMany({ where: { email: { contains: `e2e-appointments-full-${runId}` } } });
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

/** Advances the calendar one day if `targetDate` isn't Bogota "today". */
async function ensureOnDate(page: import("@playwright/test").Page, targetDate: string) {
  const todayBogotaDate = formatBogotaDateAndTime(new Date()).date;
  if (targetDate !== todayBogotaDate) {
    await page.getByRole("button", { name: "next" }).click();
  }
}

test("FRONT_DESK: full appointment lifecycle end to end", async ({ page }) => {
  await login(page);

  // Both close together (30/90 min out) so they land on the same Bogota
  // calendar day as each other almost always, even on the rare run where
  // that day differs from "today" -- only one `ensureOnDate` check is
  // needed per creation as a result.
  const firstSlot = formatBogotaDateAndTime(new Date(Date.now() + 30 * 60_000));
  const secondSlot = formatBogotaDateAndTime(new Date(Date.now() + 90 * 60_000));

  // Empty day shows the explicit empty state (REQ-027).
  await page.goto(`/${orgSlug}/appointments`);
  await ensureOnDate(page, firstSlot.date);
  await expect(page.getByTestId("calendar-empty-state")).toBeVisible();

  // Schedule an appointment (REQ-001).
  await page.goto(`/${orgSlug}/appointments/new`);
  await page.getByLabel("Patient").selectOption(patientId);
  await page.getByLabel("Professional").selectOption(professionalId);
  await page.getByLabel("Date").fill(firstSlot.date);
  await page.getByLabel("Time").fill(firstSlot.time);
  await page.getByRole("button", { name: /create appointment/i }).click();
  await expect(page).toHaveURL((url) => url.pathname === `/${orgSlug}/appointments`);
  await ensureOnDate(page, firstSlot.date);

  // The empty state is gone now that an appointment exists.
  await expect(page.getByTestId("calendar-empty-state")).not.toBeVisible();
  await expect(page.locator(".fc-event", { hasText: "Full E2E Patient" })).toBeVisible();
  // REQ-025: status shown via icon + text label, not color alone.
  await expect(page.getByText("Scheduled")).toBeVisible();

  // A second, overlapping appointment for the same professional is
  // rejected with a visible reason (REQ-006).
  await page.goto(`/${orgSlug}/appointments/new`);
  await page.getByLabel("Patient").selectOption(patientId);
  await page.getByLabel("Professional").selectOption(professionalId);
  await page.getByLabel("Date").fill(firstSlot.date);
  await page.getByLabel("Time").fill(firstSlot.time);
  await page.getByRole("button", { name: /create appointment/i }).click();
  await expect(page.getByTestId("appointment-form-error")).toBeVisible();
  await expect(page).toHaveURL(`/${orgSlug}/appointments/new`);

  // A second, non-conflicting appointment, to later cancel.
  await page.getByLabel("Date").fill(secondSlot.date);
  await page.getByLabel("Time").fill(secondSlot.time);
  await page.getByRole("button", { name: /create appointment/i }).click();
  await expect(page).toHaveURL((url) => url.pathname === `/${orgSlug}/appointments`);
  await ensureOnDate(page, secondSlot.date);

  // First appointment: SCHEDULED -> CONFIRMED -> COMPLETED via the detail
  // sheet's contextual controls (REQ-014, REQ-015).
  await page
    .locator(".fc-event", { hasText: "Full E2E Patient" })
    .filter({ hasText: "Scheduled" })
    .first()
    .click();
  await page.getByText("Change status").locator("..").getByRole("button", { name: "Confirmed" }).click();
  await expect(page.getByTestId("appointment-status-chip")).toHaveText("Confirmed");
  await page.getByText("Change status").locator("..").getByRole("button", { name: "Completed" }).click();
  await expect(page.getByTestId("appointment-status-chip")).toHaveText("Completed");
  await page.getByRole("button", { name: "Close" }).click();

  // A COMPLETED appointment shows no status-transition controls and no
  // Edit affordance (REQ-012, REQ-017); the drag-specific rejection path
  // is covered thoroughly by calendar-drag-reschedule.spec.ts, not
  // re-derived here.
  await page.locator(".fc-event", { hasText: "Full E2E Patient" }).filter({ hasText: "Completed" }).click();
  await expect(page.getByText("Change status")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).not.toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // Second appointment: SCHEDULED -> CANCELLED (REQ-016), then confirm it
  // can no longer be rescheduled or re-transitioned via the detail sheet
  // (REQ-012, REQ-017).
  await page.locator(".fc-event", { hasText: "Full E2E Patient" }).filter({ hasText: "Scheduled" }).click();
  await page.getByText("Change status").locator("..").getByRole("button", { name: "Cancelled" }).click();
  await expect(page.getByTestId("appointment-status-chip")).toHaveText("Cancelled");
  await expect(page.getByText("Change status")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).not.toBeVisible();

  const finalState = await adminDb.appointment.findMany({
    where: { organizationId: orgId },
    orderBy: { startAt: "asc" },
  });
  expect(finalState.map((a) => a.status).sort()).toEqual(["CANCELLED", "COMPLETED"]);
});
