import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

/**
 * T4.2, closes REQ-017 through REQ-019. Seeds an ADMIN membership directly
 * (same pattern as tests/e2e/team-page.spec.ts), logs in through the real
 * UI, then exercises the professional-profile page end to end against the
 * real local Postgres: submitting the form creates the caller's own
 * Professional row, and re-submitting updates it in place (no duplicate
 * row). A FRONT_DESK membership gets the same 404 team/page.tsx gives a
 * non-ADMIN visitor.
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const adminEmail = `e2e-profile-admin-${runId}@example.test`;
const frontDeskEmail = `e2e-profile-frontdesk-${runId}@example.test`;
const password = "a-valid-password-123";
let orgSlug: string;

test.beforeAll(async () => {
  const passwordHash = await hash(password);
  const organization = await adminDb.organization.create({
    data: { name: `E2E Profile ${runId}`, slug: `e2e-profile-${runId}` },
  });
  orgSlug = organization.slug;

  const adminUser = await adminDb.user.create({
    data: { email: adminEmail, name: "Profile Admin E2E", passwordHash },
  });
  await adminDb.membership.create({
    data: { userId: adminUser.id, organizationId: organization.id, role: "ADMIN" },
  });

  const frontDeskUser = await adminDb.user.create({
    data: { email: frontDeskEmail, name: "Profile Front Desk E2E", passwordHash },
  });
  await adminDb.membership.create({
    data: { userId: frontDeskUser.id, organizationId: organization.id, role: "FRONT_DESK" },
  });
});

test.afterAll(async () => {
  await adminDb.professional.deleteMany({
    where: { membership: { user: { email: { in: [adminEmail, frontDeskEmail] } } } },
  });
  await adminDb.membership.deleteMany({
    where: { user: { email: { in: [adminEmail, frontDeskEmail] } } },
  });
  await adminDb.user.deleteMany({ where: { email: { in: [adminEmail, frontDeskEmail] } } });
  await adminDb.organization.deleteMany({ where: { slug: `e2e-profile-${runId}` } });
  await adminDb.$disconnect();
});

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("an ADMIN creates and then updates their own professional profile", async ({ page }) => {
  await login(page, adminEmail);

  await page.goto(`/${orgSlug}/team/professional-profile`);
  await page.getByLabel("License number").fill("LIC-E2E-1");
  await page.getByLabel("Specialty").fill("Clinical nutrition");
  await page.getByRole("button", { name: /save profile/i }).click();

  await expect(page.getByTestId("profile-saved")).toBeVisible();

  const membership = await adminDb.membership.findFirstOrThrow({
    where: { user: { email: adminEmail } },
  });
  const professional = await adminDb.professional.findUniqueOrThrow({
    where: { membershipId: membership.id },
  });
  expect(professional.licenseNumber).toBe("LIC-E2E-1");
  expect(professional.specialty).toBe("Clinical nutrition");

  // Re-submitting updates the same row (upsert), not a second one.
  await page.reload();
  await expect(page.getByLabel("License number")).toHaveValue("LIC-E2E-1");
  await page.getByLabel("Specialty").fill("Updated specialty");
  await page.getByRole("button", { name: /save profile/i }).click();
  await expect(page.getByTestId("profile-saved")).toBeVisible();

  const rows = await adminDb.professional.findMany({ where: { membershipId: membership.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0].specialty).toBe("Updated specialty");
});

test("a FRONT_DESK membership gets a 404 on the professional-profile page", async ({ page }) => {
  await login(page, frontDeskEmail);

  const response = await page.goto(`/${orgSlug}/team/professional-profile`);
  expect(response?.status()).toBe(404);
});
