# Regla: Spec First

No hay cambio de código sin una tarea aprobada en `.kiro/specs/<slug>/tasks.md`. Sin excepciones para cambios "pequeños".

## Antes de cualquier implementación

1. Identifica la spec y el `slug` en `.kiro/specs/<slug>/`.
2. Confirma que `requirements.md`, `design.md` y `tasks.md` existen y fueron aprobados explícitamente por el usuario (no basta con que existan los archivos — tienen que haber pasado por la aprobación de cada fase de `spec-plan`).
3. Confirma que la tarea específica que vas a implementar está en `tasks.md`, sin marcar, con su comando de validación definido.
4. Si no existe spec, o la tarea no está ahí: para y usa la skill `spec-plan` primero.

## Por qué

Sin spec no hay requirement. Sin requirement no hay criterio de aceptación. Sin criterio de aceptación, `spec-closeout` no puede verificar nada y el harness colapsa en "vibe coding" — exactamente lo que este proyecto está diseñado para evitar en un dominio con datos clínicos.

## Excepciones permitidas

- Commits `chore:` de configuración/dependencias que son autoevidentes y no cambian comportamiento (ej. actualizar una versión de lint) pueden proceder sin spec.
- Hotfixes de emergencia (ej. una fuga de aislamiento multi-tenant en producción) pueden implementarse de inmediato, pero deben generar una spec retroactiva en `.kiro/specs/` documentando qué pasó y por qué, antes de darse por cerrados.
