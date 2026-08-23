# Regla: Nunca Loguear Datos Clínicos en Texto Plano

Activa siempre. Verifica antes de añadir cualquier `console.log`, logger de aplicación, mensaje de error, o traza.

## Qué nunca va a un log de aplicación

- Nombre, documento, teléfono, email o dirección de un paciente.
- Contenido de `ClinicalHistory` (antecedentes, alergias, patologías, medicamentos).
- Notas de `Consultation`, mediciones de `AnthropometricMeasurement`, contenido de `NutritionalPlan`.
- Cualquier payload completo de request/response que incluya alguno de los anteriores.

## Violación — parar inmediatamente si aparece

```ts
// ❌ Loguea el objeto paciente completo, incluyendo PII
console.error('Failed to save patient', patient)

// ❌ El mensaje de error expone datos clínicos
throw new Error(`Invalid skinfold value for patient ${patient.firstName}: ${value}`)
```

## Patrón correcto

```ts
// ✅ Solo IDs y metadata no sensible en logs de aplicación
console.error('Failed to save patient', { patientId: patient.id, organizationId })

// ✅ El acceso/modificación de datos clínicos se registra en AuditLog, no en logs de app
await logAudit({ action: 'patient.update', entityType: 'Patient', entityId: patient.id, userId, organizationId })
```

## Por qué

Los logs de aplicación suelen terminar en herramientas de terceros (proveedores de hosting, servicios de monitoreo) con retención y controles de acceso distintos a los de la base de datos principal. Para datos de salud sujetos a la Ley 1581 de 2012, eso es una superficie de fuga que no debe existir. El trazado de "quién vio/modificó qué" tiene un lugar propio y auditable: `AuditLog` (`plan.md` §4).
