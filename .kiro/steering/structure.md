# Steering: Estructura y convenciones

Contexto persistente — léelo siempre antes de decidir dónde va un archivo nuevo.

## Estructura de carpetas objetivo

```
appnutri/
  prisma/schema.prisma
  src/
    app/                    # rutas Next.js (App Router)
    components/ui/          # primitivos shadcn
    components/charts/      # wrappers de Recharts
    lib/db.ts                # Prisma Client Extension de tenant-context
    lib/auth.ts              # configuración Auth.js v5
    lib/rbac.ts               # guards de rol usados en Server Actions
    lib/audit.ts              # wrapper de audit logging
    server/actions/          # Server Actions por dominio (paciente, cita, consulta, plan)
    server/services/         # lógica de negocio
    calc-engine/              # motor de ecuaciones de composición corporal
      registry.ts
      types.ts
      protocols/               # un archivo por ecuación, auto-registrado
    validation/                # esquemas Zod compartidos cliente/servidor
```

## Modelo multi-tenant (dos capas)

```
Organization (tenant)
  └─ Membership (User ↔ Organization, role: ADMIN | NUTRICIONISTA | RECEPCION)
       └─ Professional (perfil clínico, 1:1 con Membership de rol NUTRICIONISTA)
  └─ Patient
       └─ ClinicalHistory, Appointment, Consultation
            └─ AnthropometricMeasurement → BodyCompositionResult
            └─ NutritionalPlan
       └─ PatientAttachment
  └─ AuditLog
```

Aislamiento:
1. **Prisma Client Extension** (`src/lib/db.ts`) — inyecta `organizationId` automáticamente vía `AsyncLocalStorage`, capa principal.
2. **Postgres RLS** — policy por tabla tenant-scoped, defensa en profundidad.

Modelo de datos completo: `plan.md` §4.

## Reglas de ubicación (decisión rápida)

1. ¿Nueva ruta/endpoint? → `src/app/`
2. ¿Nuevo caso de uso/orquestación? → `src/server/actions/` o `src/server/services/`
3. ¿Nueva ecuación de composición corporal? → `src/calc-engine/protocols/`, nunca modifica un protocolo existente
4. ¿Nuevo esquema de validación? → `src/validation/`
5. ¿Nuevo componente visual reutilizable? → `src/components/ui/` (primitivo) o `src/components/` (compuesto)
6. ¿Nuevo helper cross-cutting (RBAC, audit, tenant-context)? → `src/lib/`

Evita implementaciones parciales que evadan el registry del `calc-engine` o el wrapper de tenant-context cuando el patrón ya los cubre.
