import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

/**
 * T6.2, closes REQ-014: the dashboard shows the organization's name and
 * the user's role, no clinical data (none exists yet in this phase).
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const orgSlug = `e2e-dashboard-${runId}`;
const email = `e2e-dashboard-${runId}@example.test`;
const password = "a-valid-password-123";
const orgName = `E2E Dashboard ${runId}`;

test.beforeAll(async () => {
  const passwordHash = await hash(password);
  const organization = await adminDb.organization.create({
    data: { name: orgName, slug: orgSlug },
  });
  const user = await adminDb.user.create({
    data: { email, name: "Dashboard E2E", passwordHash },
  });
  await adminDb.membership.create({
    data: { userId: user.id, organizationId: organization.id, role: "ADMIN" },
  });
});

test.afterAll(async () => {
  await adminDb.membership.deleteMany({ where: { user: { email } } });
  await adminDb.user.deleteMany({ where: { email } });
  await adminDb.organization.deleteMany({ where: { slug: orgSlug } });
  await adminDb.$disconnect();
});

test("shows the organization's name and the user's role after login", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto(`/${orgSlug}/dashboard`);

  await expect(page.getByRole("heading", { name: orgName })).toBeVisible();
  await expect(page.getByText("Role: ADMIN")).toBeVisible();
});
