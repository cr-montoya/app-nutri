import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

/**
 * T2.4, closes REQ-015. Seeds an ADMIN membership directly (same pattern as
 * login.spec.ts), logs in through the real UI, then exercises the team page
 * end to end against the real local Postgres: the ADMIN's own membership is
 * listed, an invite sent through the form shows up as pending, and revoking
 * it removes it from the pending list.
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const email = `e2e-team-admin-${runId}@example.test`;
const password = "a-valid-password-123";
let orgSlug: string;
const createdInviteEmails: string[] = [];

test.beforeAll(async () => {
  const passwordHash = await hash(password);
  const organization = await adminDb.organization.create({
    data: { name: `E2E Team ${runId}`, slug: `e2e-team-${runId}` },
  });
  orgSlug = organization.slug;
  const user = await adminDb.user.create({
    data: { email, name: "Team Admin E2E", passwordHash },
  });
  await adminDb.membership.create({
    data: { userId: user.id, organizationId: organization.id, role: "ADMIN" },
  });
});

test.afterAll(async () => {
  await adminDb.invite.deleteMany({ where: { email: { in: createdInviteEmails } } });
  await adminDb.membership.deleteMany({ where: { user: { email } } });
  await adminDb.user.deleteMany({ where: { email } });
  await adminDb.organization.deleteMany({ where: { slug: `e2e-team-${runId}` } });
  await adminDb.$disconnect();
});

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("ADMIN sees their own membership, sends an invite, and revokes it", async ({ page }) => {
  await login(page);

  await page.goto(`/${orgSlug}/team`);
  await expect(page.getByText("Team Admin E2E")).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("No pending invites.")).toBeVisible();

  const inviteeEmail = `e2e-team-invitee-${runId}@example.test`;
  createdInviteEmails.push(inviteeEmail);

  await page.getByLabel("Email", { exact: true }).fill(inviteeEmail);
  await page.getByLabel("Role").selectOption("NUTRITIONIST");
  await page.getByRole("button", { name: /send invite/i }).click();

  await expect(page.getByTestId("invite-url")).toBeVisible();
  await expect(page.getByText(inviteeEmail)).toBeVisible();

  const pendingInvite = await adminDb.invite.findFirstOrThrow({ where: { email: inviteeEmail } });
  expect(pendingInvite.acceptedAt).toBeNull();
  expect(pendingInvite.revokedAt).toBeNull();

  await page.getByRole("button", { name: /revoke/i }).click();
  await expect(page.getByText("No pending invites.")).toBeVisible();
  await expect(page.getByText(inviteeEmail)).not.toBeVisible();

  const revokedInvite = await adminDb.invite.findUniqueOrThrow({ where: { id: pendingInvite.id } });
  expect(revokedInvite.revokedAt).not.toBeNull();
});

test("a non-ADMIN membership gets a 404 on the team page", async ({ page }) => {
  const nonAdminEmail = `e2e-team-nonadmin-${runId}@example.test`;
  const passwordHash = await hash(password);
  const organization = await adminDb.organization.findUniqueOrThrow({ where: { slug: orgSlug } });
  const user = await adminDb.user.create({
    data: { email: nonAdminEmail, name: "Non Admin E2E", passwordHash },
  });
  await adminDb.membership.create({
    data: { userId: user.id, organizationId: organization.id, role: "FRONT_DESK" },
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill(nonAdminEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/$/);

  const response = await page.goto(`/${orgSlug}/team`);
  expect(response?.status()).toBe(404);

  await adminDb.membership.deleteMany({ where: { user: { email: nonAdminEmail } } });
  await adminDb.user.deleteMany({ where: { email: nonAdminEmail } });
});
