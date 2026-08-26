# Requirements: Phase 0, Scaffold, Auth, Multi-Tenant Skeleton

## Objective

Stand up the Next.js/Prisma/Neon scaffold with working registration and login, and prove the two-layer multi-tenant isolation model (Prisma Client Extension + Postgres RLS) actually holds between two organizations before any real clinical feature is built on top of it. This includes a Vercel preview contract that consumes Neon's per-PR connection safely. This is the foundation every later phase depends on.

## User stories

- As a prospective user, I want to register and automatically get my own organization, so that I can start using AppNutri as its ADMIN without needing anyone else's approval.
- As a registered user, I want to log in securely, so that I can access my organization's workspace.
- As an authenticated user, I want to see a dashboard scoped to my organization, so that I can confirm the app recognizes my identity and tenant context correctly.
- As the platform, data belonging to one organization must never be visible to another, under any query path, so that a bug in one Server Action can't leak one clinic's data into another's.
- As the platform operator, I want each Vercel preview to use its own least-privilege Neon connection, so that preview deployments cannot bypass RLS or access another preview's database branch.

## Requirements

- **REQ-001**: WHEN a visitor submits the registration form with a valid email, a name between 1 and 100 characters after trimming whitespace, a password of at least 12 characters, and an organization name between 2 and 100 characters after trimming whitespace, THE SYSTEM SHALL create a new `User` (including that name), a new `Organization`, and a `Membership` linking them with role `ADMIN`.
- **REQ-002**: WHEN a visitor submits registration with an email that already has a `User` account, THE SYSTEM SHALL reject the registration with a clear error and SHALL NOT create any of the three records. THE SYSTEM SHALL ALWAYS enforce this via a unique database constraint on `User.email`, so two concurrent registration attempts with the same email can never both succeed; the losing request receives the same generic error.
- **REQ-003**: WHEN a visitor submits an email that does not match a valid email address format, THE SYSTEM SHALL reject the registration before creating any record.
- **REQ-004**: WHEN a visitor submits a password shorter than 12 characters, THE SYSTEM SHALL reject the registration before creating any record.
- **REQ-005**: WHEN a visitor submits a password found in the HIBP breached-password range API, THE SYSTEM SHALL reject the registration before creating any record.
- **REQ-006**: WHEN a visitor submits an organization name shorter than 2 characters or longer than 100 characters after trimming, THE SYSTEM SHALL reject the registration before creating any record.
- **REQ-007**: WHEN a visitor registers with an organization name whose generated slug collides with an existing organization's slug, THE SYSTEM SHALL disambiguate it by appending an incrementing numeric suffix (`-2`, `-3`, and so on, checking each candidate until one is free) rather than fail the registration.
- **REQ-008**: WHEN a registered user submits correct email and password at the login form, THE SYSTEM SHALL authenticate them and establish a session whose JWT carries their user id and their organization's id as the active-org claim.
- **REQ-009**: WHEN a user submits an incorrect password, THE SYSTEM SHALL reject the login with a generic error that does not reveal whether the email exists.
- **REQ-010**: THE SYSTEM SHALL ALWAYS hash passwords with argon2id, and SHALL ALWAYS avoid storing or logging a plaintext password anywhere, including error messages and application logs.
- **REQ-011**: THE SYSTEM SHALL ALWAYS expire a session's JWT after at most 8 hours, requiring re-authentication afterward.
- **REQ-012**: WHEN an authenticated session reads or writes `Membership` or `Professional` records, THE SYSTEM SHALL only return or affect rows whose `organizationId` matches the session's active organization, enforced by the Prisma tenant-context wrapper (`withTenant`).
- **REQ-013**: WHEN a query against `Membership` or `Professional` is issued directly against Postgres with the `app.current_org_id` session variable set to organization A, bypassing the Prisma tenant-context wrapper entirely, THE SYSTEM SHALL ALWAYS still return zero rows belonging to organization B, enforced by Row-Level Security policies.
- **REQ-014**: WHEN an authenticated user visits the dashboard route, THE SYSTEM SHALL display a page showing their organization's name and their own role, with no patient or clinical data (none exists yet in this phase).
- **REQ-015**: WHEN an authenticated user logs out, THE SYSTEM SHALL invalidate their session and redirect them to the login page.
- **REQ-016**: WHEN an unauthenticated visitor requests any route under the organization workspace, THE SYSTEM SHALL redirect them to the login page instead of rendering the route.
- **REQ-017**: WHEN an authenticated user requests a workspace route under an organization slug that is not their own organization's, THE SYSTEM SHALL respond with the same 404 used for a slug that doesn't exist at all, rendering no part of that route including layout data. THE SYSTEM SHALL NOT distinguish "wrong organization" from "no such organization" in the response, for the same enumeration-prevention reason as REQ-009.
- **REQ-018**: THE SYSTEM SHALL ALWAYS support invalidating all of a user's active sessions by incrementing a `tokenVersion` field checked on every session read; no UI trigger for this ships in this phase, only the mechanism.
- **REQ-019**: WHEN a pull request is opened against `main`, THE SYSTEM SHALL deploy a Vercel preview environment backed by a per-PR Neon database branch.
- **REQ-020**: THE SYSTEM SHALL ALWAYS enforce at most one `Membership` per `User`, at the database level, not only in application code. This makes "one organization per user" (see Out of scope) an actual constraint, not just an assumption the UI happens not to violate yet.
- **REQ-021**: WHEN a visitor submits a name shorter than 1 character (empty after trimming) or longer than 100 characters, THE SYSTEM SHALL reject the registration before creating any record.
- **REQ-022**: WHEN the application runs in a Vercel Preview or Production environment, THE SYSTEM SHALL use the Neon integration's `DATABASE_URL` as its runtime database connection and SHALL fail before serving a request when that variable is absent.
- **REQ-023**: THE SYSTEM SHALL ALWAYS require the `DATABASE_URL` supplied to Vercel by the Neon integration to authenticate as the non-owner, non-`BYPASSRLS` role `appnutri_app`; the owner connection used for Prisma migrations SHALL NOT be available to the deployed application runtime.
- **REQ-024**: WHEN a pull request preview is deployed, THE SYSTEM SHALL connect through `DATABASE_URL` to the Neon branch created for that preview and SHALL successfully serve the registration page without a missing-database-connection error.

## Out of scope

- Multiple organization memberships per user, and the organization switcher UI (`plan.md` §10.5, resolved for v1: one organization per user; to be revisited if a real multi-org scenario emerges).
- Inviting another user to join an existing organization, or changing/removing a member's role (deferred to a later spec).
- Google OAuth (Credentials only in this phase).
- Email verification and password reset (no email-sending provider has been chosen yet).
- MFA/TOTP, authentication rate limiting, field-level encryption, and the Habeas Data consent flow (all explicitly Phase 5 in `plan.md` §8).
- Production Vercel deployment pipeline; only PR preview deploys are required in this phase.
- Automating Prisma migrations from Vercel or GitHub Actions. The Neon base branch is migrated by an operator before it becomes the parent for preview branches; a later infrastructure spec will automate future migration promotion.
- Any `Patient`, `ClinicalHistory`, `Appointment`, `Consultation`, or related UI (Phase 1 and later).
- A user-facing path that creates a `Professional` record. Which membership roles can hold a `Professional` profile, and the UI to create one, are defined in a later spec (`phase-1a-team-invites`). The model and its RLS policy are still implemented and tested in this phase, exercised with seed data inserted directly, not through a UI flow.
