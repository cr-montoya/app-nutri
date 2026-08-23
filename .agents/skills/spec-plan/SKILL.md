---
name: spec-plan
description: Orquesta el flujo de Spec-Driven Development estilo Kiro para una feature nueva o un cambio no trivial — Requirements (EARS) → Design → Tasks, con aprobación explícita del usuario en cada fase. Úsala antes de escribir cualquier código para trabajo que no sea una corrección trivial de una línea.
---

# Spec Plan (estilo Kiro)

## Propósito

Convertir una idea o petición en una spec versionada en `.kiro/specs/<slug>/`, con tres documentos que se escriben y aprueban en orden estricto. Nunca se salta una fase ni se mezclan decisiones de una fase posterior en una anterior.

Antes de empezar, lee siempre `.kiro/steering/product.md`, `.kiro/steering/tech.md` y `.kiro/steering/structure.md`, y `plan.md` si la feature toca arquitectura no cubierta en steering.

## Fase 1 — Requirements

Archivo: `.kiro/specs/<slug>/requirements.md`.

1. Reformula el objetivo en un párrafo corto.
2. Escribe una o más user stories: `Como <rol>, quiero <capacidad>, para <resultado>.`
3. Escribe los criterios de aceptación en **formato EARS**, cada uno con un ID estable (`REQ-001`, `REQ-002`, ...):
   - `CUANDO <evento/condición>, EL SISTEMA DEBERÁ <respuesta observable>.`
   - Para comportamiento siempre activo: `EL SISTEMA DEBERÁ SIEMPRE <invariante>.`
4. Marca explícitamente qué queda fuera de alcance.
5. Si algo es ambiguo (actor, dato de entrada/salida, caso límite, criterio de éxito), pregunta — no asumas. No hay límite de preguntas, pero cada una debe cerrar una decisión concreta.
6. Presenta el documento y pide aprobación explícita antes de pasar a Fase 2. No continúes sin un "sí" claro.

## Fase 2 — Design

Archivo: `.kiro/specs/<slug>/design.md`. Solo se escribe tras aprobar Requirements.

Debe cubrir:
- Qué parte de la arquitectura de `plan.md`/steering toca esta feature (modelos de datos nuevos o modificados, capas afectadas: `api`/`services`/`domain`/`repositories` equivalentes en la convención de `structure.md`).
- Referencia explícita a cada `REQ-XXX` que este diseño satisface.
- Diagramas mermaid solo si aclaran algo que la prosa no — no por defecto.
- Impacto en aislamiento multi-tenant, RBAC, o datos clínicos si aplica (ver `.agents/rules/tenant-isolation.md` y `no-plaintext-clinical-data.md`).
- Qué se reutiliza de código/patrones existentes vs qué es nuevo.

Presenta y pide aprobación explícita antes de pasar a Fase 3.

## Fase 3 — Tasks

Archivo: `.kiro/specs/<slug>/tasks.md`. Solo se escribe tras aprobar Design.

- Lista de tareas con checkbox y ID estable: `- [ ] T1.1 <descripción>`.
- Cada tarea referencia el/los `REQ-XXX` que cierra.
- Cada tarea especifica el comando de validación exacto (ej. `npm test -- calc-engine`, `npm run test:e2e -- citas`).
- Una tarea = una acción verificable. No fusionar varias acciones independientes en una sola tarea.
- No descompongas más de lo necesario — el nivel de granularidad debe ser ejecutable por `task-runner` sin ambigüedad, ni tan fino que se vuelva ruido.

Presenta y pide aprobación explícita antes de implementar. Una vez aprobado `tasks.md`, usa la skill `task-runner` para ejecutar cada tarea.

## Reglas

- No escribas código durante esta skill — solo los tres documentos de spec.
- No avances de fase sin aprobación explícita del usuario.
- No introduzcas en Design o Tasks ninguna decisión de comportamiento que no esté ya en Requirements — si hace falta una decisión nueva, vuelve a Requirements primero.
- Responde siempre en el idioma que use el usuario.
