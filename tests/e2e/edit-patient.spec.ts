import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

/**
 * T4.5, closes REQ-012, REQ-013, REQ-014. Edits an existing patient through
 * the real UI, then exercises the archive/unarchive buttons and confirms
 * `revalidatePath` actually refreshed the list page.
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const email = `e2e-edit-patient-${runId}@example.test`;
const password = "a-valid-password-123";
let orgSlug: string;
let orgId: string;

test.beforeAll(async () => {
  const passwordHash = await hash(password);
  const organization = await adminDb.organization.create({
    data: { name: `E2E Edit Patient ${runId}`, slug: `e2e-edit-patient-${runId}` },
  });
  orgSlug = organization.slug;
  orgId = organization.id;
  const user = await adminDb.user.create({
    data: { email, name: "Edit Patient E2E", passwordHash },
  });
  await adminDb.membership.create({
    data: { userId: user.id, organizationId: orgId, role: "FRONT_DESK" },
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

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("edits a patient's fields and then archives/unarchives them", async ({ page }) => {
  const patient = await adminDb.patient.create({
    data: { organizationId: orgId, fullName: "Before Edit E2E", phone: "+15551230000" },
  });

  await login(page);
  await page.goto(`/${orgSlug}/patients/${patient.id}/edit`);

  const fullNameInput = page.getByLabel("Full name");
  await fullNameInput.fill("");
  await fullNameInput.fill("After Edit E2E");
  await page.getByRole("button", { name: /save changes/i }).click();

  await expect(page).toHaveURL(`/${orgSlug}/patients/${patient.id}`);
  await expect(page.getByTestId("patient-full-name")).toHaveText("After Edit E2E");

  // Archive.
  await page.goto(`/${orgSlug}/patients/${patient.id}/edit`);
  await page.getByRole("button", { name: /archive patient/i }).click();
  await expect(page.getByRole("button", { name: /unarchive patient/i })).toBeVisible();

  const archived = await adminDb.patient.findUniqueOrThrow({ where: { id: patient.id } });
  expect(archived.archivedAt).not.toBeNull();

  // The list page (revalidated by the archive action) no longer shows it
  // by default, but does under the archived filter.
  await page.goto(`/${orgSlug}/patients`);
  await expect(page.getByText("After Edit E2E")).not.toBeVisible();
  await page.goto(`/${orgSlug}/patients?archived=true`);
  await expect(page.getByText("After Edit E2E")).toBeVisible();

  // Unarchive.
  await page.goto(`/${orgSlug}/patients/${patient.id}/edit`);
  await page.getByRole("button", { name: /unarchive patient/i }).click();
  await expect(page.getByRole("button", { name: /archive patient/i })).toBeVisible();

  const unarchived = await adminDb.patient.findUniqueOrThrow({ where: { id: patient.id } });
  expect(unarchived.archivedAt).toBeNull();

  await page.goto(`/${orgSlug}/patients`);
  await expect(page.getByText("After Edit E2E")).toBeVisible();
});
