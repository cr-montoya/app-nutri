## Summary

<!-- One or two sentences: what changed and why. -->

## Spec

- **Spec**: `.kiro/specs/<slug>/`
- **Requirements closed**: REQ-, REQ-
- **Type of change**: <!-- feat / fix / refactor / chore / docs -->

## Changes

<!-- Bullet list of what changed, grouped by area if it spans several. -->

-
-

## Gates run

Check only the gates required for this change type; see the gate matrix in `docs/testing-and-security.md`.

- [ ] Security
- [ ] QA
- [ ] Design
- [ ] Code Quality
- [ ] Reviewer
- [ ] Database Architect (schema/migration/RLS changes)
- [ ] Next.js Architect (new route/rendering-strategy changes, consult only)

## Testing

<!-- Exact commands run and their result. No "should pass," only what actually ran. -->

```
$
```

- [ ] `pnpm test` passes
- [ ] `pnpm test:e2e` passes (if this change touches a user-facing flow)
- [ ] `pnpm lint` passes
- [ ] `pre-commit run --all-files` passes (gitleaks + semgrep)

## Security checklist (if this touches auth, tenant-scoped models, or dependencies)

- [ ] Every new query on a tenant-scoped model goes through `withTenant`
- [ ] RLS policy added/verified for any new tenant-scoped table, with a positive and negative test
- [ ] No PII or clinical data in logs
- [ ] `pnpm audit --audit-level=high` clean, or mitigation documented below

## Screenshots (UI changes only)

<!-- Before/after, or a short clip for anything animated. -->

## Deviations from the approved design

<!-- Link to the `## Deviations` section in design.md, or write "None." -->

None.

## Checklist

- [ ] No agent that implemented this also marked it reviewed (see `.agents/rules/agent-anti-patterns.md`)
- [ ] `tasks.md` for this spec is fully checked off or has documented `[BLOCKED]` items
- [ ] `plan.md`/`.kiro/steering/` updated if this change introduced an architecture decision not yet documented there
