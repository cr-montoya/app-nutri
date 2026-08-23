# Steering: Tech stack

Persistent context — always read before designing a feature's implementation.

## Stack

| Area | Choice |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript + RSC |
| Database | Postgres on Neon (serverless, per-PR branching) |
| ORM | Prisma |
| Auth | Auth.js v5 — Credentials + argon2id, JWT session; optional Google OAuth |
| Multi-tenant isolation | `organizationId` per table + Postgres RLS (defense in depth) |
| Files | Vercel Blob, signed URLs |
| UI | Tailwind CSS v4 + shadcn/ui (Radix) + Framer Motion |
| Charts | Recharts |
| Calendar | FullCalendar |
| Forms/validation | React Hook Form + Zod |
| Hosting | Vercel |

Rationale for each choice: `plan.md` §2.

## Testing and security

| Layer | Tool |
|---|---|
| Unit/integration | Vitest + React Testing Library |
| E2E | Playwright |
| SAST | Semgrep (+ `eslint-plugin-security`) |
| Secret scanning | gitleaks |
| DAST | OWASP ZAP Baseline Scan (against preview) |
| SBOM | `@cyclonedx/cyclonedx-npm` |
| Dependencies | GitHub Dependabot + `npm audit --audit-level=high` |

Detail, exact commands, and gate matrix: `docs/testing-and-security.md` and `plan.md` §9.

## Body composition calculation engine

Strategy + Registry pattern — each equation is a self-contained, self-registering module in `src/calc-engine/protocols/`. v1 protocols: Durnin-Womersley+Siri, Jackson-Pollock (3-site), BMI, Mifflin-St Jeor (BMR). Ramírez/Torun (Colombian population) is optional and requires a professional's sign-off before being recommended by default — see `plan.md` §5 for the validation evidence.

## Do not use

- `any` in TypeScript.
- CSS modules or styled-components — Tailwind only.
- Prisma queries outside the tenant-context wrapper for tenant-scoped models.
