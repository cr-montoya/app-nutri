---
name: security-scan
description: Corre el bundle de seguridad local (gitleaks, semgrep, npm audit cuando exista package.json) y resume los hallazgos contra el checklist OWASP de docs/testing-and-security.md. Úsala antes de cerrar una spec que toque auth, datos de paciente, o dependencias nuevas.
---

# Security Scan

## Proceso

1. Secretos: `gitleaks detect --source . --no-banner` (o `pre-commit run gitleaks --all-files` si `pre-commit` está instalado).
2. SAST: `semgrep --config auto .` (o `pre-commit run semgrep --all-files`). Prioriza hallazgos de severidad alta/crítica y reglas OWASP Top 10.
3. Dependencias: si existe `package.json`, `npm audit --audit-level=high`. Si no existe todavía, sáltalo y dilo explícitamente — no lo reportes como "sin hallazgos".
4. Si el cambio toca modelos tenant-scoped, verifica manualmente contra `.agents/rules/tenant-isolation.md`: ¿toda query nueva pasa por `withTenant`? ¿hay algún `where` sin `organizationId`?
5. Si el cambio toca logging, verifica contra `.agents/rules/no-plaintext-clinical-data.md`.

## Salida

Resumen por herramienta: hallazgos altos/críticos (con archivo:línea), hallazgos medios/bajos (solo conteo), y qué chequeos se saltaron y por qué. Mapea cada hallazgo alto/crítico a la categoría OWASP correspondiente del checklist en `docs/testing-and-security.md` cuando aplique.

No marques el scan como "limpio" si algún paso se saltó por falta de herramienta instalada — dilo explícitamente.
