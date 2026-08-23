# Steering: Structure and conventions

Persistent context — always read before deciding where a new file goes.

## Target folder structure

```
appnutri/
  prisma/schema.prisma
  src/
    app/                    # Next.js routes (App Router)
    components/ui/          # shadcn primitives
    components/charts/      # Recharts wrappers
    lib/db.ts                # tenant-context Prisma Client Extension
    lib/auth.ts              # Auth.js v5 configuration
    lib/rbac.ts               # role guards used in Server Actions
    lib/audit.ts              # audit logging wrapper
    server/actions/          # Server Actions by domain (patient, appointment, consultation, plan)
    server/services/         # business logic
    calc-engine/              # body-composition equation engine
      registry.ts
      types.ts
      protocols/               # one file per equation, self-registered
    validation/                # Zod schemas shared client/server
```

## Multi-tenant model (two layers)

```
Organization (tenant)
  └─ Membership (User ↔ Organization, role: ADMIN | NUTRITIONIST | FRONT_DESK)
       └─ Professional (clinical profile, 1:1 with a Membership of role NUTRITIONIST)
  └─ Patient
       └─ ClinicalHistory, Appointment, Consultation
            └─ AnthropometricMeasurement → BodyCompositionResult
            └─ NutritionalPlan
       └─ PatientAttachment
  └─ AuditLog
```

Isolation:
1. **Prisma Client Extension** (`src/lib/db.ts`) — injects `organizationId` automatically via `AsyncLocalStorage`, primary layer.
2. **Postgres RLS** — a policy per tenant-scoped table, defense in depth.

Full data model: `plan.md` §4.

## Placement rules (quick decision)

1. New route/endpoint? → `src/app/`
2. New use case/orchestration? → `src/server/actions/` or `src/server/services/`
3. New body composition equation? → `src/calc-engine/protocols/`, never modify an existing protocol
4. New validation schema? → `src/validation/`
5. New reusable visual component? → `src/components/ui/` (primitive) or `src/components/` (composite)
6. New cross-cutting helper (RBAC, audit, tenant-context)? → `src/lib/`

Avoid partial implementations that bypass the `calc-engine` registry or the tenant-context wrapper when the pattern already covers the case.
