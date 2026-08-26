import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

/**
 * T4.3, closes REQ-001. Fills and submits the new-patient form through the
 * real UI, then confirms the redirect to the new patient's detail page and
 * the row it created.
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const email = `e2e-create-patient-${runId}@example.test`;
const password = "a-valid-password-123";
let orgSlug: string;
let orgId: string;

test.beforeAll(async () => {
  const passwordHash = await hash(password);
  const organization = await adminDb.organization.create({
    data: { name: `E2E Create Patient ${runId}`, slug: `e2e-create-patient-${runId}` },
  });
  orgSlug = organization.slug;
  orgId = organization.id;
  const user = await adminDb.user.create({
    data: { email, name: "Create Patient E2E", passwordHash },
  });
  await adminDb.membership.create({
    data: { userId: user.id, organizationId: orgId, role: "ADMIN" },
  });
});

test.afterAll(async () => {
  await adminDb.auditLog.deleteMany({ where: { organizationId: orgId } });
  await adminDb.patient.deleteMany({ where: { organizationId: orgId } });
  await adminDb.membership.deleteMany({ where: { user: { email } } });
  await adminDb.user.deleteMany({ where: { email } });
  await adminDb.organization.deleteMany({ where: { id: orgId } });
  await adminDb.$disconnect();
});

test("creates a patient through the form and redirects to its detail page", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto(`/${orgSlug}/patients/new`);
  await page.getByLabel("Full name").fill("New Patient E2E");
  await page.getByLabel("Phone").fill("+15559998888");
  await page.getByLabel("Document ID").fill(`DOC-NEW-${runId}`);
  await page.getByRole("button", { name: /create patient/i }).click();

  await expect(page).toHaveURL(
    (url) => url.pathname.startsWith(`/${orgSlug}/patients/`) && !url.pathname.endsWith("/new")
  );
  await expect(page.getByTestId("patient-full-name")).toHaveText("New Patient E2E");

  const created = await adminDb.patient.findFirstOrThrow({
    where: { organizationId: orgId, documentId: `DOC-NEW-${runId}` },
  });
  expect(created.fullName).toBe("New Patient E2E");

  const logs = await adminDb.auditLog.findMany({ where: { entityId: created.id } });
  expect(logs.some((log) => log.action === "patient.create")).toBe(true);
});

test("rejects invalid input and shows a validation error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto(`/${orgSlug}/patients/new`);
  await page.getByLabel("Full name").fill("Bad Phone Patient");
  await page.getByLabel("Phone").fill("not-a-phone");
  await page.getByRole("button", { name: /create patient/i }).click();

  await expect(page.getByTestId("patient-form-error")).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === `/${orgSlug}/patients/new`);

  const count = await adminDb.patient.count({ where: { fullName: "Bad Phone Patient" } });
  expect(count).toBe(0);
});
