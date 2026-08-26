import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

/**
 * T5.1, closes REQ-008, REQ-009. Seeds a user directly (bypassing
 * registration, which is already covered by register.spec.ts) against the
 * real local Postgres, then exercises login through the actual UI.
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const email = `e2e-login-${runId}@example.test`;
const password = "a-valid-password-123";

test.beforeAll(async () => {
  const passwordHash = await hash(password);
  const organization = await adminDb.organization.create({
    data: { name: `E2E Login ${runId}`, slug: `e2e-login-${runId}` },
  });
  const user = await adminDb.user.create({
    data: { email, name: "Login E2E", passwordHash },
  });
  // adminDb connects as the table-owning role, which bypasses RLS, so no
  // app.current_org_id session variable is needed for this seed insert.
  await adminDb.membership.create({
    data: { userId: user.id, organizationId: organization.id, role: "ADMIN" },
  });
});

test.afterAll(async () => {
  await adminDb.membership.deleteMany({ where: { user: { email } } });
  await adminDb.user.deleteMany({ where: { email } });
  await adminDb.organization.deleteMany({ where: { slug: `e2e-login-${runId}` } });
  await adminDb.$disconnect();
});

test("logs in with correct credentials and establishes a session", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();

  await expect(page).toHaveURL(/\/$/);

  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name.includes("authjs.session-token"));
  expect(sessionCookie).toBeTruthy();
});

test("shows a generic error for a wrong password, without saying which part was wrong", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("definitely-the-wrong-password");
  await page.getByRole("button", { name: /log in/i }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
});

test("shows the same generic error for an email that doesn't exist", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(`nobody-${runId}@example.test`);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
});
