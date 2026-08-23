# Rule: Cost Optimization

Always active. Every tool call, subagent spawn, and token of output has a real cost. This rule is about spending that budget where it actually buys correctness, not about being terse for its own sake.

## Concise output

Reports from any agent (findings, summaries, validation results) are structured and to the point: what was checked, what was found, what needs to happen next. Don't restate file contents the reader can already see, don't repeat a summary that a different agent already gave in the same session, and don't pad a clean result with filler. A finding list with zero items is a one-line statement, not an essay explaining why nothing was found.

## Catch problems before they're expensive

The cheapest place to fix an ambiguous requirement or a missing edge case is in `requirements.md`, before any code exists. The most expensive place is after `task-runner` has already implemented several tasks against a flawed design. This is why `spec-plan` runs the `spec-grill` skill against Requirements and Design before either is presented for approval, not after implementation starts. Skipping the grill to save a round-trip almost always costs more in rework later.

## Don't spawn what you can answer

Delegating to a subagent or another persona is for genuinely independent work (an actual second pass, a task that needs a fresh context window) not a way to avoid thinking through something you already have enough information to answer directly. If you already know the answer, say it; don't manufacture a delegation to feel thorough.

## Don't re-derive what's already known

Before reading a file, running a scan, or re-deriving a fact, check whether this session already has it. A file read three tool calls ago doesn't need to be read again unless it changed. A `security-scan` that already ran clean on the current diff doesn't need to run again unless the diff changed.

## Batch what can be batched

Independent reads, independent greps, independent tool calls that don't depend on each other's output go in the same batch, not one after another. Sequential calls that could have been parallel are wasted turnaround time, not just wasted tokens.

## Right-size the validation

Not every change needs the full gate matrix. A docs-only change doesn't need `qa` and `security` to run the full suite (see the gate matrix in `docs/testing-and-security.md`). Running every gate on every change isn't rigor, it's waste that trains people to skip the process on the changes that actually need it.
