import { test, expect } from "@playwright/test";

/**
 * T3.3, closes REQ-016: an unauthenticated visitor requesting any workspace
 * route is redirected to /login instead of the route rendering. Middleware
 * (src/middleware.ts) enforces this before the route even resolves, so this
 * holds even though `[orgSlug]/dashboard` doesn't exist as a page yet
 * (T6.1/T6.2).
 */

test.describe("unauthenticated visitor, workspace routes", () => {
  test("redirects /some-org/dashboard to /login", async ({ page }) => {
    await page.goto("/some-org/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("redirects /some-org to /login", async ({ page }) => {
    await page.goto("/some-org");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("does not redirect the public landing page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
  });

  test("does not redirect /login itself (no redirect loop)", async ({ page }) => {
    // The /login page itself isn't built until T5.1; this only asserts
    // middleware doesn't loop-redirect a public path back to itself.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login$/);
  });
});
