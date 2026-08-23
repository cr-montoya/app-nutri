---
name: commit
description: Crea un commit convencional para los cambios en el árbol de trabajo de AppNutri.
---

# Commit

## Proceso

1. Corre `git status` y `git diff` (y `git diff --staged` si aplica) para ver qué cambió.
2. Excluye del staging cualquier archivo que no deba commitearse: `.env*`, artefactos de build, estado local de sesión (`.claude/settings.local.json`, `.claude/*.lock`).
3. Si algún archivo staged parece contener un secreto o credencial, revisa su contenido antes de continuar — no lo commitees sin confirmar.
4. Escribe el mensaje siguiendo la convención de `AGENTS.md`:

```
<type>(<scope>): <description>
```

- Tipos: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `style`, `perf`.
- Scope: área afectada (ej. `calc-engine`, `patients`, `harness`, `ci`). Omite solo si es verdaderamente transversal.
- En inglés, imperativo, presente, una sola línea, sin cuerpo ni footer, sin `Co-Authored-By`.

5. Crea el commit. No hagas push ni abras PR salvo que el usuario lo pida explícitamente — este repo todavía puede no tener remoto configurado.

## Ejemplos

```
feat(calc-engine): add durnin-womersley and siri protocol
fix(tenant-context): scope patient query by organizationId
chore(harness): add gitleaks pre-commit hook
docs(plan): document ramirez-torun validation caveat
```
