import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

/**
 * T5.2, closes REQ-015: logging out invalidates the session and redirects
 * to /login.
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const email = `e2e-logout-${runId}@example.test`;
const password = "a-valid-password-123";

test.beforeAll(async () => {
  const passwordHash = await hash(password);
  const organization = await adminDb.organization.create({
    data: { name: `E2E Logout ${runId}`, slug: `e2e-logout-${runId}` },
  });
  const user = await adminDb.user.create({
    data: { email, name: "Logout E2E", passwordHash },
  });
  await adminDb.membership.create({
    data: { userId: user.id, organizationId: organization.id, role: "ADMIN" },
  });
});

test.afterAll(async () => {
  await adminDb.membership.deleteMany({ where: { user: { email } } });
  await adminDb.user.deleteMany({ where: { email } });
  await adminDb.organization.deleteMany({ where: { slug: `e2e-logout-${runId}` } });
  await adminDb.$disconnect();
});

test("logging out invalidates the session and redirects to /login", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: /log out/i })).toBeVisible();

  await page.getByRole("button", { name: /log out/i }).click();

  await expect(page).toHaveURL(/\/login$/);

  // Session actually invalidated, not just a client-side redirect: a
  // protected route now bounces back to /login again.
  await page.goto("/some-org/dashboard");
  await expect(page).toHaveURL(/\/login$/);

  // Root page reverts to showing "Log in", proving auth() no longer sees a
  // session either.
  await page.goto("/");
  await expect(page.getByRole("link", { name: /log in/i })).toBeVisible();
});
