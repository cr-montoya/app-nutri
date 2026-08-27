import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { getBogotaDayRange } from "@/validation/appointments";

/**
 * T4.4, closes REQ-013, REQ-026 (drag path). Drags a calendar event to a
 * new time slot via real mouse events (FullCalendar's interaction plugin
 * needs incremental mousemove events to register a drag, not a single
 * jump), confirming it calls `updateAppointmentAction` end to end. A
 * second case drags a `COMPLETED` appointment (REQ-012: not editable) to
 * an empty slot and confirms the visual revert plus inline `dragError`
 * (REQ-026), with no persisted change -- this exercises the rejection
 * path via an invalid-status drop rather than a same-slot conflict, which
 * is a separate, purely mechanical concern from what REQ-026 actually
 * requires (a rejection surfaces its reason and reverts).
 *
 * A tall viewport is required: `resourceTimeGridDay` with `height="auto"`
 * renders the full 24-hour grid (~1200px) without internal scrolling, and
 * Playwright's mouse coordinates are viewport-relative -- a drag distance
 * that pushes the cursor's Y past the default 720px viewport height lands
 * outside any droppable target, so FullCalendar's interaction plugin
 * fires `eventDragStop` but never `eventDrop`, silently cancelling the
 * drag with no error. Discovered by comparing `eventDragStart`/
 * `eventDragStop`/`eventDrop` firing (the first two always fired, the
 * third never did for a drag ending below y=720) against a shorter,
 * in-viewport drag that worked -- a test-geometry issue, not a product
 * bug in `calendar.tsx`'s drop handling.
 */
test.use({ viewport: { width: 1280, height: 1400 } });

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const email = `e2e-calendar-drag-${runId}@example.test`;
const password = "a-valid-password-123";
let orgSlug: string;
let orgId: string;
let appointmentId: string;
let completedAppointmentId: string;

const { start: TODAY_START } = getBogotaDayRange();
// Bogota 08:00 and 10:00 -- both comfortably inside FullCalendar's default
// scrollTime and, at the 1400px viewport above, both fully in view without
// scrolling even after a several-slot drag.
const APPOINTMENT_START = new Date(TODAY_START.getTime() + 8 * 60 * 60_000);
const COMPLETED_START = new Date(TODAY_START.getTime() + 10 * 60 * 60_000);

test.beforeAll(async () => {
  const passwordHash = await hash(password);
  const organization = await adminDb.organization.create({
    data: { name: `E2E Calendar Drag ${runId}`, slug: `e2e-calendar-drag-${runId}` },
  });
  orgSlug = organization.slug;
  orgId = organization.id;
  const user = await adminDb.user.create({ data: { email, name: "Drag E2E", passwordHash } });
  await adminDb.membership.create({ data: { userId: user.id, organizationId: orgId, role: "ADMIN" } });

  const profUser = await adminDb.user.create({
    data: { email: `e2e-calendar-drag-prof-${runId}@example.test`, name: "Dr. Drag", passwordHash },
  });
  const membership = await adminDb.membership.create({
    data: { userId: profUser.id, organizationId: orgId, role: "NUTRITIONIST" },
  });
  const professional = await adminDb.professional.create({
    data: { membershipId: membership.id, organizationId: orgId, licenseNumber: `LIC-${runId}` },
  });

  const patient = await adminDb.patient.create({
    data: { organizationId: orgId, fullName: "Drag Test Patient", phone: "+15550008888" },
  });

  const appointment = await adminDb.appointment.create({
    data: {
      organizationId: orgId,
      patientId: patient.id,
      professionalId: professional.id,
      startAt: APPOINTMENT_START,
      endAt: new Date(APPOINTMENT_START.getTime() + 30 * 60_000),
      status: "SCHEDULED",
    },
  });
  appointmentId = appointment.id;

  const completed = await adminDb.appointment.create({
    data: {
      organizationId: orgId,
      patientId: patient.id,
      professionalId: professional.id,
      startAt: COMPLETED_START,
      endAt: new Date(COMPLETED_START.getTime() + 30 * 60_000),
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
  await adminDb.user.deleteMany({ where: { email: { contains: `e2e-calendar-drag-${runId}` } } });
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

/** Pixel height of one 30-minute slot in the currently rendered grid. */
async function getSlotHeightPx(page: import("@playwright/test").Page): Promise<number> {
  const lanes = page.locator(".fc-timegrid-slot-lane");
  const first = await lanes.nth(0).boundingBox();
  const second = await lanes.nth(1).boundingBox();
  return second!.y - first!.y;
}

/** Drags an event chip vertically by `slots` × 30-minute slots. */
async function dragEventBySlots(
  page: import("@playwright/test").Page,
  eventChip: ReturnType<import("@playwright/test").Page["locator"]>,
  slots: number
) {
  const slotHeight = await getSlotHeightPx(page);
  const sourceBox = await eventChip.boundingBox();
  expect(sourceBox).not.toBeNull();

  const startX = sourceBox!.x + sourceBox!.width / 2;
  const startY = sourceBox!.y + 4;
  const endY = startY + slotHeight * slots;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Incremental moves: FullCalendar's interaction plugin needs several
  // mousemove events past a distance threshold to recognize a drag, not
  // a single jump from source to destination.
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX, startY + ((endY - startY) * i) / steps, { steps: 1 });
  }
  await page.mouse.up();
}

test("dragging an event to a new time reschedules it (REQ-013)", async ({ page }) => {
  await login(page);
  await page.goto(`/${orgSlug}/appointments`);

  const eventChip = page.locator(".fc-event", { hasText: "Drag Test Patient" }).first();
  await expect(eventChip).toBeVisible();

  // Drag down 2 slots (30 min each) = +1 hour.
  await dragEventBySlots(page, eventChip, 2);

  await expect
    .poll(async () => {
      const updated = await adminDb.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
      return updated.startAt.getTime();
    })
    .toBe(APPOINTMENT_START.getTime() + 60 * 60_000);
});

test("dragging a COMPLETED appointment reverts and shows the rejection reason (REQ-012, REQ-026)", async ({
  page,
}) => {
  await login(page);
  await page.goto(`/${orgSlug}/appointments`);

  const eventChip = page.locator(".fc-event", { hasText: "Completed" }).first();
  await expect(eventChip).toBeVisible();

  // One empty slot away is enough; REQ-012 rejects any reschedule of a
  // COMPLETED appointment regardless of where it's dropped.
  await dragEventBySlots(page, eventChip, 2);

  await expect(page.getByTestId("drag-error")).toBeVisible();
  await expect(page.getByTestId("drag-error")).toContainText(/no longer be rescheduled|edited/i);

  const unchanged = await adminDb.appointment.findUniqueOrThrow({ where: { id: completedAppointmentId } });
  expect(unchanged.startAt.getTime()).toBe(COMPLETED_START.getTime());
});
