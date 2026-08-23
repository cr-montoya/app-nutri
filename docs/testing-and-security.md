# Testing y seguridad — guía accionable

Versión operativa de `plan.md` §9. Úsala para decidir qué comando correr y qué gates aplican a un cambio dado.

## Comandos

Ya activos, sin depender de `package.json`:

| Comando | Qué hace |
|---|---|
| `pre-commit run --all-files` | gitleaks + semgrep sobre todo el repo (ver `.pre-commit-config.yaml`) |
| `pre-commit run gitleaks --all-files` | Solo secret scanning |
| `pre-commit run semgrep --all-files` | Solo SAST |

Activos desde la Fase 0 (cuando exista `package.json`/scaffold de Next.js):

| Comando | Qué hace |
|---|---|
| `npm test` | Vitest + React Testing Library |
| `npm run test:e2e` | Playwright |
| `npm run lint` | ESLint + `eslint-plugin-security` |
| `npm run scan:sast` | Semgrep (reglas OWASP Top 10 + JS/TS/React) |
| `npm run scan:secrets` | gitleaks |
| `npm run scan:deps` | `npm audit --audit-level=high` |
| `npm run sbom` | SBOM en CycloneDX vía `@cyclonedx/cyclonedx-npm` |

DAST (OWASP ZAP Baseline Scan) corre en CI contra el deployment de preview de Vercel, nunca localmente — requiere un entorno desplegado. Se activa junto con `ci.yml` en la Fase 0.

## Gate matrix

| Tipo de cambio | Gates requeridos |
|---|---|
| Multi-tenant / auth / RLS / roles | Security, Reviewer, QA |
| Historia clínica / mediciones / archivos adjuntos | Security, QA, Reviewer |
| Nuevo protocolo en `calc-engine` | Reviewer, QA (test unitario obligatorio contra un cálculo de referencia) |
| UI / animación / nueva pantalla | Design, QA, Code Quality |
| Componente/primitivo de diseño nuevo | Design, Code Quality, Reviewer |
| CI/CD / infra / dependencias | Security, Reviewer |
| Solo documentación / specs | Reviewer opcional |
| Bug fix | QA, Code Quality, Reviewer |

## Definition of Ready (una spec en `.kiro/specs/<slug>/`)

- `requirements.md` tiene objetivo, alcance/fuera de alcance, y criterios EARS verificables — aprobado explícitamente.
- `design.md` referencia cada `REQ-XXX` y define los contratos (schema Prisma, Zod) si la feature introduce o modifica una entidad — aprobado explícitamente.
- `tasks.md` tiene tareas con ID estable, referencia a requirements, y comando de validación exacto — aprobado explícitamente.

## Definition of Done

- Todas las tareas de `tasks.md` están `[x]` o `[BLOCKED]` con razón documentada.
- Cada `REQ-XXX` tiene al menos una validación en verde (`spec-closeout` lo confirma).
- Gates de la tabla de arriba corridos según el tipo de cambio, sin hallazgos altos/críticos sin resolver.
- Sin secretos detectados por gitleaks.
- Si hubo desviación entre `design.md` y la implementación real, está documentada explícitamente.

## Checklist OWASP (referencia, mapeado a controles ya presentes en la arquitectura)

| OWASP Top 10 | Control en AppNutri |
|---|---|
| A01 Broken Access Control | RBAC server-side (`src/lib/rbac.ts`) + RLS en Postgres |
| A02 Cryptographic Failures | argon2id para contraseñas, TLS/HSTS, evaluación de cifrado a nivel de campo para notas clínicas (Fase 5) |
| A03 Injection | Prisma (queries parametrizadas), Zod en el borde |
| A04 Insecure Design | SDD con gates de Security/Reviewer antes de cerrar cualquier spec sensible |
| A05 Security Misconfiguration | Secrets solo en variables de entorno de Vercel, nunca en el bundle de cliente |
| A07 Auth Failures | argon2id, rate limiting en rutas de auth, `tokenVersion` para invalidar sesiones |
| A08 Data Integrity Failures | `BodyCompositionResult` nunca se sobrescribe (trazabilidad de protocolo usado) |
| A09 Logging/Monitoring Failures | `AuditLog` para todo acceso/mutación clínica; nunca PII en logs de aplicación |
| A10 SSRF | N/A hasta que existan integraciones salientes; revisar si se añade una |
