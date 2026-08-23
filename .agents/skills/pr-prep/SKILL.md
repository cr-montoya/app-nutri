---
name: pr-prep
description: Prepares and opens the PR (GitHub, what a GitLab workflow would call an MR) for a spec once every task in tasks.md is implemented and spec-closeout reports it clean. Use it once a feature is actually done, not before.
---

# PR Prep

## Precondition

Run `spec-closeout` first if it hasn't already run for this spec in this session. Do not open a PR while:

- Any `REQ-XXX` in `requirements.md` lacks a passing validation.
- Any task in `tasks.md` is unchecked or `[BLOCKED]` without an explicit decision to ship partial scope (confirm with the user first if so).
- A required gate from the matrix in `docs/testing-and-security.md` hasn't run for this change type.

If any of these are true, stop and report what's missing instead of opening a PR anyway.

## Branch

`task-runner` already created the spec's branch per `.agents/rules/trunk-based.md` (`<type>/<slug>`). If the current branch is `main`, something skipped that step; stop and tell the user instead of opening a PR from `main` or creating a branch retroactively without asking.

## Process

1. Confirm the branch is pushed: `git push -u origin <branch>` if it isn't tracked yet, `git push` otherwise. Never force-push here.
2. Build the PR body from `.github/PULL_REQUEST_TEMPLATE.md`, filled in from the spec, not left as placeholders:
   - **Spec**: the `.kiro/specs/<slug>/` path.
   - **Requirements closed**: every `REQ-XXX` from `requirements.md`.
   - **Changes**: a short bullet list derived from the commits on the branch, not a copy of the diff.
   - **Gates run**: check exactly the ones that actually ran, matching what `spec-closeout` confirmed.
   - **Testing**: the exact commands run and their result, not "should pass."
   - **Security checklist**: filled in if the change touched auth, tenant-scoped models, or dependencies; otherwise state it doesn't apply.
   - **Deviations**: copied from `design.md`'s `## Deviations` section if one exists, otherwise "None."
3. Title follows the same convention as commits: `<type>(<scope>): <description>`, summarizing the spec's objective, not the last commit.
4. Open it: `gh pr create --title "<title>" --body "<body>" --base main`.
5. Report the PR URL back to the user.

## Rules

- One spec, one PR. Don't bundle two specs into the same PR.
- Never mark a checklist box you didn't actually verify; see `.agents/rules/agent-anti-patterns.md` on rubber-stamping.
- You don't merge the PR. Opening it is the end of this skill; merging is a human decision.

## After merge

Once the human confirms the PR merged, clean up per `.agents/rules/trunk-based.md`: delete the branch (`git push origin --delete <branch>`, `git branch -d <branch>`), then `git checkout main && git pull` before starting the next spec.
