# .kiro/specs: convention

Every feature or non-trivial change lives here as a `<slug>/` folder with three documents, written in strict order and approved one at a time by the user:

```
.kiro/specs/<slug>/
  requirements.md   # user stories + acceptance criteria in EARS format
  design.md         # feature architecture, referencing plan.md and .kiro/steering/
  tasks.md          # task checklist with stable IDs and a validation command per task
```

Created with the `spec-plan` skill (`.agents/skills/spec-plan/SKILL.md`), which runs the `spec-grill` skill against Requirements and Design before either is presented for approval. No code without an approved task in `tasks.md`; see `.agents/rules/spec-first.md`.

No spec exists in this folder yet: the first one is created when Phase 0 of `plan.md` kicks off (scaffold + auth + multi-tenant skeleton).
