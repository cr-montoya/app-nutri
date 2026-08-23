# AGENTS.md — AppNutri

Instrucciones canónicas y agnósticas de herramienta para cualquier agente de IA (Claude Code, OpenCode, Codex CLI u otro) que trabaje en este repositorio. Léelo antes de tocar cualquier archivo.

`plan.md` es la fuente de verdad de la arquitectura completa — este archivo es el resumen operativo. `.kiro/steering/` profundiza en producto/stack/estructura; `.kiro/specs/` es donde vive cada feature en desarrollo.

## Qué es AppNutri

Plataforma SaaS multi-tenant para profesionales de nutrición: pacientes, citas, historia clínica, mediciones antropométricas con múltiples ecuaciones de composición corporal según población, planes nutricionales, y gráficos de evolución. Datos clínicos sensibles — la seguridad y el aislamiento entre organizaciones no son negociables.

## Stack

| Área | Elección |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript |
| Base de datos | Postgres en Neon |
| ORM | Prisma |
| Auth | Auth.js v5 (Credentials + argon2id, JWT) |
| Archivos | Vercel Blob |
| UI | Tailwind v4 + shadcn/ui + Framer Motion |
| Gráficos | Recharts |
| Calendario | FullCalendar |
| Formularios | React Hook Form + Zod |

Detalle completo y justificación de cada elección: `plan.md` §2, `.kiro/steering/tech.md`.

## Cómo se construye una feature (SDD estilo Kiro)

No se escribe código sin una spec aprobada. El flujo:

1. **Requirements** → `.kiro/specs/<slug>/requirements.md` (formato EARS, user stories).
2. **Design** → `.kiro/specs/<slug>/design.md` (arquitectura de la feature).
3. **Tasks** → `.kiro/specs/<slug>/tasks.md` (checklist con IDs estables y comando de validación por tarea).

Cada fase requiere aprobación explícita antes de pasar a la siguiente. Usa la skill `spec-plan` (`.agents/skills/spec-plan/SKILL.md`) para orquestar esto, o el modo plan nativo si tu herramienta lo tiene (Claude Code). Implementa tareas ya aprobadas con la skill `task-runner`. Antes de cerrar una spec, corre `spec-closeout`.

Regla dura: sin una tarea aprobada en `tasks.md` referenciando un requirement, no hay cambio de código. Ver `.agents/rules/spec-first.md`.

## Reglas de dominio (siempre activas)

- **Aislamiento multi-tenant**: toda query sobre un modelo tenant-scoped (`Patient`, `Appointment`, `Consultation`, etc.) pasa por el wrapper de tenant-context (`withTenant`, ver `plan.md` §3). Nunca escribas un `where` manual sin `organizationId`. Detalle: `.agents/rules/tenant-isolation.md`.
- **Contratos antes que código**: define el schema de Prisma y los tipos Zod antes de implementar la UI o la lógica que los usa. Detalle: `.agents/rules/contracts-before-code.md`.
- **Nunca loguear PII ni datos clínicos en texto plano**: nombres de pacientes, notas clínicas, resultados de mediciones nunca van a `console.log`/stdout. Los accesos a datos clínicos se registran en `AuditLog`, no en logs de aplicación. Detalle: `.agents/rules/no-plaintext-clinical-data.md`.
- **RBAC siempre en servidor**: el rol (`ADMIN`/`NUTRICIONISTA`/`RECEPCION`) se verifica en Server Actions/Route Handlers, nunca solo ocultando UI en cliente.
- **Ecuaciones de composición corporal**: cada protocolo nuevo es un módulo autocontenido en `src/calc-engine/protocols/`, nunca se modifica un protocolo existente (trazabilidad de resultados ya calculados — ver `plan.md` §5).

## Convención de commits

Conventional commits, en inglés, mensaje de una sola línea, sin co-author:

```
<type>(<scope>): <description>
```

Tipos: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `style`, `perf`. Ver `.agents/commands/commit.md`.

## Testing y seguridad

Estrategia completa en `docs/testing-and-security.md` (gate matrix, Definition of Ready/Done) y `plan.md` §9. Comandos objetivo (activos desde la Fase 0, cuando exista `package.json`):

| Comando | Qué hace |
|---|---|
| `npm test` | Vitest + React Testing Library |
| `npm run test:e2e` | Playwright |
| `npm run lint` | ESLint + `eslint-plugin-security` |
| `npm run scan:sast` | Semgrep |
| `npm run scan:secrets` | gitleaks |
| `npm run scan:deps` | `npm audit --audit-level=high` |
| `npm run sbom` | SBOM en CycloneDX |

Ya activo, sin depender de `package.json`: hooks de `pre-commit` (gitleaks + semgrep, ver `.pre-commit-config.yaml`) y el workflow `.github/workflows/security.yml`.

## Estado actual del repo

Solo existe el harness (documentación, agentes, reglas, skills) — todavía no hay scaffold de Next.js. La Fase 0 (`plan.md` §8) es el primer trabajo real de implementación y debe empezar con una spec en `.kiro/specs/` siguiendo el flujo de arriba.
