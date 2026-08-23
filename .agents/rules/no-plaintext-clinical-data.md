# Rule: Never Log Clinical Data in Plaintext

Always active. Check before adding any `console.log`, application logger call, error message, or trace.

## What never goes to an application log

- A patient's name, ID document, phone, email, or address.
- `ClinicalHistory` content (background, allergies, pathologies, medications).
- `Consultation` notes, `AnthropometricMeasurement` readings, `NutritionalPlan` content.
- Any full request/response payload that includes any of the above.

## Violation: stop immediately if this appears

```ts
// ❌ Logs the full patient object, including PII
console.error('Failed to save patient', patient)

// ❌ The error message exposes clinical data
throw new Error(`Invalid skinfold value for patient ${patient.firstName}: ${value}`)
```

## Correct pattern

```ts
// ✅ Only IDs and non-sensitive metadata in application logs
console.error('Failed to save patient', { patientId: patient.id, organizationId })

// ✅ Access/modification of clinical data is recorded in AuditLog, not app logs
await logAudit({ action: 'patient.update', entityType: 'Patient', entityId: patient.id, userId, organizationId })
```

## Why

Application logs often end up in third-party tools (hosting providers, monitoring services) with retention and access controls different from the primary database's. For health data subject to Law 1581 of 2012, that's a leak surface that shouldn't exist. Tracking "who saw/modified what" has its own auditable place: `AuditLog` (`plan.md` §4).
