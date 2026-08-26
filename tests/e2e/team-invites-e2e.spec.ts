import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

/**
 * T5.1, the spec's capstone. Confirms REQ-001, REQ-010, REQ-016 through
 * REQ-019 hold end to end, through the real UI, against the real local
 * Postgres: an ADMIN sends an invite, a genuinely separate unauthenticated
 * browser session (Playwright's `browser.newContext()`, not just navigating
 * away from the ADMIN's logged-in page) accepts it as a NUTRITIONIST, and
 * that new user can manage their own professional profile but has no way to
 * reach the ADMIN's, or the team-management page.
 *
 * The ADMIN + organization are seeded directly (same pattern as
 * tests/e2e/team-page.spec.ts) since registration itself is already covered
 * by tests/e2e/register.spec.ts and isn't the point of this test; everything
 * from "send the invite" onward is driven through the browser.
 */

const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const runId = Date.now();
const adminEmail = `e2e-invites-admin-${runId}@example.test`;
const adminPassword = "a-valid-admin-password-1";
const inviteeEmail = `e2e-invites-nutritionist-${runId}@example.test`;
const inviteeName = "Invited Nutritionist E2E";
const inviteePassword = "a-valid-invitee-password-1";
let orgSlug: string;
let orgId: string;

test.beforeAll(async () => {
  const passwordHash = await hash(adminPassword);
  const organization = await adminDb.organization.create({
    data: { name: `E2E Team Invites ${runId}`, slug: `e2e-team-invites-${runId}` },
  });
  orgSlug = organization.slug;
  orgId = organization.id;
  const adminUser = await adminDb.user.create({
    data: { email: adminEmail, name: "Team Invites Admin E2E", passwordHash },
  });
  await adminDb.membership.create({
    data: { userId: adminUser.id, organizationId: organization.id, role: "ADMIN" },
  });
});

test.afterAll(async () => {
  await adminDb.professional.deleteMany({
    where: { membership: { user: { email: { in: [adminEmail, inviteeEmail] } } } },
  });
  await adminDb.invite.deleteMany({ where: { organizationId: orgId } });
  await adminDb.membership.deleteMany({
    where: { user: { email: { in: [adminEmail, inviteeEmail] } } },
  });
  await adminDb.user.deleteMany({ where: { email: { in: [adminEmail, inviteeEmail] } } });
  await adminDb.organization.deleteMany({ where: { id: orgId } });
  await adminDb.$disconnect();
});

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("ADMIN invites a NUTRITIONIST, who accepts, sets their own profile, and cannot reach the ADMIN's profile or the team page", async ({
  page: adminPage,
  browser,
}) => {
  // Step 1-2: ADMIN logs in and sends the invite.
  await login(adminPage, adminEmail, adminPassword);
  await adminPage.goto(`/${orgSlug}/team`);
  await adminPage.getByLabel("Email", { exact: true }).fill(inviteeEmail);
  await adminPage.getByLabel("Role").selectOption("NUTRITIONIST");
  await adminPage.getByRole("button", { name: /send invite/i }).click();

  const inviteUrlText = await adminPage.getByTestId("invite-url").innerText();
  const inviteUrl = inviteUrlText.replace(/^Invite link:\s*/, "").trim();
  expect(inviteUrl).toMatch(/^\/invite\/[0-9a-f]{64}$/);

  // The ADMIN also sets their own professional profile now, so step 6 below
  // has something concrete to prove the NUTRITIONIST never sees.
  await adminPage.goto(`/${orgSlug}/team/professional-profile`);
  await adminPage.getByLabel("License number").fill("ADMIN-ONLY-LIC");
  await adminPage.getByLabel("Specialty").fill("Admin-only specialty");
  await adminPage.getByRole("button", { name: /save profile/i }).click();
  await expect(adminPage.getByTestId("profile-saved")).toBeVisible();

  // Step 3: a genuinely separate, unauthenticated session opens the invite
  // link -- a fresh BrowserContext, not just a new tab off the ADMIN's page,
  // so there is no shared cookie jar/session with the ADMIN at all.
  const inviteeContext = await browser.newContext();
  const inviteePage = await inviteeContext.newPage();

  await inviteePage.goto(inviteUrl);
  await expect(inviteePage.getByLabel("Email")).toHaveValue(inviteeEmail);
  await expect(inviteePage.getByLabel("Email")).toBeDisabled();

  await inviteePage.getByLabel("Name", { exact: true }).fill(inviteeName);
  await inviteePage.getByLabel("Password").fill(inviteePassword);
  await inviteePage.getByRole("button", { name: /accept invite/i }).click();
  await expect(inviteePage).toHaveURL(/\/login$/);

  const inviteeUser = await adminDb.user.findUniqueOrThrow({ where: { email: inviteeEmail } });
  const inviteeMembership = await adminDb.membership.findUniqueOrThrow({
    where: { userId: inviteeUser.id },
  });
  expect(inviteeMembership.organizationId).toBe(orgId);
  expect(inviteeMembership.role).toBe("NUTRITIONIST"); // REQ-010

  // Step 4: log in as the newly-created NUTRITIONIST, same (still separate)
  // context.
  await login(inviteePage, inviteeEmail, inviteePassword);

  // Step 5: the NUTRITIONIST adds their own professional profile (REQ-017).
  await inviteePage.goto(`/${orgSlug}/team/professional-profile`);
  await inviteePage.getByLabel("License number").fill("NUTRI-OWN-LIC");
  await inviteePage.getByLabel("Specialty").fill("Nutritionist's own specialty");
  await inviteePage.getByRole("button", { name: /save profile/i }).click();
  await expect(inviteePage.getByTestId("profile-saved")).toBeVisible();

  const savedProfessional = await adminDb.professional.findUniqueOrThrow({
    where: { membershipId: inviteeMembership.id },
  });
  expect(savedProfessional.licenseNumber).toBe("NUTRI-OWN-LIC");
  expect(savedProfessional.specialty).toBe("Nutritionist's own specialty");

  // Step 6 (REQ-019): the professional-profile page has no picker and no
  // other member's fields ever render -- it only ever shows the values just
  // submitted above, never the ADMIN's "ADMIN-ONLY-LIC" / "Admin-only
  // specialty". This is an end-to-end wiring check, not a re-derivation of
  // the isolation guarantee itself: updateProfessionalProfileAction (T4.1)
  // takes no id input at all (src/validation/team.ts's
  // updateProfessionalProfileSchema has no membershipId/professionalId
  // field), so there is no request this page's form could ever construct
  // that targets a profile other than the caller's own. That structural
  // guarantee is proven directly in
  // tests/integration/professional-profile.test.ts's dedicated REQ-019 case
  // (two memberships, only the caller's row changes); this assertion just
  // confirms the ADMIN's data never reaches the NUTRITIONIST's rendered DOM.
  await inviteePage.reload();
  await expect(inviteePage.getByLabel("License number")).toHaveValue("NUTRI-OWN-LIC");
  await expect(inviteePage.getByLabel("Specialty")).toHaveValue("Nutritionist's own specialty");
  await expect(inviteePage.getByText("ADMIN-ONLY-LIC")).toHaveCount(0);
  await expect(inviteePage.getByText("Admin-only specialty")).toHaveCount(0);

  // Step 7 (REQ-016): the NUTRITIONIST cannot reach the team-management page
  // either -- same 404 a FRONT_DESK visitor gets (T2.4's team-page.spec.ts).
  const teamResponse = await inviteePage.goto(`/${orgSlug}/team`);
  expect(teamResponse?.status()).toBe(404);

  await inviteeContext.close();
});
