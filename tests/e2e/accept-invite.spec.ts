import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

/**
 * T3.7, exercises REQ-006, REQ-009 through REQ-013 through the actual UI,
 * against the real local Postgres (Docker, standing in for a Neon dev
 * branch). Same pattern as tests/e2e/register.spec.ts/team-page.spec.ts: an
 * ADMIN + org + a pending Invite are seeded directly, since there is no
 * email-sending infrastructure to click a real link from
 * (requirements.md's "Out of scope").
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const createdEmails: string[] = [];

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

let orgId: string;

test.beforeAll(async () => {
  const organization = await adminDb.organization.create({
    data: { name: `E2E Accept Invite ${runId}`, slug: `e2e-accept-invite-${runId}` },
  });
  orgId = organization.id;
});

test.afterAll(async () => {
  await adminDb.membership.deleteMany({ where: { user: { email: { in: createdEmails } } } });
  await adminDb.invite.deleteMany({ where: { organizationId: orgId } });
  await adminDb.user.deleteMany({ where: { email: { in: createdEmails } } });
  await adminDb.organization.deleteMany({ where: { id: orgId } });
  await adminDb.$disconnect();
});

async function seedInvite(email: string, role: "ADMIN" | "NUTRITIONIST" | "FRONT_DESK" = "NUTRITIONIST") {
  const rawToken = randomBytes(32).toString("hex");
  await adminDb.invite.create({
    data: {
      email,
      role,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      organizationId: orgId,
    },
  });
  return rawToken;
}

test("shows the invited email read-only, accepts the invite, and redirects to /login", async ({ page }) => {
  const email = `e2e-accept-invite-${runId}@example.test`;
  createdEmails.push(email);
  const rawToken = await seedInvite(email, "NUTRITIONIST");

  await page.goto(`/invite/${rawToken}`);

  await expect(page.getByLabel("Email")).toHaveValue(email);
  await expect(page.getByLabel("Email")).toBeDisabled();

  await page.getByLabel("Name", { exact: true }).fill("Invited E2E Nutritionist");
  await page.getByLabel("Password").fill("a-valid-password-123");
  await page.getByRole("button", { name: /accept invite/i }).click();

  await expect(page).toHaveURL(/\/login$/);

  const user = await adminDb.user.findUniqueOrThrow({ where: { email } });
  expect(user.name).toBe("Invited E2E Nutritionist");

  const membership = await adminDb.membership.findUniqueOrThrow({ where: { userId: user.id } });
  expect(membership.organizationId).toBe(orgId);
  expect(membership.role).toBe("NUTRITIONIST");

  const invite = await adminDb.invite.findFirstOrThrow({ where: { email } });
  expect(invite.acceptedAt).not.toBeNull();
});

test("shows the generic invalid-invite error for a garbage token, without crashing", async ({ page }) => {
  const response = await page.goto("/invite/not-a-real-token-at-all");

  expect(response?.status()).toBe(200);
  await expect(page.getByText("This invite link is invalid or has expired.")).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
});

test("a revoked invite shows the same generic error", async ({ page }) => {
  const email = `e2e-accept-invite-revoked-${runId}@example.test`;
  createdEmails.push(email);
  const rawToken = await seedInvite(email);
  await adminDb.invite.updateMany({ where: { email }, data: { revokedAt: new Date() } });

  await page.goto(`/invite/${rawToken}`);

  await expect(page.getByText("This invite link is invalid or has expired.")).toBeVisible();
});

test("an already-accepted membership can log in with the password they set", async ({ page }) => {
  const email = `e2e-accept-invite-login-${runId}@example.test`;
  createdEmails.push(email);
  const rawToken = await seedInvite(email, "FRONT_DESK");

  await page.goto(`/invite/${rawToken}`);
  await page.getByLabel("Name", { exact: true }).fill("Front Desk E2E");
  await page.getByLabel("Password").fill("a-valid-password-123");
  await page.getByRole("button", { name: /accept invite/i }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-valid-password-123");
  await page.getByRole("button", { name: /log in/i }).click();

  await expect(page).toHaveURL(/\/$/);
});
