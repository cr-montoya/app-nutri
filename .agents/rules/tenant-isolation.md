# Rule: Multi-Tenant Isolation

Always active. Check BEFORE writing and AFTER writing any query on a tenant-scoped model.

## Tenant-scoped models

`Patient`, `ClinicalHistory`, `Appointment`, `Consultation`, `AnthropometricMeasurement`, `BodyCompositionResult`, `NutritionalPlan`, `PatientAttachment`, `AuditLog`. Any model with `organizationId` in `plan.md` §4.

## Rule

Every read or write on these models goes through the tenant-context wrapper (`withTenant`, the Prisma Client Extension described in `plan.md` §3). Never write a manual `where` or `data` that relies on `organizationId` having "already been filtered somewhere else."

## Violation: stop immediately if this appears

```ts
// Bad: direct query with no tenant-context, trusting that the caller already filtered
const patients = await db.patient.findMany({ where: { lastName } })

// Bad: organizationId taken from a client-supplied parameter instead of the session context
const patients = await db.patient.findMany({ where: { organizationId: req.body.orgId } })
```

## Correct pattern

```ts
// Good: inside withTenant, the Prisma extension injects organizationId automatically
await withTenant({ organizationId: session.activeOrgId, userId: session.userId }, async () => {
  return db.patient.findMany({ where: { lastName } })
})
```

## Why

Without this, a bug in a new Server Action can leak patients from one organization into another. With health data, that's not just any bug. Defense in depth (Postgres RLS, `plan.md` §3) exists precisely for the case where this rule fails; it's not an excuse to relax it.

## Quick check

```bash
grep -n "db\.\(patient\|clinicalHistory\|appointment\|consultation\)" <file>
# any result outside a withTenant callback is suspicious
```
