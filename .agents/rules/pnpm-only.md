# Rule: pnpm Only

Always active. Check before writing any install command, script, CI step, or piece of documentation that invokes a package manager.

## Rule

This project uses `pnpm` exclusively. Never `npm` (no `npm install`, `npm run`, `npm audit`, `npx`) and never `yarn`, in code, in CI workflows, in scripts, or in documentation. There is one lockfile: `pnpm-lock.yaml`. `package-lock.json` and `yarn.lock` must never exist in this repo.

## Command mapping

| Instead of | Use |
|---|---|
| `npm install` | `pnpm install` |
| `npm run <script>` | `pnpm <script>` (pnpm aliases custom script names automatically) |
| `npm test` | `pnpm test` |
| `npx <package>` | `pnpm dlx <package>` for a one-off, or `pnpm exec <package>` for a package already in `devDependencies` |
| `npm audit` | `pnpm audit` |
| `npm ci` | `pnpm install --frozen-lockfile` |

## Why

A mixed lockfile state (`package-lock.json` alongside `pnpm-lock.yaml`) produces inconsistent dependency resolution between contributors and CI, and pnpm's stricter node_modules layout catches phantom-dependency bugs that npm's flat layout hides. One package manager, one lockfile, no ambiguity about which one CI trusts.

## Violation: stop immediately if this appears

Any `package-lock.json` or `yarn.lock` file being created or committed. Any command, script, or CI step invoking `npm` or `yarn`. Any documentation instructing a contributor to run an `npm`/`yarn` command.
