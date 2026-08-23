# Rule: Contracts Before Code

Never write implementation code (Server Action, component, business logic) for an entity or feature without defining its contract first.

## What counts as a contract

1. **Prisma schema** (`prisma/schema.prisma`) — the shape of persisted data.
2. **Zod schema** (`src/validation/<entity>.ts`) — the shape validated at the boundary (forms, Server Actions).
3. **Protocol interface** (`src/calc-engine/types.ts`) — if the task adds a new protocol to the calculation engine.

## Implementation order

```
1. Define/update the model in prisma/schema.prisma
2. Run the migration (prisma migrate dev) — the generated Prisma Client type is the persistence contract
3. Define/update the Zod schema in src/validation/
4. Implement the Server Action or service, using the types from steps 1-3
5. Implement the component/form, with its explicit props interface
```

Never jump to step 4-5 without having closed 1-3.

## The domain's most important contract example

The calculation engine (`plan.md` §5) depends on `AnthropometricMeasurement` and `BodyCompositionResult` being properly typed before writing any new protocol — a protocol that assumes a field that doesn't exist in the schema fails at compile time, not in production with a real patient.

```ts
// ❌ Writing the protocol first, inventing the shape of the data
function calculateBodyFat(triceps: number, biceps: number) { ... }

// ✅ The contract already defines ProtocolContext (plan.md §5); the protocol consumes it
function calculate(ctx: ProtocolContext): ProtocolResult { ... }
```

## In specs

Every spec in `.kiro/specs/<slug>/design.md` that introduces or modifies an entity must include its contract (schema/Zod) explicitly before moving to `tasks.md` — `spec-plan` checks this in Phase 2.
