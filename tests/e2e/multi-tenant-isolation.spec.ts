import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { slugify } from "@/server/services/organization-slug";

/**
 * T8.1: the phase's actual purpose, end to end through the real UI (not
 * seeded fixtures like the other e2e specs): register organization A,
 * register organization B, log in as A, confirm the dashboard shows only
 * A's data, then while still authenticated as A request B's dashboard URL
 * and confirm a 404 with no leaked data. Confirms REQ-012, REQ-013,
 * REQ-016, REQ-017 hold together, not just in isolated unit/integration
 * tests.
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();

const orgAName = `MTI Org A ${runId}`;
const orgBName = `MTI Org B ${runId}`;
const emailA = `mti-a-${runId}@example.test`;
const emailB = `mti-b-${runId}@example.test`;
const password = "a-valid-password-123";

test.afterAll(async () => {
  await adminDb.membership.deleteMany({ where: { user: { email: { in: [emailA, emailB] } } } });
  await adminDb.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
  await adminDb.organization.deleteMany({
    where: { slug: { in: [slugify(orgAName), slugify(orgBName)] } },
  });
  await adminDb.$disconnect();
});

async function registerViaUi(
  page: import("@playwright/test").Page,
  { email, name, organizationName }: { email: string; name: string; organizationName: string }
) {
  await page.goto("/register");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Organization name").fill(organizationName);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /create organization/i }).click();
  await expect(page).toHaveURL(/\/login\?registered=1$/);
}

test("multi-tenant isolation holds end to end through the real UI", async ({ page }) => {
  // Register both organizations through the real registration flow.
  await registerViaUi(page, { email: emailA, name: "Nutri A", organizationName: orgAName });
  await registerViaUi(page, { email: emailB, name: "Nutri B", organizationName: orgBName });

  const orgA = await adminDb.organization.findUniqueOrThrow({ where: { slug: slugify(orgAName) } });
  const orgB = await adminDb.organization.findUniqueOrThrow({ where: { slug: slugify(orgBName) } });

  // Log in as A.
  await page.goto("/login");
  await page.getByLabel("Email").fill(emailA);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/$/);

  // A's own dashboard shows only A's data.
  const ownResponse = await page.goto(`/${orgA.slug}/dashboard`);
  expect(ownResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: orgAName })).toBeVisible();
  await expect(page.getByText("Role: ADMIN")).toBeVisible();
  await expect(page.getByText(orgBName)).toHaveCount(0);

  // Still authenticated as A, request B's dashboard URL directly: 404, no
  // leaked data, indistinguishable from a nonexistent slug (REQ-017).
  const otherOrgResponse = await page.goto(`/${orgB.slug}/dashboard`);
  expect(otherOrgResponse?.status()).toBe(404);
  await expect(page.getByText(orgBName)).toHaveCount(0);
  await expect(page.getByText("Role: ADMIN")).toHaveCount(0);

  const nonexistentResponse = await page.goto(`/does-not-exist-${runId}/dashboard`);
  expect(nonexistentResponse?.status()).toBe(404);
});
