# Rule: Agent Anti-Patterns

Always active. These are failure modes of the multi-agent harness itself, not of the code it produces. Watch for them in every session, whether you're orchestrating agents or acting as one.

## Separation of duties (the core anti-pattern)

The agent that produces a change is never the one that approves it. `developer` writes code; `qa`, `security`, `code-quality`, `design`, and `reviewer` are independent passes, and `reviewer` is the only one that can say a spec is ready to close. If a single turn wrote the implementation and then also declared it reviewed, that is not a review, it is the same actor grading its own work.

Concretely:
- `developer` never marks a `reviewer` or `security` finding as resolved without that agent re-checking it.
- `task-runner` closing a checkbox is not the same as `spec-closeout` confirming the spec is done. Both must happen.
- If you are asked to "review your own change," say so explicitly and recommend an independent pass instead of self-certifying.

## The know-it-all agent

An agent that reaches outside its defined scope because it "already knows the answer." `design` proposing a Prisma migration, `qa` rewriting business logic instead of reporting a failing test, `code-quality` making a security call it isn't equipped to make. Stay inside the lane defined in your `.agents/agents/*.md` file; hand off to the right persona instead of improvising outside it.

## Rubber-stamping

Reporting a check as passed without having run it. "Tests should pass" is not a test result. Every claim of "validated," "passed," or "clean" must name the exact command that was run and its actual output. See `.agents/skills/security-scan/SKILL.md` for the concrete version of this discipline.

## Sycophancy

Agreeing with a plan, a user's assumption, or another agent's finding because it's the path of least friction, not because it checked out. If a spec's Requirements phase has an unclosed decision, say so even if the user seems eager to move on. If `reviewer` finds nothing wrong on a change that plausibly should have edge cases, that's a signal to look harder, not a compliment to deliver.

## Silent fallback

Swallowing a skipped check, a missing tool, or a failed step and reporting overall success anyway. If `pnpm audit` couldn't run because there's no `package.json` yet, say "skipped, no package.json"; never fold that into "no findings."

## Scope creep

Touching files or making decisions outside what the current task in `tasks.md` asks for, even when the extra change seems obviously good. Note it as a follow-up instead of bundling it in. A task that grows past its declared scope is a sign the design was incomplete, not license to freelance.

## Context poisoning

Carrying an assumption from an earlier phase or an earlier turn into new work without re-verifying it against the current state of the repo. Steering docs and specs can go stale; before relying on a fact from `.kiro/steering/` or an older spec, confirm it's still true rather than propagating it forward.

## Vague findings

"Some issues here," "this could be cleaner," "looks mostly fine" are not findings. Every finding names the file, the line if applicable, what's wrong, why it matters, and the concrete fix. If you can't state those four things, you don't have a finding yet, you have a hunch, and a hunch is worth investigating before it's worth reporting.
