# Design: Phase 1b, Patients

## Architecture touched

Two new tenant-scoped models (`Patient`, and `AuditLog` which turns out not to exist yet in any approved spec, see below), the first real implementation of `src/lib/audit.ts`'s `logAudit()`, and new routes under `(app)/[orgSlug]/patients/`. Specialist personas applied: `database-architect.md` (schema, RLS, search-index performance) and `nextjs-architect.md` (routing, and this phase is `nextjs-architect.md`'s own named example for streaming).

**Correction found during this design**: `AuditLog` was described in `plan.md` §4 but was never actually added to a Prisma schema in `phase-0-scaffold` or `phase-1a-team-invites`; it only ever existed as prose. This spec adds it for real, since it's the first spec that actually needs to write to it.

## Schema (database-architect)

```prisma
enum Sex { MALE FEMALE }

model Patient {
  id             String    @id @default(cuid())
  organizationId String
  fullName       String
  phone          String
  documentId     String?
  birthDate      DateTime?
  sex            Sex?
  email          String?
  address        String?
  archivedAt     DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  organization   Organization @relation(fields: [organizationId], references: [id])
  @@unique([organizationId, documentId])
  @@index([organizationId])
  @@map("patients")
}
```

```prisma
model AuditLog {
  id             String   @id @default(cuid())
  organizationId String
  userId         String?
  action         String
  entityType     String
  entityId       String
  metadata       Json?
  ipAddress      String?
  createdAt      DateTime @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id])
  user           User?        @relation(fields: [userId], references: [id])
  @@index([organizationId, entityType, entityId])
  @@index([organizationId, createdAt])
  @@map("audit_logs")
}
```

`Organization`'s schema gains two back-relations: `patients Patient[]` and `auditLogs AuditLog[]`. `User`'s schema gains `auditLogs AuditLog[]`. Same reason as `phase-1a-team-invites`'s `invites` relation: Prisma requires both sides declared. `userId` is nullable on `AuditLog` because a future system-initiated action (a scheduled job, for instance) might log without a human actor; every action in this spec always supplies it.

Design decisions:

- **`@@unique([organizationId, documentId])` on a nullable column.** Postgres unique constraints treat `NULL` as distinct from every other `NULL`, so any number of patients with no `documentId` coexist freely, while any two with the same non-null `documentId` in the same org collide. This is exactly REQ-005/REQ-006/REQ-007's behavior with no extra application-layer logic needed.
- **`sex` reuses a two-value `MALE`/`FEMALE` enum**, matching the sex dimension already used by the calc-engine protocols in `plan.md` §5 (`applicableSex: Sex[] | 'both'`). Naming it `Sex` here anticipates that the calc-engine's future TypeScript `Sex` type and this Prisma enum should have matching values when Phase 2 wires them together; not a hard requirement of this spec, but worth not contradicting.
- **Search needs a trigram index, not just a B-tree.** REQ-017's case-insensitive partial-match name search (`ILIKE '%query%'`) can't use a standard B-tree index (a leading wildcard defeats it), which would force a sequential scan and violate `database-architect.md`'s <50ms target as the patient list grows. The migration adds:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX patients_full_name_trgm_idx ON patients USING gin ("fullName" gin_trgm_ops);
```

The exact-match `documentId` search in the same requirement already benefits from a standard index (added below via RLS-adjacent indexing, see next section), no special handling needed there.

## RLS policy (database-architect checklist)

```sql
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patients
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs
  USING ("organizationId" = current_setting('app.current_org_id', true));
