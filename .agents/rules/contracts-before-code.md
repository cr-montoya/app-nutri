# Regla: Contratos Antes Que Código

Nunca escribas código de implementación (Server Action, componente, lógica de negocio) para una entidad o feature sin definir primero su contrato.

## Qué cuenta como contrato

1. **Schema de Prisma** (`prisma/schema.prisma`) — la forma de los datos persistidos.
2. **Esquema Zod** (`src/validation/<entidad>.ts`) — la forma validada en el borde (formularios, Server Actions).
3. **Interfaz del protocolo** (`src/calc-engine/types.ts`) — si la tarea añade un protocolo nuevo al motor de cálculo.

## Orden de implementación

```
1. Definir/actualizar el modelo en prisma/schema.prisma
2. Correr la migración (prisma migrate dev) — el tipo generado de Prisma Client es el contrato de persistencia
3. Definir/actualizar el esquema Zod en src/validation/
4. Implementar la Server Action o servicio, usando los tipos de los pasos 1-3
5. Implementar el componente/formulario, con su interfaz de props explícita
```

Nunca saltar al paso 4-5 sin haber cerrado 1-3.

## Ejemplo del contrato más importante del dominio

El motor de cálculo (`plan.md` §5) depende de que `AnthropometricMeasurement` y `BodyCompositionResult` estén bien tipados antes de escribir cualquier protocolo nuevo — un protocolo que asume un campo que no existe en el schema falla en tiempo de compilación, no en producción con un paciente real.

```ts
// ❌ Escribir el protocolo primero, inventando la forma de los datos
function calculateBodyFat(triceps: number, biceps: number) { ... }

// ✅ El contrato ya define ProtocolContext (plan.md §5); el protocolo lo consume
function calculate(ctx: ProtocolContext): ProtocolResult { ... }
```

## En las specs

Toda spec en `.kiro/specs/<slug>/design.md` que introduzca o modifique una entidad debe incluir su contrato (schema/Zod) explícitamente antes de pasar a `tasks.md` — esto lo verifica `spec-plan` en la Fase 2.
