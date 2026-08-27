import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { getBogotaDayRange } from "@/validation/appointments";

/**
 * T4.9, closes REQ-028. design.md's `## Deviations` records this as an
 * automated Playwright check at a tablet viewport, not the manual check
 * `tasks.md` originally assumed: asserting a rendered element's bounding
 * box at a fixed viewport is a standard, repeatable Playwright assertion,
 * strictly more reliable than a human eyeballing a screenshot once for the
 * PR description. Verified with 3 professional columns visible, per
 * REQ-028's own wording.
 */

test.use({ viewport: { width: 1024, height: 768 } });

const MIN_HIT_AREA_PX = 44;

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const email = `e2e-touch-targets-${runId}@example.test`;
const password = "a-valid-password-123";
let orgSlug: string;
let orgId: string;

const { start: TODAY_START } = getBogotaDayRange();

test.beforeAll(async () => {
  const passwordHash = await hash(password);
  const organization = await adminDb.organization.create({
    data: { name: `E2E Touch Targets ${runId}`, slug: `e2e-touch-targets-${runId}` },
  });
  orgSlug = organization.slug;
  orgId = organization.id;
  const user = await adminDb.user.create({ data: { email, name: "Touch Targets E2E", passwordHash } });
  await adminDb.membership.create({ data: { userId: user.id, organizationId: orgId, role: "ADMIN" } });

  const professionalNames = ["Dr. One", "Dr. Two", "Dr. Three"];
  const professionalIds: string[] = [];
  for (const name of professionalNames) {
    const profUser = await adminDb.user.create({
      data: { email: `e2e-touch-targets-${name.replace(/\W/g, "")}-${runId}@example.test`, name, passwordHash },
    });
    const membership = await adminDb.membership.create({
      data: { userId: profUser.id, organizationId: orgId, role: "NUTRITIONIST" },
    });
    const professional = await adminDb.professional.create({
      data: { membershipId: membership.id, organizationId: orgId, licenseNumber: `LIC-${name}-${runId}` },
    });
    professionalIds.push(professional.id);
  }

  const patient = await adminDb.patient.create({
    data: { organizationId: orgId, fullName: "Touch Target Patient", phone: "+15550004444" },
  });

  await adminDb.appointment.create({
    data: {
      organizationId: orgId,
      patientId: patient.id,
      professionalId: professionalIds[0],
      startAt: new Date(TODAY_START.getTime() + 4 * 60 * 60_000),
      endAt: new Date(TODAY_START.getTime() + 4.5 * 60 * 60_000),
      status: "SCHEDULED",
    },
  });
});

test.afterAll(async () => {
  await adminDb.appointment.deleteMany({ where: { organizationId: orgId } });
  await adminDb.patient.deleteMany({ where: { organizationId: orgId } });
  await adminDb.professional.deleteMany({ where: { organizationId: orgId } });
  await adminDb.membership.deleteMany({ where: { organizationId: orgId } });
  await adminDb.user.deleteMany({ where: { email: { contains: `e2e-touch-targets-${runId}` } } });
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

test("calendar event chips and status/edit buttons meet the 44x44px minimum hit area with 3 professional columns (REQ-028)", async ({
  page,
}) => {
  await login(page);
  await page.goto(`/${orgSlug}/appointments`);

  await expect(page.getByText("Dr. One")).toBeVisible();
  await expect(page.getByText("Dr. Two")).toBeVisible();
  await expect(page.getByText("Dr. Three")).toBeVisible();

  const eventChip = page.locator(".fc-event", { hasText: "Touch Target Patient" }).first();
  await expect(eventChip).toBeVisible();
  const eventBox = await eventChip.boundingBox();
  expect(eventBox).not.toBeNull();
  expect(eventBox!.height).toBeGreaterThanOrEqual(MIN_HIT_AREA_PX);
  expect(eventBox!.width).toBeGreaterThanOrEqual(MIN_HIT_AREA_PX);

  await eventChip.click();
  const editButton = page.getByRole("button", { name: "Edit" });
  await expect(editButton).toBeVisible();
  const editBox = await editButton.boundingBox();
  expect(editBox).not.toBeNull();
  expect(editBox!.height).toBeGreaterThanOrEqual(MIN_HIT_AREA_PX);

  const statusButtons = page.getByText("Change status").locator("..").getByRole("button");
  const count = await statusButtons.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = await statusButtons.nth(i).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(MIN_HIT_AREA_PX);
  }
});
