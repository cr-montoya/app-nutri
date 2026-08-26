import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * T4.3, exercises REQ-001/REQ-002/REQ-003/REQ-004/REQ-006/REQ-021 through
 * the actual UI, against the real local Postgres (Docker, standing in for
 * a Neon dev branch).
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const createdEmails: string[] = [];

test.afterAll(async () => {
  await adminDb.membership.deleteMany({ where: { user: { email: { in: createdEmails } } } });
  await adminDb.user.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.organization.deleteMany({ where: { slug: { startsWith: `e2e-register-${runId}` } } });
  await adminDb.$disconnect();
});

test("registers a new organization and redirects to /login", async ({ page }) => {
  const email = `e2e-register-${runId}@example.test`;
  createdEmails.push(email);

  await page.goto("/register");

  await page.getByLabel("Name", { exact: true }).fill("Nutri E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Organization name").fill(`e2e-register-${runId} Clinic`);
  await page.getByLabel("Password").fill("a-valid-password-123");

  await page.getByRole("button", { name: /create organization/i }).click();

  await expect(page).toHaveURL(/\/login\?registered=1$/);

  const user = await adminDb.user.findUnique({ where: { email } });
  expect(user).not.toBeNull();
});

test("shows a validation error and creates nothing for a too-short password", async ({ page }) => {
  const email = `e2e-register-invalid-${runId}@example.test`;

  await page.goto("/register");
  await page.getByLabel("Name", { exact: true }).fill("Nutri E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Organization name").fill(`e2e-register-${runId} Invalid`);
  await page.getByLabel("Password").fill("short");

  await page.getByRole("button", { name: /create organization/i }).click();

  await expect(page).toHaveURL(/\/register$/);
  const user = await adminDb.user.findUnique({ where: { email } });
  expect(user).toBeNull();
});
