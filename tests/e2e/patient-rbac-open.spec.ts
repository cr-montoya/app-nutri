import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import type { Role } from "@prisma/client";

/**
 * T4.6, closes REQ-023. Confirms no `Patient` action in this spec calls
 * `requireRole`: each of `ADMIN`, `NUTRITIONIST`, `FRONT_DESK` can create,
 * view, edit, and archive a patient through the real UI, in the same
 * organization. tests/e2e/patients-e2e.spec.ts (T5.1) already proves the
 * full flow end to end for the least-privileged role (`FRONT_DESK`); this
 * proves the other two roles hit no role check either.
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const password = "a-valid-password-123";
let orgSlug: string;
let orgId: string;
const createdEmails: string[] = [];

test.beforeAll(async () => {
  const organization = await adminDb.organization.create({
    data: { name: `E2E Patient RBAC Open ${runId}`, slug: `e2e-patient-rbac-open-${runId}` },
  });
  orgSlug = organization.slug;
  orgId = organization.id;
});

test.afterAll(async () => {
  await adminDb.auditLog.deleteMany({ where: { organizationId: orgId } });
  await adminDb.patient.deleteMany({ where: { organizationId: orgId } });
  await adminDb.membership.deleteMany({ where: { user: { email: { in: createdEmails } } } });
  await adminDb.user.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.organization.deleteMany({ where: { id: orgId } });
  await adminDb.$disconnect();
});

const roles: Role[] = ["ADMIN", "NUTRITIONIST", "FRONT_DESK"];

for (const role of roles) {
  test(`${role} can create, view, edit, and archive a patient`, async ({ page }) => {
    const email = `e2e-patient-rbac-${role.toLowerCase()}-${runId}@example.test`;
    createdEmails.push(email);
    const passwordHash = await hash(password);
    const user = await adminDb.user.create({ data: { email, name: `${role} E2E`, passwordHash } });
    await adminDb.membership.create({ data: { userId: user.id, organizationId: orgId, role } });

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /log in/i }).click();
    await expect(page).toHaveURL(/\/$/);

    // Create.
    await page.goto(`/${orgSlug}/patients/new`);
    await page.getByLabel("Full name").fill(`${role} Patient`);
    await page.getByLabel("Phone").fill("+15551110000");
    await page.getByRole("button", { name: /create patient/i }).click();
    await expect(page).toHaveURL(
      (url) => url.pathname.startsWith(`/${orgSlug}/patients/`) && !url.pathname.endsWith("/new")
    );
    await expect(page.getByTestId("patient-full-name")).toHaveText(`${role} Patient`);

    // Edit.
    await page.getByRole("link", { name: /edit/i }).click();
    const fullNameInput = page.getByLabel("Full name");
    await fullNameInput.fill("");
    await fullNameInput.fill(`${role} Patient Edited`);
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByTestId("patient-full-name")).toHaveText(`${role} Patient Edited`);

    // Archive.
    await page.getByRole("link", { name: /edit/i }).click();
    await page.getByRole("button", { name: /archive patient/i }).click();
    await expect(page.getByRole("button", { name: /unarchive patient/i })).toBeVisible();
  });
}
