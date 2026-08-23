# Steering: Stack técnico

Contexto persistente — léelo siempre antes de diseñar la implementación de una feature.

## Stack

| Área | Elección |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript + RSC |
| Base de datos | Postgres en Neon (serverless, branching por PR) |
| ORM | Prisma |
| Auth | Auth.js v5 — Credentials + argon2id, sesión JWT; Google OAuth opcional |
| Aislamiento multi-tenant | `organizationId` por tabla + Postgres RLS (defensa en profundidad) |
| Archivos | Vercel Blob, URLs firmadas |
| UI | Tailwind CSS v4 + shadcn/ui (Radix) + Framer Motion |
| Gráficos | Recharts |
| Calendario | FullCalendar |
| Formularios/validación | React Hook Form + Zod |
| Hosting | Vercel |

Justificación de cada elección: `plan.md` §2.

## Testing y seguridad

| Capa | Herramienta |
|---|---|
| Unit/integración | Vitest + React Testing Library |
| E2E | Playwright |
| SAST | Semgrep (+ `eslint-plugin-security`) |
| Secret scanning | gitleaks |
| DAST | OWASP ZAP Baseline Scan (contra preview) |
| SBOM | `@cyclonedx/cyclonedx-npm` |
| Dependencias | GitHub Dependabot + `npm audit --audit-level=high` |

Detalle, comandos exactos y gate matrix: `docs/testing-and-security.md` y `plan.md` §9.

## Motor de cálculo de composición corporal

Patrón Strategy + Registry — cada ecuación es un módulo autocontenido en `src/calc-engine/protocols/` que se auto-registra. Protocolos v1: Durnin-Womersley+Siri, Jackson-Pollock (3 sitios), IMC, Mifflin-St Jeor (TMB). Ramírez/Torun (población colombiana) es opcional y requiere visto bueno de un profesional antes de recomendarse por defecto — ver `plan.md` §5 para la evidencia de validación.

## No usar

- `any` en TypeScript.
- CSS modules o styled-components — Tailwind únicamente.
- Prisma queries fuera del wrapper de tenant-context para modelos tenant-scoped.