```

No pre-authentication exception is needed here (unlike `phase-1a-team-invites`'s `Invite`); every `Patient` action requires an authenticated session per REQ-019, and every `AuditLog` write happens from inside an already-tenant-scoped action.

- [x] `ENABLE ROW LEVEL SECURITY` present on both tables.
- [x] Both policies reference `current_setting`, set server-side only.
- [x] Positive test (task): a session scoped to org A reads/writes its own patients, and reads its own audit logs. Satisfies REQ-019. (`tests/integration/patient-rls-positive.test.ts`)
- [x] Negative test (task): a raw `pg` client scoped to org A gets zero rows querying org B's patients or audit logs directly. Satisfies REQ-020. (`tests/integration/patient-rls-negative.test.ts`)
- [x] Policy overhead: `organizationId` is indexed on both tables (`@@index`); the trigram index above keeps the name-search path indexed too, so the RLS filter and the search filter both hit indexes, not a sequential scan.

## Routing and rendering (nextjs-architect)

`nextjs-architect.md` names the patient list by name as a primary streaming candidate; this design follows that directly rather than defaulting to it without checking.

| Route | Rendering | Data fetching | Streaming |
|---|---|---|---|
| `(app)/[orgSlug]/patients/page.tsx` | Server Component shell (search box, "new patient" button) renders immediately; the list itself is a separate async Server Component | Shell: none. List: direct fetch, `organizationId` + archived-filter + search-query scoped | Yes: the list is wrapped in `<Suspense>` with a skeleton fallback, so the shell paints before the query resolves |
| `(app)/[orgSlug]/patients/new/page.tsx` | Server-rendered shell, Client Component form | `createPatientAction` Server Action | No |
| `(app)/[orgSlug]/patients/[patientId]/page.tsx` | Server Component | Direct fetch by id, scoped to session's org; triggers the REQ-022 audit-log write | No; a single-row fetch, no streaming benefit |
| `(app)/[orgSlug]/patients/[patientId]/edit/page.tsx` | Server-rendered shell, Client Component form | `updatePatientAction` Server Action | No |

Search and the archived-filter are both plain URL search params (`?q=&archived=`) read by the list Server Component, not client-side state; this keeps the list a server-rendered, linkable, back-button-friendly view rather than a client-fetched one, consistent with `nextjs-architect.md`'s default-to-Server-Components guidance.

`archivePatientAction`/`unarchivePatientAction` revalidate exactly `(app)/[orgSlug]/patients` and the specific `[patientId]` path via `revalidatePath`, per `nextjs-architect.md`'s scoped-revalidation guidance, not a broader invalidation.

## Requirement coverage

| REQ | Covered by |
|---|---|
| REQ-001 | `createPatientAction` in `src/server/actions/patients.ts` |
| REQ-002 | Zod length validation on `fullName` in `src/validation/patients.ts` |
| REQ-003 | Zod regex validation on `phone` (E.164-style) in the same file |
| REQ-004 | Zod length validation on `documentId` (when present) |
| REQ-005 | `documentId` unique-constraint violation caught in `createPatientAction`, generic error |
| REQ-006 | `@@unique([organizationId, documentId])` in the schema above |
| REQ-007 | Same unique constraint; concurrent requests resolve via the database, not application-level locking |
| REQ-008 | Zod refinement rejecting a future `birthDate` (when present) |
| REQ-009 | Zod email validation (when present), same pattern as `phase-0-scaffold` |
| REQ-010 | Zod enum validation on `sex` (when present) |
| REQ-011 | Zod length validation on `address` (when present) |
| REQ-012 | `updatePatientAction` reuses the same Zod schema as `createPatientAction` |
| REQ-013 | `archivePatientAction`: sets `archivedAt: new Date()` |
| REQ-014 | `unarchivePatientAction`: sets `archivedAt: null` |
| REQ-015 | List query default: `where: { archivedAt: null }` |
| REQ-016 | List query with `?archived=true`: `where: {}` (no `archivedAt` filter), UI renders an "Archived" badge per row |
| REQ-017 | List query: `OR` of `fullName ILIKE %query%` and `documentId = query`, combined with the archived filter |
| REQ-018 | `[patientId]/page.tsx` direct fetch |
| REQ-019 | `withTenant` on every `Patient` read/write |
| REQ-020 | RLS policy above |
| REQ-021 | `logAudit()` call (first real implementation, see below) inside every mutating Server Action |
| REQ-022 | `logAudit()` call inside `[patientId]/page.tsx`'s fetch |
| REQ-023 | No `requireRole` call restricts any Patient action; any authenticated member of the org can act. `rbac.ts`'s `requireRole` stub is deliberately not invoked here, since this phase's Requirements explicitly state no role is restricted |

## `logAudit()` (new, not reused)

This spec builds both the `AuditLog` model (see correction above) and `src/lib/audit.ts`'s first real implementation:

```ts
async function logAudit(params: {
  action: string; entityType: string; entityId: string;
  userId: string; organizationId: string;
  ipAddress?: string; metadata?: Record<string, unknown>;
}): Promise<void>
```

`ipAddress` is read from the `x-forwarded-for` request header (via `headers()` from `next/headers`) inside the Server Action, since Vercel sits in front of the app as a proxy; it's optional in the signature because it isn't always resolvable (for instance, in a unit test with no real request). Called with `action: 'patient.create' | 'patient.update' | 'patient.archive' | 'patient.unarchive' | 'patient.view'`, matching REQ-021/REQ-022. Every later phase that needs audit logging (`ClinicalHistory`, `Consultation`, and so on, per `plan.md` §4) calls this same helper; it is not reimplemented per-entity.

## Files to create or update

```
prisma/schema.prisma                                    # update: Patient model, AuditLog model, Sex enum, back-relations
prisma/migrations/.../migration.sql                       # generated; includes RLS + pg_trgm index, added manually
src/lib/audit.ts                                           # new: logAudit()
src/validation/patients.ts                                 # new: Zod schemas (create/update share one shape)
src/server/actions/patients.ts                              # new: createPatientAction, updatePatientAction, archivePatientAction, unarchivePatientAction
src/app/(app)/[orgSlug]/patients/page.tsx                   # new: shell + Suspense-wrapped list
src/app/(app)/[orgSlug]/patients/new/page.tsx               # new
src/app/(app)/[orgSlug]/patients/[patientId]/page.tsx       # new
src/app/(app)/[orgSlug]/patients/[patientId]/edit/page.tsx  # new
```

## Multi-tenant isolation and RBAC impact

`Patient` is a new tenant-scoped table; both isolation layers apply (REQ-019, REQ-020). RBAC: no role restriction in this phase (REQ-023), a deliberate, documented choice, not an oversight, since `Patient` currently holds only demographic fields. `src/lib/rbac.ts`'s `requireRole` stub (built in `phase-1a-team-invites`) is not called by any action in this spec; its next real caller is expected in Phase 2, once `ClinicalHistory` needs to exclude `FRONT_DESK`.

## Reused vs. new

Reused from `phase-0-scaffold`/`phase-1a-team-invites`: `withTenant`, the RLS policy shape, the Server Action + Zod validation pattern, the `(app)/[orgSlug]/*` route convention, `revalidatePath` scoping. New: the `Patient` model, the `AuditLog` model (found missing and added during this design, see above), the `pg_trgm` search index (first use of a non-default Postgres extension in this project), `logAudit()`'s first real implementation, and the Suspense-streamed list pattern (first use of streaming in this project, per `nextjs-architect.md`'s own guidance).

## Deviations

Implementation-level refinements below `.agents/rules/adr-required.md`'s bar (routine choices inside an already-approved design, not new architecture decisions); none change a requirement's behavior or contradict this design's intent.

- **`logAudit(tx, params)` takes the caller's tenant-scoped client as an explicit first argument**, not shown in this document's abbreviated signature. `audit_logs` is RLS-protected (same as `patients`), so an insert needs `app.current_org_id` set on the *same* Postgres transaction via `SET LOCAL`; writing through a separate `withTenant` call inside `logAudit()` itself would run in a different transaction with no session variable set, and Postgres would reject the insert. Every call site passes the `tx` its own `withTenant` callback already has, so the audit write and the mutation it records share one transaction (and roll back together).
- **`src/lib/db.ts`'s `TENANT_SCOPED_MODELS` set gained `"Patient"` and `"AuditLog"`.** Not called out as its own task, but required by `.agents/rules/tenant-isolation.md`: without it, the Prisma Client Extension would silently skip injecting `organizationId` into every `Patient`/`AuditLog` query, even inside `withTenant`.
- **`patients_full_name_trgm_idx` is declared in `prisma/schema.prisma`** via `@@index([fullName(ops: raw("gin_trgm_ops"))], type: Gin, ...)`, in addition to the raw-SQL `CREATE INDEX` in the T1.3 migration. Without the schema-level declaration, `prisma migrate dev`'s schema diff proposed dropping the index (it had no corresponding schema entry); declaring it keeps future migrations from drifting.
- **`archivePatientAction`/`unarchivePatientAction` resolve the organization's slug via a direct `db.organization` read** (same pattern as `dashboard/page.tsx`) rather than taking `orgSlug` as a parameter, so `revalidatePath` can target the list and detail paths without changing the actions' public signature (already covered by T3.5's tests).
- **The patient list's row `<Link>` sets `prefetch={false}`.** Discovered via T5.1's e2e run: Next.js's default Link prefetching executed the detail page's Server Component (and its REQ-022 `logAudit` call) the moment a row scrolled into view, before any real click -- producing audit-log entries for views that never happened. Disabling prefetch for this one link is the documented Next.js mitigation for a route with a side effect on render.
- **`src/app/page.tsx`'s "Log in" link was changed from `<a href="/login">` to `<Link href="/login">`.** Pre-existing `pnpm lint` failure from `phase-0-scaffold`/`phase-1a-team-invites` (unrelated to this spec's own files), fixed here only because "pipeline green" (`pnpm lint` passing repo-wide) is this spec's closing gate.
- **`patientSchema` uses `z.union([<shape>, z.literal("")])` for optional fields, not `z.preprocess`; `patient-form.tsx` is wired to `zodResolver(patientSchema)`.** A `code-quality` gate finding: the first version of both files used `z.preprocess` to turn a blank field into "not provided," which made the schema's Zod input type diverge from its output type and broke `zodResolver`'s typing, so the form fell back to one generic server-error message with no inline per-field feedback -- inconsistent with `src/validation/team.ts`'s `updateProfessionalProfileSchema`, which had already solved the same problem the working way. `birthDate` is the one field the union approach doesn't fit (it needs real `Date` coercion, not just an empty-string carve-out); it stays a plain string in the schema and is parsed/future-checked by a new `parseBirthDate()` helper, called from the Server Action after `patientSchema.safeParse` succeeds -- still before any record is created or updated, so REQ-008 holds exactly as before, just enforced one layer later. The `P2002`/`P2025` Prisma-error-to-message mapping, duplicated across three functions, was also extracted into one `mapPatientPersistenceError()` helper per the same review's LOW finding.
