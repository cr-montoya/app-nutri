# Design: Phase 1d, Patient Attachments

## Architecture touched

One new tenant-scoped model (`PatientAttachment`), the first Route Handler in this project (justified: Vercel Blob's client-upload webhook, exactly the "webhook" exception `nextjs-architect.md` already carves out), and an update to `phase-1b-patients`'s existing patient detail page rather than a new page. Specialist personas applied: `database-architect.md` (schema, RLS) and `nextjs-architect.md` (routing, the Route Handler exception, and a second justified Client Component boundary for the upload button).

This is also `rbac.ts`'s first real caller (correcting `phase-1b-patients`'s design note, which expected `ClinicalHistory` in Phase 2 to be the first; it's actually here, one phase earlier).

## Schema (database-architect)

```prisma
model PatientAttachment {
  id             String   @id @default(cuid())
  organizationId String
  patientId      String
  blobPathname   String   @unique
  filename       String
  contentType    String
  sizeBytes      Int
  uploadedById   String
  createdAt      DateTime @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id])
  patient        Patient      @relation(fields: [patientId], references: [id])
  uploadedBy     User         @relation(fields: [uploadedById], references: [id])
  @@index([organizationId])
  @@index([patientId])
  @@map("patient_attachments")
}
```

`Organization`, `Patient`, and `User` each gain the corresponding back-relation (`patientAttachments PatientAttachment[]` or similarly named).

Design decisions:

- **`blobPathname`, not the full Blob URL, is stored.** Vercel Blob's private-storage pathname is the stable identifier used to mint a fresh signed URL on each view request (REQ-010); a stored URL would either be the private (inaccessible) form or, worse, a long-lived signed one that defeats REQ-010's 15-minute expiry.
- **The `PatientAttachment` record is only created after post-transfer validation passes** (REQ-003, REQ-005), from inside the upload webhook, not from the client-side upload call. This means the row's existence is itself the signal that a file passed every check; there's no "pending" or "invalid" state to track in the schema.
- **Magic-byte detection uses the `file-type` package** (pure JS/WASM, no native bindings), the same reasoning as ADR-0001's argon2 library choice: a native-binding alternative risks Vercel serverless cold-start and build issues, and this is a serverless function (the upload webhook) where that risk is exactly the one already avoided once in this project.

## RLS policy (database-architect checklist)

```sql
ALTER TABLE patient_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patient_attachments
  USING ("organizationId" = current_setting('app.current_org_id', true));
```

- [x] `ENABLE ROW LEVEL SECURITY` present.
- [x] Policy references `current_setting`, set server-side only.
- [ ] Positive test (task): a session scoped to org A reads/writes its own attachment records. Satisfies REQ-013.
- [ ] Negative test (task): a raw `pg` client scoped to org A gets zero rows querying org B's attachment records directly. Satisfies REQ-014.
- [x] Policy overhead: `organizationId` and `patientId` are both indexed.

Row-level security governs the `PatientAttachment` *metadata* table; it says nothing about the underlying Blob object's own access control, which is governed separately by Vercel Blob's private-storage mode and the signed-URL mechanism (REQ-010). Both layers matter: RLS stops a cross-org query for the record from succeeding at all, and even if it somehow did, the signed-URL requirement stops a raw `blobPathname` from being independently useful without a freshly minted, server-issued signature.

## Routing and rendering (nextjs-architect)

| Route | Rendering | Data fetching | Streaming |
|---|---|---|---|
| `(app)/[orgSlug]/patients/[patientId]/page.tsx` (update from `phase-1b-patients`) | Server Component (unchanged rendering strategy); adds an attachments section and, for `ADMIN`/`NUTRITIONIST` only, an upload button | Direct fetch of the patient's `PatientAttachment` list, appended to the existing patient fetch | No; unchanged from `phase-1b-patients` |
| `src/app/api/attachments/upload/route.ts` | Route Handler (the justified webhook exception) | `handleUpload` from `@vercel/blob/client`, implementing `onBeforeGenerateToken` and `onUploadCompleted` | N/A |

`onBeforeGenerateToken` runs synchronously in the same request as the client's token request: it authenticates the session, applies REQ-007 (`FRONT_DESK` rejected) and REQ-008 (patient must belong to the session's org) via `withTenant`, applies REQ-002/REQ-006's pre-transfer checks (declared content type, filename length), and returns the token with `allowedContentTypes` and `maximumSizeInBytes: 10_485_760` as Blob-enforced constraints (REQ-002/REQ-004's transfer-time enforcement), plus a `tokenPayload` carrying `{ patientId, organizationId, uploadedById }` as a JSON string, since `onUploadCompleted` fires as a server-to-server webhook with no user session to re-derive this context from. `handleUpload`'s own signature verification (using `BLOB_READ_WRITE_TOKEN`) confirms the webhook call actually came from Vercel Blob; no separate verification is written.

`onUploadCompleted` fetches the transferred blob's bytes, runs the `file-type` magic-byte check (REQ-003) and the 0-byte check (REQ-005); on failure, calls Vercel Blob's `del()` on the pathname and returns without touching the database; on success, creates the `PatientAttachment` row inside `withTenant` (using the `organizationId` from `tokenPayload`) and calls `logAudit()` (REQ-015).

