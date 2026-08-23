@AGENTS.md

# CLAUDE.md — Claude Code en AppNutri

Lo de arriba (`AGENTS.md`) es la fuente canónica de instrucciones — stack, reglas de dominio, convención de commits, testing/seguridad, y el flujo SDD estilo Kiro. Esto que sigue es lo específico de Claude Code.

## Modo plan vs skill `spec-plan`

El modo plan nativo de Claude Code (`EnterPlanMode`/`ExitPlanMode`) cumple el mismo propósito que la skill `spec-plan`: explorar, diseñar y pedir aprobación antes de tocar código. Usa cualquiera de los dos — son intercambiables. La diferencia es que `spec-plan` deja el resultado como archivos versionados en `.kiro/specs/<slug>/`, legibles por Codex y OpenCode también; el modo plan nativo es más rápido para cambios que no necesitan sobrevivir como spec compartida entre herramientas.

## Catálogo disponible

Todo vive en `.agents/` y se expone aquí vía symlink — un solo lugar que mantener:

- **Agentes** (`.claude/agents/`, subagentes invocables con `Agent({ subagent_type: ... })`): `developer`, `design`, `qa`, `security`, `code-quality`, `reviewer`.
- **Skills** (`.claude/skills/`): `spec-plan`, `task-runner`, `spec-closeout`, `security-scan`.
- **Comandos** (`.claude/commands/`): `commit`.
- **Reglas siempre activas** (`.claude/rules/`): `tenant-isolation`, `contracts-before-code`, `spec-first`, `no-plaintext-clinical-data`.

## Convenciones de carpetas (una vez exista el scaffold)

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
    server/actions/          # Server Actions por dominio
    server/services/         # lógica de negocio
    calc-engine/              # motor de ecuaciones de composición corporal (registry + protocols/)
    validation/                # esquemas Zod compartidos cliente/servidor
```

## Cómo correr el proyecto localmente

_Pendiente hasta que exista el scaffold de Fase 0 (ver `plan.md` §8)._ Cuando exista: `npm install`, variables de entorno en `.env.local` (nunca commiteadas), `npm run dev`, migraciones con `npx prisma migrate dev`.
