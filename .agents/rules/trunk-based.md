# Rule: Trunk-Based Development

Always active. Check before running the first task of a spec, and before any commit.

## Rule

`main` is the trunk. It is always deployable; nothing broken is ever committed directly to it. Every spec gets exactly one short-lived branch, created from up-to-date `main`, and deleted once its PR merges. There are no long-lived feature branches and no `develop`/`staging` branches.

## Branch naming

`<type>/<slug>`, where `<type>` matches the commit type (`feat`, `fix`, `refactor`, `chore`, and so on) and `<slug>` matches the spec folder `.kiro/specs/<slug>/`. The slug in the branch name is not optional; it is what makes `git log` and `gh pr list` traceable back to a spec.

```
feat/patient-photo-upload
fix/rls-missing-attachment-policy
refactor/calc-engine-registry
```

## When the branch is created

`task-runner` creates it (or checks it out if it already exists) before starting the first task of a spec, from an up-to-date `main`:

```bash
git checkout main
git pull
git checkout -b <type>/<slug>
```

If a branch for this spec already exists (resuming work), check it out instead of creating a new one. Never start implementing a task while checked out on `main`.

## One spec, one PR

A branch maps to exactly one spec. Don't accumulate work from two different specs on the same branch, and don't split one spec's tasks across two branches. See `.agents/skills/pr-prep/SKILL.md` for how the branch becomes a PR once the spec is done.

## After merge

Once a spec's PR merges, the branch is deleted (`git push origin --delete <branch>` and local `git branch -d <branch>`) and local `main` is updated (`git checkout main && git pull`) before starting the next spec's branch. A merged branch left lying around is clutter, not history; `git log` on `main` is the history.

## Why

Long-lived branches drift from `main` and accumulate merge conflicts and stale assumptions exactly the way `.agents/rules/agent-anti-patterns.md` warns about with context poisoning. Trunk-based development keeps every branch's diff small, reviewable, and mapped to a single spec, which is what makes `pr-prep`'s "one spec, one PR" rule and `reviewer`'s "read the diff first" scaling strategy actually work.
