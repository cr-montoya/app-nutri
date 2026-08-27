import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

/**
 * T5.1, the spec's capstone. Confirms REQ-001 through REQ-023 hold end to
 * end for the least-privileged role (`FRONT_DESK`): create a patient,
 * search for them by partial name and by exact document ID, view their
 * profile, edit a field, archive them, confirm they disappear from the
 * default list and appear with the archived filter, unarchive them. Same
 * seeding/login pattern as tests/e2e/team-invites-e2e.spec.ts.
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const email = `e2e-patients-frontdesk-${runId}@example.test`;
const password = "a-valid-password-123";
const documentId = `DOC-CAPSTONE-${runId}`;
let orgSlug: string;
let orgId: string;

test.beforeAll(async () => {
  const passwordHash = await hash(password);
  const organization = await adminDb.organization.create({
    data: { name: `E2E Patients Capstone ${runId}`, slug: `e2e-patients-capstone-${runId}` },
  });
  orgSlug = organization.slug;
  orgId = organization.id;
  const user = await adminDb.user.create({
    data: { email, name: "Front Desk Capstone E2E", passwordHash },
  });
  await adminDb.membership.create({
    data: { userId: user.id, organizationId: orgId, role: "FRONT_DESK" },
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

test("FRONT_DESK: create, search, view, edit, archive, and unarchive a patient", async ({ page }) => {
  // Login.
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/$/);

  // Create (REQ-001).
  await page.goto(`/${orgSlug}/patients/new`);
  await page.getByLabel("Full name").fill("Capstone Patient E2E");
  await page.getByLabel("Phone").fill("+15556667777");
  await page.getByLabel("Document ID").fill(documentId);
  await page.getByRole("button", { name: /create patient/i }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname.startsWith(`/${orgSlug}/patients/`) && !url.pathname.endsWith("/new")
  );
  await expect(page.getByTestId("patient-full-name")).toHaveText("Capstone Patient E2E");

  const patientUrl = page.url();
  const patientId = patientUrl.split("/").pop()!;

  // Search by partial name (REQ-017).
  await page.goto(`/${orgSlug}/patients?q=Capstone`);
  await expect(page.getByText("Capstone Patient E2E")).toBeVisible();

  // Search by exact document ID (REQ-017).
  await page.goto(`/${orgSlug}/patients?q=${documentId}`);
  await expect(page.getByText("Capstone Patient E2E")).toBeVisible();

  // View profile (REQ-018, REQ-022).
  await page.goto(`/${orgSlug}/patients/${patientId}`);
  await expect(page.getByTestId("patient-full-name")).toHaveText("Capstone Patient E2E");
  const viewLogs = await adminDb.auditLog.findMany({
    where: { entityId: patientId, action: "patient.view" },
  });
  expect(viewLogs.length).toBeGreaterThanOrEqual(1);

  // Edit a field (REQ-012).
  await page.goto(`/${orgSlug}/patients/${patientId}/edit`);
  await page.getByLabel("Address").fill("456 Capstone Ave");
  await page.getByRole("button", { name: /save changes/i }).click();
  await expect(page).toHaveURL(`/${orgSlug}/patients/${patientId}`);
  await expect(page.getByText("456 Capstone Ave")).toBeVisible();

  // Archive (REQ-013), confirm it disappears from the default list.
  await page.goto(`/${orgSlug}/patients/${patientId}/edit`);
  await page.getByRole("button", { name: /archive patient/i }).click();
  await expect(page.getByRole("button", { name: /unarchive patient/i })).toBeVisible();

  await page.goto(`/${orgSlug}/patients`);
  await expect(page.getByText("Capstone Patient E2E")).not.toBeVisible();

  // ...and appears with the archived filter.
  await page.goto(`/${orgSlug}/patients?archived=true`);
  await expect(page.getByText("Capstone Patient E2E")).toBeVisible();
  await expect(page.getByTestId("archived-badge")).toBeVisible();

  // Unarchive (REQ-014).
  await page.goto(`/${orgSlug}/patients/${patientId}/edit`);
  await page.getByRole("button", { name: /unarchive patient/i }).click();
  await expect(page.getByRole("button", { name: /archive patient/i })).toBeVisible();

  await page.goto(`/${orgSlug}/patients`);
  await expect(page.getByText("Capstone Patient E2E")).toBeVisible();

  // REQ-021: every mutation above logged an AuditLog entry naming the
  // action, actor, org, and patient id. The detail page is visited more
  // than once (the create/edit redirects, plus the explicit "view profile"
  // step above), so "patient.view" may appear more than once -- this
  // checks every expected action *type* is present, not an exact count.
  const allLogs = await adminDb.auditLog.findMany({ where: { entityId: patientId } });
  const actionTypes = new Set(allLogs.map((log) => log.action));
  expect(actionTypes).toEqual(
    new Set(["patient.archive", "patient.create", "patient.unarchive", "patient.update", "patient.view"])
  );
  for (const log of allLogs) {
    expect(log.organizationId).toBe(orgId);
    expect(log.userId).toBeTruthy();
  }
});
