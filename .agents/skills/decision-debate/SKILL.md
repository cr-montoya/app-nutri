---
name: decision-debate
description: Runs a structured, adversarial debate between the strongest case for each viable option when a decision has genuine trade-offs and no obvious right answer. Use it before locking in an architecture or product decision with more than one defensible approach; not for decisions that already have a clear best answer.
---

# Decision Debate

## When to use this

Reserve it for consequential forks: a decision with real downstream consequences (architecture, data model, protocol choice, a product trade-off affecting the core value in `.kiro/steering/product.md`) where at least two options are genuinely defensible. Don't run it for decisions that already have an obvious answer; that's `.agents/rules/cost-optimization.md`'s "right-size the validation" applied to decision-making, not laziness.

## Process

1. **State the decision.** One or two sentences: what's being decided, and what makes at least two options defensible (if you can't say why it's a real debate, it probably isn't one).
2. **Steelman each option.** For each viable option (typically 2 or 3; more than that is usually over-scoping the decision), lay out its strongest case, the argument a genuine expert would make for it. Where a persona's lens applies, use it explicitly: `database-architect`'s lens for a schema trade-off, `security`'s lens for an auth or data-handling trade-off, `nextjs-architect`'s lens for a rendering-strategy trade-off.
3. **Attack each option.** For each option, its strongest objection: what would actually go wrong, backed by something concrete (a constraint in `plan.md`/steering, a cost, a precedent) not a vague feeling.
4. **Cross-examine.** Does option A's strongest case survive option B's strongest objection to it, and vice versa? This is where a debate earns its cost over a simple pros/cons list; the point is testing whether the case actually holds up, not just listing it.
5. **Converge or don't.** State a recommendation with the trade-offs it explicitly accepts, or state plainly that it's genuinely close and ask the user to decide; don't manufacture a confident recommendation you don't actually believe.
6. **Hand off.** Present the outcome to the user for the final call (this skill prepares the decision, it doesn't make it alone). Once confirmed, use the `adr` skill to record it; see `.agents/rules/adr-required.md`.

## Rules

- Don't silently default to the safe or popular option without actually running steps 2 to 4; that's rubber-stamping the decision, see `.agents/rules/agent-anti-patterns.md`.
- Every debate that concludes gets an ADR. A debate without a resulting record is wasted work, and the next person hits the same fork with no memory of what was already argued.
- Keep the debate itself concise per `.agents/rules/cost-optimization.md`; the value is in the strongest arguments surviving cross-examination, not in exhaustive prose.
