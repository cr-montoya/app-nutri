-- Formalizes the non-superuser, non-owner application role (T2.3's
-- database-architect review: without this, RLS enforces nothing, since a
-- table owner/superuser bypasses it unconditionally) as a migration
-- instead of the ad hoc `psql` session it was originally created with
-- locally. Idempotent so it's safe to run against a fresh database (a new
-- Neon branch, CI, or this local Postgres again) or one where the role
-- already exists.
--
-- No password is set here: CREATE ROLE ... PASSWORD would put a secret in
-- a file committed to git. After this migration runs against a fresh
-- database, an operator must separately run
-- `ALTER ROLE appnutri_app PASSWORD '<secret>'` (or the equivalent Neon
-- role-management step) before APP_DATABASE_URL can actually connect.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'appnutri_app') THEN
    CREATE ROLE appnutri_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO appnutri_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO appnutri_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO appnutri_app;

-- Narrow, auditable RLS bypass for the one legitimate case that needs it:
-- login (src/lib/auth-core.ts's authorizeCredentials) has to look up which
-- organization a user belongs to *before* any tenant session context
-- exists to scope that lookup by -- the same chicken-and-egg bootstrap
-- problem registerAction has on the write side (see the "set_config" call
-- added in registerAction's transaction), except here there is no org id
-- yet to SET LOCAL to, because the whole point of this query is to find it.
--
-- A SECURITY DEFINER function is the standard, minimal-privilege way to
-- grant exactly this one read without giving the app role broader access:
-- it runs as its owner (the migration/table-owning role, exempt from RLS
-- as the table owner, same as any other query that role runs), but the
-- app role can only ever get organizationId/role for a specific userId out
-- of it, not query memberships freely.
CREATE FUNCTION get_membership_for_login(p_user_id TEXT)
RETURNS TABLE("organizationId" TEXT, "role" "Role")
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT "organizationId", "role" FROM memberships WHERE "userId" = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION get_membership_for_login(TEXT) TO appnutri_app;
