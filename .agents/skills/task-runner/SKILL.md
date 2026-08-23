---
name: task-runner
description: Implementa una tarea puntual ya aprobada en .kiro/specs/<slug>/tasks.md. Úsala solo después de que requirements.md, design.md y tasks.md de la spec estén aprobados — nunca para trabajo sin spec.
---

# Task Runner

## Precondición

La tarea a implementar debe existir como checkbox sin marcar en un `tasks.md` ya aprobado. Si no hay spec, o la tarea no está en `tasks.md`, para y usa `spec-plan` primero (ver `.agents/rules/spec-first.md`).

## Proceso

1. Lee la tarea (`T<fase>.<índice>`), los `REQ-XXX` que referencia en `requirements.md`, y la sección relevante de `design.md`.
2. Antes de escribir código: confirma que existen los contratos necesarios (schema Prisma, tipos Zod) para esta tarea — si no existen y esta tarea no es la que los crea, sigue `.agents/rules/contracts-before-code.md`.
3. Implementa el cambio mínimo que satisface la tarea. No adelantes trabajo de otras tareas de la misma spec.
4. Aplica siempre `.agents/rules/tenant-isolation.md` y `.agents/rules/no-plaintext-clinical-data.md` si el cambio toca datos de paciente/consulta.
5. Corre el comando de validación exacto especificado en la tarea. Si falla, corrige y vuelve a correr — no marques la tarea como hecha con una validación en rojo.
6. Marca el checkbox `[x]` en `tasks.md` solo cuando la validación pasa. Si la tarea no se puede completar, márcala `[BLOCKED]` con una razón concreta y repórtalo al usuario en vez de improvisar una solución fuera del diseño aprobado.

## Reglas

- Una tarea, un alcance. No mezcles varias tareas de `tasks.md` en el mismo cambio salvo que el usuario lo pida explícitamente.
- No introduzcas decisiones de comportamiento nuevas que no estén en `design.md` — si hace falta una, vuelve a `spec-plan`.
- Sigue las convenciones de commit de `AGENTS.md`/`.agents/commands/commit.md` para el commit de esta tarea.
