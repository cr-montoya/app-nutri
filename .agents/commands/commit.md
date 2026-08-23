---
name: commit
description: Creates a conventional commit for the changes in AppNutri's working tree.
---

# Commit

## Process

1. Run `git status` and `git diff` (and `git diff --staged` if applicable) to see what changed.
2. Exclude from staging anything that shouldn't be committed: `.env*`, build artifacts, local session state (`.claude/settings.local.json`, `.claude/*.lock`).
3. If any staged file looks like it contains a secret or credential, inspect its content before continuing. Don't commit it without confirming.
4. Write the message following the convention in `AGENTS.md`:

```
<type>(<scope>): <description>
```

- Types: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `style`, `perf`.
- Scope: affected area (for example `calc-engine`, `patients`, `harness`, `ci`). Omit only if truly cross-cutting.
- English, imperative, present tense, single line, no body or footer, no `Co-Authored-By`.

5. Create the commit. Don't push or open a PR unless the user explicitly asks; this repo may still not have a remote configured.

## Examples

```
feat(calc-engine): add durnin-womersley and siri protocol
fix(tenant-context): scope patient query by organizationId
chore(harness): add gitleaks pre-commit hook
docs(plan): document ramirez-torun validation caveat
```
