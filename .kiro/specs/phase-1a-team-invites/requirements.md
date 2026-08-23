# Requirements: Phase 1a, Team Invites and Professional Profiles

## Objective

Let an organization grow beyond its solo ADMIN: the ADMIN can invite a `NUTRITIONIST` or `FRONT_DESK` member via a shareable link (no email-sending infrastructure yet), and any `ADMIN` or `NUTRITIONIST` membership can attach a `Professional` profile to themselves. This unblocks Phase 1's appointments work, which needs at least one real professional to assign appointments to.

## User stories

- As an ADMIN, I want to invite someone by email to join my organization with a specific role, so that my clinic can have more than just me.
- As an invited person, I want to accept an invite and set my own password, so that I can start using AppNutri under my organization.
- As an ADMIN running a solo practice, I want to add my own professional profile, so that I can be assigned as the treating professional on appointments.

## Requirements

- **REQ-001**: WHEN an ADMIN submits an invite with a valid email and a role (`ADMIN`, `NUTRITIONIST`, or `FRONT_DESK`), THE SYSTEM SHALL create a pending `Invite` record with a unique token and generate a shareable link containing that token.
- **REQ-002**: WHEN an ADMIN submits an invite with an email that does not match a valid email address format, THE SYSTEM SHALL reject it before creating any record.
- **REQ-003**: WHEN an ADMIN submits an invite for an email that already has a `User` account anywhere in the system, THE SYSTEM SHALL reject it with a clear error. One user can hold at most one `Membership` total, per `phase-0-scaffold`'s REQ-020, so an existing account can never accept a second invite.
- **REQ-004**: WHEN an ADMIN submits an invite for an email that already has a pending, unexpired, unrevoked invite in the same organization, THE SYSTEM SHALL reject it rather than create a duplicate.
- **REQ-005**: THE SYSTEM SHALL ALWAYS expire a pending invite exactly 7 days after creation.
- **REQ-006**: WHEN a visitor opens an invite link whose token is valid, unexpired, unrevoked, and not already accepted, THE SYSTEM SHALL show a form to set a name and password, with the invited email displayed but not editable.
- **REQ-007**: WHEN a visitor submits that form with a name shorter than 1 character (empty after trimming) or longer than 100 characters, THE SYSTEM SHALL reject it before creating any record.
- **REQ-008**: WHEN a visitor submits that form with a password shorter than 12 characters, THE SYSTEM SHALL reject it before creating any record.
- **REQ-009**: WHEN a visitor submits that form with a password found in the HIBP breached-password range API, THE SYSTEM SHALL reject it before creating any record.
- **REQ-010**: WHEN a visitor submits a valid name and password for a valid, not-yet-accepted invite, THE SYSTEM SHALL create a new `User`, a `Membership` linking them to the inviting organization with the invited role, and mark the `Invite` as accepted, all in one transaction that also re-checks the invite is still pending (not expired, revoked, or already accepted) at commit time.
- **REQ-011**: WHEN two invite-acceptance attempts for the same email race, THE SYSTEM SHALL ALWAYS let exactly one succeed, enforced by the `User.email` unique constraint from `phase-0-scaffold`; the losing request receives the same generic error as `phase-0-scaffold`'s REQ-002.
- **REQ-012**: WHEN an ADMIN revokes an invite at the same time a visitor is submitting its accept form, THE SYSTEM SHALL ALWAYS let exactly one of the two operations win: either the revoke commits first and the accept then fails per REQ-010's pending re-check, or the accept commits first and the revoke then has no pending invite left to act on.
- **REQ-013**: WHEN a visitor opens an invite link whose token is expired, revoked, or already accepted, THE SYSTEM SHALL show the same generic invalid-invite error in all three cases and SHALL NOT create any record.
- **REQ-014**: WHEN an ADMIN revokes a pending invite, THE SYSTEM SHALL invalidate its token immediately; any later visit to that invite's link behaves per REQ-013.
- **REQ-015**: WHEN an ADMIN views their organization's member list, THE SYSTEM SHALL show every `Membership` and every pending `Invite` belonging to their organization, and none belonging to any other organization.
- **REQ-016**: WHEN a `NUTRITIONIST` or `FRONT_DESK` membership attempts to send an invite, revoke an invite, or view the member list, THE SYSTEM SHALL reject the action.
- **REQ-017**: WHEN a `Membership` with role `ADMIN` or `NUTRITIONIST` submits a professional profile form (license number, specialty), THE SYSTEM SHALL create or update the `Professional` record linked to that membership.
- **REQ-018**: WHEN a `Membership` with role `FRONT_DESK` attempts to submit a professional profile, THE SYSTEM SHALL reject it.
- **REQ-019**: WHEN a membership requests to view or edit a `Professional` profile that is not linked to their own membership, THE SYSTEM SHALL reject the request, including for an ADMIN acting on another member's profile.
- **REQ-020**: WHEN an authenticated session reads or writes `Invite` or `Professional` records, THE SYSTEM SHALL only return or affect rows whose `organizationId` matches the session's active organization, enforced by the `withTenant` wrapper.
- **REQ-021**: WHEN a query against `Invite` or `Professional` is issued directly against Postgres with `app.current_org_id` set to organization A, bypassing the Prisma tenant-context wrapper entirely, THE SYSTEM SHALL ALWAYS still return zero rows belonging to organization B, enforced by Row-Level Security policies.

## Out of scope

- Automatic email delivery of the invite link. The ADMIN shares the link manually through whatever channel they choose; sending it automatically is a later spec once an email provider is chosen.
- Changing an existing accepted member's role, or removing/deactivating a member. Only inviting new members and revoking still-pending invites are in scope.
- Resending an invite. If a link is lost or an invite needs to change, the ADMIN revokes it (REQ-014) and creates a new one.
- An ADMIN editing another member's `Professional` profile on their behalf (REQ-019 explicitly blocks this); each person manages their own.
