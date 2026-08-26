# AppNutri

Multi-tenant platform for nutrition professionals. The Phase 0 scaffold provides
credentials authentication, organization bootstrap, and two-layer tenant
isolation through Prisma tenant context and Postgres RLS.

## Local development

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Validation

```bash
pnpm lint
pnpm test
pnpm test:e2e
pnpm scan:deps
mkdir -p artifacts
pnpm sbom --sbom-format cyclonedx > artifacts/sbom.cdx.json
```

The local application runtime uses `APP_DATABASE_URL`. Vercel uses the Neon
integration's dynamic `DATABASE_URL`; do not place a migration-owner connection
in Vercel runtime variables.