The upload trigger itself (the file `<input>` and the call to `@vercel/blob/client`'s `upload()`) is a Client Component, a second justified exception to the Server-Component default in this project (the first was `phase-1c-appointments-calendar`'s calendar): the browser File API and the direct-to-Blob transfer both require running in the browser. `deleteAttachmentAction` and `getAttachmentDownloadUrlAction` (below) stay ordinary Server Actions, called from that same Client Component.

`deleteAttachmentAction` revalidates the patient detail page via `revalidatePath` on success.

## Client-side upload/validation race

`@vercel/blob/client`'s `upload()` resolves as soon as the browser-to-Blob transfer finishes, which happens *before* `onUploadCompleted` runs server-side and validates the file. If the UI treated `upload()`'s resolution as "attached," a file that later fails REQ-003/REQ-005's post-transfer checks would have been visible, if only briefly, directly contradicting REQ-003's "no failed upload is ever visible to any member, even transiently."

The upload Client Component does not add the file to the visible attachment list when `upload()` resolves. It shows a transient "validating..." state, then polls the patient's attachment list (a short-interval refetch, stopping once the new attachment appears or after a bounded number of attempts) until either the new `PatientAttachment` row appears (validation passed) or the polling window elapses without it appearing (validation failed; the UI shows a rejected-upload message, referencing the file by its client-known name, never a broken link to a deleted Blob object).

## Signed URL generation

REQ-010's 15-minute signed URL is generated through `@vercel/blob`'s signed-URL capability (confirmed available as of this design; Vercel shipped general-availability private Blob storage with signed URLs, configurable up to 7 days validity, comfortably covering the 15-minute requirement). The exact current SDK call should be confirmed against `@vercel/blob`'s live documentation at implementation time rather than assumed here, since package APIs move; this design commits to the capability and the 15-minute value, not to a specific function name.

## Requirement coverage

| REQ | Covered by |
|---|---|
| REQ-001 | `onUploadCompleted` creates the `PatientAttachment` record after validation passes |
| REQ-002 | `onBeforeGenerateToken`'s pre-transfer check plus the `allowedContentTypes` token constraint enforced by Vercel Blob during transfer |
| REQ-003 | `onUploadCompleted`'s `file-type` magic-byte check, with immediate `del()` and no record on failure |
| REQ-004 | `onBeforeGenerateToken`'s pre-transfer check plus the `maximumSizeInBytes` token constraint enforced by Vercel Blob during transfer |
| REQ-005 | `onUploadCompleted`'s size check, same immediate-deletion handling as REQ-003 |
| REQ-006 | `onBeforeGenerateToken`'s pre-transfer filename-length check |
| REQ-007 | `onBeforeGenerateToken` calls `requireRole(['ADMIN', 'NUTRITIONIST'])`; the same check gates the list/view/delete Server Actions and hides the upload UI for `FRONT_DESK` |
| REQ-008 | `onBeforeGenerateToken`'s `withTenant`-scoped patient lookup; a foreign patient id resolves to "not found" |
| REQ-009 | Patient detail page's attachment list query, `withTenant`-scoped, independent of the patient's `archivedAt` |
| REQ-010 | Signed-URL generation, see above |
| REQ-011 | Inherent to Vercel Blob's signed-URL expiry enforcement; no application code re-checks it |
| REQ-012 | `deleteAttachmentAction`: `withTenant`-scoped lookup, `del()` on the Blob pathname, then deletes the `PatientAttachment` row |
| REQ-013 | `withTenant` on every `PatientAttachment` read/write |
| REQ-014 | RLS policy above |
| REQ-015 | `logAudit()` call in `onUploadCompleted` and in `deleteAttachmentAction` |
| REQ-016 | `logAudit()` call in `getAttachmentDownloadUrlAction` |

## Multi-tenant isolation and RBAC impact

`PatientAttachment` is a new tenant-scoped table; both isolation layers apply (REQ-013, REQ-014), plus the Blob-level signed-URL access control described above as a third, storage-layer control specific to this spec. RBAC: this is `rbac.ts`'s first real caller, `requireRole(['ADMIN', 'NUTRITIONIST'])`, gating every action in this spec; `FRONT_DESK` is fully excluded (REQ-007), the first time any role boundary from `plan.md` §6 actually restricts something in this project, since `phase-1b-patients` and `phase-1c-appointments-calendar` were both open to all three roles.

## Files to create or update

```
prisma/schema.prisma                                              # update: PatientAttachment model, back-relations
prisma/migrations/.../migration.sql                                 # generated; includes RLS, added manually
src/validation/attachments.ts                                        # new: Zod schemas for pre-transfer checks
src/server/actions/attachments.ts                                     # new: deleteAttachmentAction, getAttachmentDownloadUrlAction
src/app/api/attachments/upload/route.ts                                # new: handleUpload Route Handler
src/components/patients/attachment-upload.tsx                           # new: Client Component, upload trigger
src/app/(app)/[orgSlug]/patients/[patientId]/page.tsx                  # update (from phase-1b-patients): attachments section
```

## Reused vs. new

Reused: `withTenant`, the RLS policy shape, `logAudit()`, the Server Action pattern for delete/download, `revalidatePath` scoping. New: the `PatientAttachment` model, the first Route Handler in this project (the upload webhook, a deliberate exception per `nextjs-architect.md`), the second justified Client Component boundary (the upload trigger, after `phase-1c`'s calendar), `rbac.ts`'s first real enforcement, and the `file-type` magic-byte validation pattern (available for reuse by any future file-upload feature).

## Deviations

None yet; this section is for `spec-closeout` to fill in if implementation diverges from this design.
