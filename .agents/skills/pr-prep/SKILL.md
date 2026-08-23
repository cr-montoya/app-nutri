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

Work for a spec happens on a branch named `<type>/<slug>`, where `<type>` matches the commit type (`feat`, `fix`, `refactor`, and so on) and `<slug>` matches `.kiro/specs/<slug>/`. If work was done directly on `main`, stop and tell the user; don't open a PR from `main` and don't create a branch retroactively without asking.

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
