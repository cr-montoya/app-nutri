import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import type { Role } from "@prisma/client";
import { formatBogotaDateAndTime } from "@/validation/appointments";

/**
 * T4.8, closes REQ-023. Confirms no `Appointment` action calls
 * `requireRole`: each of `ADMIN`, `NUTRITIONIST`, `FRONT_DESK` can create
 * an appointment and transition its status through the real UI, in the
 * same organization. Same pattern as tests/e2e/patient-rbac-open.spec.ts.
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const password = "a-valid-password-123";
let orgSlug: string;
let orgId: string;
let professionalId: string;
let patientId: string;
const createdEmails: string[] = [];

test.beforeAll(async () => {
  const organization = await adminDb.organization.create({
    data: { name: `E2E Appointment RBAC Open ${runId}`, slug: `e2e-appointment-rbac-open-${runId}` },
  });
  orgSlug = organization.slug;
  orgId = organization.id;

  const passwordHash = await hash(password);
  const profUser = await adminDb.user.create({
    data: { email: `e2e-appointment-rbac-prof-${runId}@example.test`, name: "Dr. RBAC", passwordHash },
  });
  const membership = await adminDb.membership.create({
    data: { userId: profUser.id, organizationId: orgId, role: "NUTRITIONIST" },
  });
  const professional = await adminDb.professional.create({
    data: { membershipId: membership.id, organizationId: orgId, licenseNumber: `LIC-${runId}` },
  });
  professionalId = professional.id;

  const patient = await adminDb.patient.create({
    data: { organizationId: orgId, fullName: "RBAC Open Patient", phone: "+15550007777" },
  });
  patientId = patient.id;
});

test.afterAll(async () => {
  await adminDb.appointment.deleteMany({ where: { organizationId: orgId } });
  await adminDb.patient.deleteMany({ where: { organizationId: orgId } });
  await adminDb.professional.deleteMany({ where: { organizationId: orgId } });
  await adminDb.membership.deleteMany({ where: { organizationId: orgId } });
  await adminDb.user.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.organization.deleteMany({ where: { id: orgId } });
  await adminDb.$disconnect();
});

const roles: Role[] = ["ADMIN", "NUTRITIONIST", "FRONT_DESK"];

for (const role of roles) {
  test(`${role} can create an appointment and transition its status`, async ({ page }) => {
    const email = `e2e-appointment-rbac-${role.toLowerCase()}-${runId}@example.test`;
    createdEmails.push(email);
    const passwordHash = await hash(password);
    const user = await adminDb.user.create({ data: { email, name: `${role} E2E`, passwordHash } });
    await adminDb.membership.create({ data: { userId: user.id, organizationId: orgId, role } });

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /log in/i }).click();
    await expect(page).toHaveURL(/\/$/);

    // Create, at a distinct future slot per role (staggered from "now", not
    // a fixed clock time) so it both passes REQ-004's past-time check and
    // shows up on the calendar's default "today" view, and never conflicts
    // with another role's slot on the same shared professional.
    const roleIndex = roles.indexOf(role);
    const startAt = new Date(Date.now() + (2 + roleIndex) * 60 * 60_000);
    const { date, time } = formatBogotaDateAndTime(startAt);

    await page.goto(`/${orgSlug}/appointments/new`);
    await page.getByLabel("Patient").selectOption(patientId);
    await page.getByLabel("Professional").selectOption(professionalId);
    await page.getByLabel("Date").fill(date);
    await page.getByLabel("Time").fill(time);
    await page.getByRole("button", { name: /create appointment/i }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/${orgSlug}/appointments`);

    // A 2-6 hour offset from "now" can land on Bogota's next calendar day
    // (for example when the suite runs near Bogota midnight); the calendar
    // defaults to showing today, so advance one day when that happened.
    const todayBogotaDate = formatBogotaDateAndTime(new Date()).date;
    if (date !== todayBogotaDate) {
      await page.getByRole("button", { name: "next" }).click();
    }

    // Transition its status via the detail sheet.
    await page.locator(".fc-event", { hasText: "RBAC Open Patient" }).last().click();
    await page.getByText("Change status").locator("..").getByRole("button", { name: "Confirmed" }).click();
    await expect(page.getByTestId("appointment-status-chip")).toHaveText("Confirmed");
  });
}
