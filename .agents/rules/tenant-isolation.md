# Regla: Aislamiento Multi-Tenant

Activa siempre. Verifica ANTES de escribir y DESPUÉS de escribir cualquier query sobre un modelo tenant-scoped.

## Modelos tenant-scoped

`Patient`, `ClinicalHistory`, `Appointment`, `Consultation`, `AnthropometricMeasurement`, `BodyCompositionResult`, `NutritionalPlan`, `PatientAttachment`, `AuditLog` — cualquier modelo con `organizationId` en `plan.md` §4.

## Regla

Toda lectura/escritura sobre estos modelos pasa por el wrapper de tenant-context (`withTenant`, Prisma Client Extension descrita en `plan.md` §3). Nunca se escribe un `where` o `data` manual que dependa de que el `organizationId` "ya viene filtrado por otro lado".

## Violación — parar inmediatamente si aparece

```ts
// ❌ Query directa sin tenant-context, confiando en que el caller ya filtró
const patients = await db.patient.findMany({ where: { lastName } })

// ❌ organizationId tomado de un parámetro del cliente en vez del contexto de sesión
const patients = await db.patient.findMany({ where: { organizationId: req.body.orgId } })
```

## Patrón correcto

```ts
// ✅ Dentro de withTenant, la extensión de Prisma inyecta organizationId automáticamente
await withTenant({ organizationId: session.activeOrgId, userId: session.userId }, async () => {
  return db.patient.findMany({ where: { lastName } })
})
```

## Por qué

Sin esto, un bug en un Server Action nuevo puede filtrar pacientes de una organización a otra — con datos de salud, eso no es un bug cualquiera. La defensa en profundidad (RLS en Postgres, `plan.md` §3) existe precisamente para el caso en que esta regla falle; no es una excusa para relajarla.

## Verificación rápida

```bash
grep -n "db\.\(patient\|clinicalHistory\|appointment\|consultation\)" <archivo> 
# cualquier resultado fuera de un callback de withTenant es sospechoso
```
