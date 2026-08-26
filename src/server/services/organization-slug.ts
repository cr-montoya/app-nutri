/**
 * REQ-007: base slug from an organization name, ASCII-folded and
 * hyphenated. The disambiguation suffix (`-2`, `-3`, ...) is appended by
 * the caller's loop (src/server/actions/auth.ts's `registerAction`), not
 * here.
 *
 * Kept out of src/server/actions/auth.ts: every export from a "use server"
 * file must be an async Server Action (Next.js requirement), and this is a
 * plain sync helper reused by both `registerAction` and its tests.
 */
export function slugify(organizationName: string): string {
  const slug = organizationName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "org";
}
