import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

/**
 * T6.1, closes REQ-017: an authenticated user requesting a workspace route
 * under an organization slug that isn't their own gets the same 404 as a
 * nonexistent slug -- no leaked data, no distinguishable response.
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const password = "a-valid-password-123";

const orgASlug = `e2e-wrong-org-a-${runId}`;
const orgBSlug = `e2e-wrong-org-b-${runId}`;
const emailA = `e2e-wrong-org-a-${runId}@example.test`;
const emailB = `e2e-wrong-org-b-${runId}@example.test`;

test.beforeAll(async () => {
  const passwordHash = await hash(password);

  const orgA = await adminDb.organization.create({
    data: { name: `E2E Wrong Org A ${runId}`, slug: orgASlug },
  });
  const orgB = await adminDb.organization.create({
    data: { name: `E2E Wrong Org B ${runId}`, slug: orgBSlug },
  });

  const userA = await adminDb.user.create({
    data: { email: emailA, name: "Wrong Org A", passwordHash },
  });
  const userB = await adminDb.user.create({
    data: { email: emailB, name: "Wrong Org B", passwordHash },
  });

  await adminDb.membership.create({
    data: { userId: userA.id, organizationId: orgA.id, role: "ADMIN" },
  });
  await adminDb.membership.create({
    data: { userId: userB.id, organizationId: orgB.id, role: "ADMIN" },
  });
});

test.afterAll(async () => {
  await adminDb.membership.deleteMany({ where: { user: { email: { in: [emailA, emailB] } } } });
  await adminDb.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
  await adminDb.organization.deleteMany({ where: { slug: { in: [orgASlug, orgBSlug] } } });
  await adminDb.$disconnect();
});

test("logged in as org A, org B's dashboard 404s with no leaked data", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(emailA);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/$/);

  // Control: org A's own dashboard works.
  const ownResponse = await page.goto(`/${orgASlug}/dashboard`);
  expect(ownResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: `E2E Wrong Org A ${runId}` })).toBeVisible();

  // Org B's dashboard: same 404 a nonexistent slug would get, nothing from
  // org B ever rendered.
  const otherOrgResponse = await page.goto(`/${orgBSlug}/dashboard`);
  expect(otherOrgResponse?.status()).toBe(404);
  await expect(page.getByText(`E2E Wrong Org B ${runId}`)).toHaveCount(0);
});

test("a nonexistent organization slug gets the identical 404", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(emailA);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/$/);

  const response = await page.goto(`/does-not-exist-${runId}/dashboard`);
  expect(response?.status()).toBe(404);
});
