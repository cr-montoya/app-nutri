import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

/**
 * T4.4, closes REQ-018, REQ-022. Seeds a patient directly, views it through
 * the real UI, confirms every field renders and a `patient.view` AuditLog
 * row is recorded -- and that a patient belonging to a different
 * organization 404s (REQ-019).
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const email = `e2e-patient-detail-${runId}@example.test`;
const password = "a-valid-password-123";
let orgSlug: string;
let orgId: string;
let otherOrgId: string;

test.beforeAll(async () => {
  const passwordHash = await hash(password);
  const organization = await adminDb.organization.create({
    data: { name: `E2E Patient Detail ${runId}`, slug: `e2e-patient-detail-${runId}` },
  });
  orgSlug = organization.slug;
  orgId = organization.id;
  const otherOrg = await adminDb.organization.create({
    data: { name: `E2E Patient Detail Other ${runId}`, slug: `e2e-patient-detail-other-${runId}` },
  });
  otherOrgId = otherOrg.id;
  const user = await adminDb.user.create({
    data: { email, name: "Patient Detail E2E", passwordHash },
  });
  await adminDb.membership.create({
    data: { userId: user.id, organizationId: orgId, role: "NUTRITIONIST" },
  });
});

test.afterAll(async () => {
  await adminDb.auditLog.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  await adminDb.patient.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  await adminDb.membership.deleteMany({ where: { user: { email } } });
  await adminDb.user.deleteMany({ where: { email } });
  await adminDb.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
  await adminDb.$disconnect();
});

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("shows every field and logs the view", async ({ page }) => {
  const patient = await adminDb.patient.create({
    data: {
      organizationId: orgId,
      fullName: "Detail Patient E2E",
      phone: "+15557778888",
      documentId: `DOC-DETAIL-${runId}`,
      email: "detail-patient@example.test",
      address: "123 Main St",
      sex: "FEMALE",
      birthDate: new Date("1990-05-15"),
    },
  });

  await login(page);
  await page.goto(`/${orgSlug}/patients/${patient.id}`);

  await expect(page.getByTestId("patient-full-name")).toHaveText("Detail Patient E2E");
  await expect(page.getByTestId("patient-phone")).toHaveText("+15557778888");
  await expect(page.getByTestId("patient-documentId")).toHaveText(`DOC-DETAIL-${runId}`);
  await expect(page.getByText("detail-patient@example.test")).toBeVisible();
  await expect(page.getByText("123 Main St")).toBeVisible();
  await expect(page.getByText("FEMALE")).toBeVisible();
  await expect(page.getByText("1990-05-15")).toBeVisible();

  const logs = await adminDb.auditLog.findMany({ where: { entityId: patient.id, action: "patient.view" } });
  expect(logs.length).toBeGreaterThanOrEqual(1);
});

test("404s for a patient belonging to a different organization", async ({ page }) => {
  const foreignPatient = await adminDb.patient.create({
    data: { organizationId: otherOrgId, fullName: "Foreign Patient", phone: "+15550009999" },
  });

  await login(page);
  const response = await page.goto(`/${orgSlug}/patients/${foreignPatient.id}`);
  expect(response?.status()).toBe(404);
});
