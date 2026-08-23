# .kiro/specs — convención

Cada feature o cambio no trivial vive aquí como una carpeta `<slug>/` con tres documentos, escritos en orden estricto y aprobados uno a uno por el usuario:

```
.kiro/specs/<slug>/
  requirements.md   # user stories + criterios de aceptación en formato EARS
  design.md         # arquitectura de la feature, referenciando plan.md y .kiro/steering/
  tasks.md          # checklist de tareas con ID estable y comando de validación por tarea
```

Se crean con la skill `spec-plan` (`.agents/skills/spec-plan/SKILL.md`). No hay código sin una tarea aprobada en `tasks.md` — ver `.agents/rules/spec-first.md`.

Todavía no existe ninguna spec en esta carpeta: la primera se crea cuando arranque la Fase 0 de `plan.md` (scaffold + auth + esqueleto multi-tenant).
