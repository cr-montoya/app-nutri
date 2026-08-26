import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

/**
 * T4.2, closes REQ-015, REQ-016, REQ-017. Seeds patients directly (the
 * create-patient flow itself is tests/e2e/create-patient.spec.ts's job),
 * then exercises the list page's shell, search, and archived filter
 * through the real UI -- same login pattern as tests/e2e/team-page.spec.ts.
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const email = `e2e-patient-list-${runId}@example.test`;
const password = "a-valid-password-123";
let orgSlug: string;
let orgId: string;

test.beforeAll(async () => {
  const passwordHash = await hash(password);
  const organization = await adminDb.organization.create({
    data: { name: `E2E Patient List ${runId}`, slug: `e2e-patient-list-${runId}` },
  });
  orgSlug = organization.slug;
  orgId = organization.id;
  const user = await adminDb.user.create({
    data: { email, name: "Patient List E2E", passwordHash },
  });
  await adminDb.membership.create({
    data: { userId: user.id, organizationId: orgId, role: "ADMIN" },
  });
  await adminDb.patient.createMany({
    data: [
      { organizationId: orgId, fullName: "Alice Anderson", phone: "+15550001111", documentId: `DOC-A-${runId}` },
      { organizationId: orgId, fullName: "Bob Brown", phone: "+15550002222", documentId: `DOC-B-${runId}` },
      {
        organizationId: orgId,
        fullName: "Carol Archived",
        phone: "+15550003333",
        documentId: `DOC-C-${runId}`,
        archivedAt: new Date(),
      },
    ],
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

test("lists non-archived patients by default, hides archived", async ({ page }) => {
  await login(page);
  await page.goto(`/${orgSlug}/patients`);

  await expect(page.getByText("Alice Anderson")).toBeVisible();
  await expect(page.getByText("Bob Brown")).toBeVisible();
  await expect(page.getByText("Carol Archived")).not.toBeVisible();
});

test("shows archived patients when the archived filter is enabled", async ({ page }) => {
  await login(page);
  await page.goto(`/${orgSlug}/patients?archived=true`);

  await expect(page.getByText("Carol Archived")).toBeVisible();
  await expect(page.getByTestId("archived-badge")).toBeVisible();
});

test("searches by partial name and by exact document ID", async ({ page }) => {
  await login(page);

  await page.goto(`/${orgSlug}/patients?q=ali`);
  await expect(page.getByText("Alice Anderson")).toBeVisible();
  await expect(page.getByText("Bob Brown")).not.toBeVisible();

  await page.goto(`/${orgSlug}/patients?q=DOC-B-${runId}`);
  await expect(page.getByText("Bob Brown")).toBeVisible();
  await expect(page.getByText("Alice Anderson")).not.toBeVisible();
});

test("the shell (new-patient button) renders even via the search form", async ({ page }) => {
  await login(page);
  await page.goto(`/${orgSlug}/patients`);

  await expect(page.getByRole("link", { name: "New patient" })).toBeVisible();
  await page.getByLabel("Search patients").fill("Bob");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(new RegExp(`q=Bob`));
  await expect(page.getByText("Bob Brown")).toBeVisible();
});
