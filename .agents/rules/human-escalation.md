# Rule: Human Escalation After 3 Failed Attempts

Always active. Applies to any fix-and-rerun loop: `task-runner` validating a task, `spec-closeout` resolving drift, `security-scan` remediating a finding, or any agent stuck making a check pass.

## The rule

If the same validation command has failed 3 times in a row for the same task or finding, after 3 distinct fix attempts, stop. Do not try a 4th variation. Report to the user:

- What was attempted (the 3 approaches, briefly).
- The exact failure each time (not "still failing," the actual error).
- Your best hypothesis for why it's stuck, even if you're not certain.
- What you need from the user to unblock: a decision, missing context, access to something, or confirmation that the approach itself is wrong.

## Why 3, and why this matters

Two failed attempts can be bad luck or a typo. Three failed attempts with genuinely different approaches is a signal that something about the task, the design, or an assumption is wrong, not that the next tweak will fix it. Continuing to iterate past that point burns cost (see `.agents/rules/cost-optimization.md`) and risks producing a change that technically passes validation through an increasingly contorted fix rather than because it's actually correct.

## What does not count as a distinct attempt

Rerunning the exact same fix expecting a different result. Cosmetic changes to the same broken approach (renaming a variable, reordering unrelated code) without changing the actual logic being tested. Three attempts means three different theories of what's wrong, not three keystrokes on the same theory.

## Marking state

While escalating, leave the task `[BLOCKED]` in `tasks.md` with the reason (per `.agents/skills/task-runner/SKILL.md`), not silently unmarked. The next session, human or agent, needs to see that this task hit a wall without re-discovering it from scratch.
