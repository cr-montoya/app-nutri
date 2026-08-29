import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

/**
 * T4.7. Confirms the calendar shell and the create page both render, that
 * the create form actually creates an `Appointment` and redirects back to
 * the calendar (REQ-001), and that navigating with
 * `?date=&time=&professionalId=` pre-fills those fields (design.md's
 * "Pre-filled create from an empty slot click").
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const email = `e2e-appointments-pages-${runId}@example.test`;
const password = "a-valid-password-123";
let orgSlug: string;
let orgId: string;
let professionalId: string;
let patientId: string;

test.beforeAll(async () => {
  const passwordHash = await hash(password);
  const organization = await adminDb.organization.create({
    data: { name: `E2E Appointments Pages ${runId}`, slug: `e2e-appointments-pages-${runId}` },
  });
  orgSlug = organization.slug;
  orgId = organization.id;
  const user = await adminDb.user.create({ data: { email, name: "Pages E2E", passwordHash } });
  await adminDb.membership.create({ data: { userId: user.id, organizationId: orgId, role: "ADMIN" } });

  const profUser = await adminDb.user.create({
    data: { email: `e2e-appointments-pages-prof-${runId}@example.test`, name: "Dr. Pages", passwordHash },
  });
  const membership = await adminDb.membership.create({
    data: { userId: profUser.id, organizationId: orgId, role: "NUTRITIONIST" },
  });
  const professional = await adminDb.professional.create({
    data: { membershipId: membership.id, organizationId: orgId, licenseNumber: `LIC-${runId}` },
  });
  professionalId = professional.id;

  const patient = await adminDb.patient.create({
    data: { organizationId: orgId, fullName: "Pages Test Patient", phone: "+15550005555" },
  });
  patientId = patient.id;
});

test.afterAll(async () => {
  await adminDb.appointment.deleteMany({ where: { organizationId: orgId } });
  await adminDb.patient.deleteMany({ where: { organizationId: orgId } });
  await adminDb.professional.deleteMany({ where: { organizationId: orgId } });
  await adminDb.membership.deleteMany({ where: { organizationId: orgId } });
  await adminDb.user.deleteMany({ where: { email: { contains: `e2e-appointments-pages-${runId}` } } });
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

test("the calendar shell renders with a New appointment link", async ({ page }) => {
  await login(page);
  await page.goto(`/${orgSlug}/appointments`);
  await expect(page.getByRole("heading", { name: "Appointments" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New appointment" })).toBeVisible();
});

test("creates an appointment through the form and redirects to the calendar", async ({ page }) => {
  await login(page);
  await page.goto(`/${orgSlug}/appointments/new`);

  await page.getByLabel("Patient").selectOption(patientId);
  await page.getByLabel("Professional").selectOption(professionalId);
  await page.getByLabel("Date").fill("2028-01-15");
  await page.getByLabel("Time").fill("10:00");
  await page.getByRole("button", { name: /create appointment/i }).click();

  await expect(page).toHaveURL((url) => url.pathname === `/${orgSlug}/appointments`);

  const created = await adminDb.appointment.findFirstOrThrow({
    where: { organizationId: orgId, patientId, professionalId },
  });
  expect(created.status).toBe("SCHEDULED");
});

test("pre-fills date, time, and professional from query params", async ({ page }) => {
  await login(page);
  await page.goto(
    `/${orgSlug}/appointments/new?date=2028-02-01&time=09:30&professionalId=${professionalId}`
  );

  await expect(page.getByLabel("Date")).toHaveValue("2028-02-01");
  await expect(page.getByLabel("Time")).toHaveValue("09:30");
  await expect(page.getByLabel("Professional")).toHaveValue(professionalId);
});
