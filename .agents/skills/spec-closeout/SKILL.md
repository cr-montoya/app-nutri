---
name: spec-closeout
description: Verifica que una spec en .kiro/specs/<slug>/ está lista para darse por cerrada — todos los requirements EARS tienen validación en verde y no hay drift entre design.md y lo realmente implementado. Úsala antes de abrir PR o de considerar terminada una feature.
---

# Spec Closeout

## Proceso

1. Lee `requirements.md`, `design.md` y `tasks.md` de la spec.
2. Para cada `REQ-XXX` en `requirements.md`: confirma que al menos una tarea de `tasks.md` lo referencia, que esa tarea está marcada `[x]`, y que su comando de validación efectivamente pasó (vuelve a correrlo si hay duda).
3. Compara `design.md` contra el código realmente escrito: si la implementación se desvió del diseño aprobado (nuevo archivo no previsto, capa distinta, contrato distinto), documenta la desviación explícitamente en `design.md` bajo una sección `## Desviaciones` — no la dejes implícita.
4. Corre el gate matrix de `docs/testing-and-security.md` según el tipo de cambio (multi-tenant/auth, UI, calc-engine, infra) y confirma que los gates requeridos están cubiertos.
5. Si algún `REQ-XXX` queda sin cobertura, o hay una tarea `[BLOCKED]` sin resolver, la spec **no** está lista — repórtalo, no la cierres.

## Salida

Un resumen corto: requirements cubiertos / totales, tareas completadas / bloqueadas, desviaciones documentadas, gates pendientes si los hay. Si todo está en verde, indica explícitamente que la spec está lista para cerrar.
