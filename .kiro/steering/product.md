# Steering: Product

Persistent context — always read before proposing or designing a feature.

## Vision

AppNutri centralizes the full flow of a nutrition consultation for professionals and clinics: patients, appointments, clinical history, anthropometric measurements, body composition calculation with multiple population-specific equations, nutritional plans, and visualization of the patient's evolution over time.

## Users

- **ADMIN**: manages the organization/clinic, members, and roles.
- **NUTRITIONIST**: views and edits clinical history, captures consultations, calculates body composition, creates nutritional plans.
- **FRONT_DESK**: manages patients (demographics only) and appointments; no access to clinical history or consultation data.

Multi-tenant by design: several professionals/clinics on the same platform, with strict data isolation between organizations.

## Core value

"Progress over time" — the patient and the professional must be able to clearly see how measurements and body composition evolve consultation to consultation. Any product decision that obscures that narrative (cluttered UI, unclear charts, friction in data capture) works against the core value.

## Out of scope (v1)

- Public patient self-booking (scheduling is internal only).
- Telehealth/video.
- Pediatric patients (require a different WHO/ICBF percentile approach — see `plan.md` §5 and §10).

Full detail: `plan.md` §1.
