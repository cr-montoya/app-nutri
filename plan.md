# AppNutri: Architecture Plan (spec)

> This document is the source of truth for AppNutri's architecture. Any architecture, data model, or stack decision change is reflected here first, before code. `CLAUDE.md` explains how to work in this repo day to day; this file explains **what is being built and why**.

## 1. Product vision

AppNutri is a **multi-tenant** SaaS web platform for nutrition professionals (individual dietitians and clinics/practices with multiple professionals) that centralizes:

- Patient management and their clinical history/background.
- Internal appointment scheduling (no public self-booking in v1).
- Consultation data capture: anthropometric measurements (skinfolds, circumferences, diameters).
- Body composition calculation using multiple equations/protocols by population, sex, and age.
- Nutritional plans per patient/consultation.
- Graphical visualization of the patient's evolution over time.
- Attachment storage (progress photos, lab PDFs).

Explicit non-functional requirements: security for sensitive clinical data, robust login, strict data isolation between organizations, and a polished UI with purposeful animation.

## 2. Stack decisions

| Area | Choice | Reason |
|---|---|---|
| Framework | Next.js 15 (App Router) + TypeScript + RSC | Single full-stack framework, fits Vercel deployment |
| Database | Postgres on **Neon** (serverless, per-PR branching) | Vercel-native, good free tier, DB branching for previews and tests |
| Package manager | **pnpm** only, no npm or yarn | Strict node_modules layout catches phantom dependencies; one lockfile, no ambiguity in CI |
| ORM | **Prisma** (chosen over Drizzle) | Highly relational model (Org, Professional, Patient, Appointment, Consultation, Measurements, Results, Plan all linked); `$extends` lets us enforce multi-tenant isolation globally with no way to "forget it"; readable, auditable migrations, important for a clinical schema under review |
| Auth | **Auth.js (NextAuth) v5**: Credentials + argon2id, JWT session with org/role claims; optional Google OAuth | Full control over the role/organization model in our own database (needed for RLS); no per-active-user cost; MFA can be added later without fighting a third-party provider's UI |
| Multi-tenant isolation | `organizationId` on every tenant-scoped table + **Postgres Row-Level Security** as defense in depth | Two layers: a Prisma Client Extension injects the filter automatically on every query; RLS protects even against raw SQL, code bugs, or future admin tooling |
| File storage | **Vercel Blob** (alternative: Supabase Storage) with signed URLs | Progress photos and lab PDFs, with per-organization access control, included from the start (not deferred) |
| UI | Tailwind CSS v4 + shadcn/ui (Radix) + Framer Motion | Distinctive look, not a "generic admin template"; accessible; purposefully animatable |
| Charts | **Recharts** | Fits time-series evolution, somatotype radar, composition, without the extra complexity of a low-level library like Visx |
| Appointment calendar | **FullCalendar** | Drag-and-drop rescheduling and per-professional columns; hard to match by hand at comparable quality |
| Forms/validation | React Hook Form + Zod, shared client/server schemas | Type-safe, same validation schemas reused in Server Actions |

## 3. Multi-tenant model

```
Organization (tenant)
  └─ Membership (User ↔ Organization, role: ADMIN | NUTRITIONIST | FRONT_DESK)
       └─ Professional (clinical profile, 1:1 with a Membership of role NUTRITIONIST)
  └─ Patient
       └─ ClinicalHistory
       └─ Appointment
       └─ Consultation
            └─ AnthropometricMeasurement
                 └─ BodyCompositionResult (one or more, per protocol used)
            └─ NutritionalPlan
       └─ PatientAttachment
  └─ AuditLog
```

A `User` can have membership in several organizations (for example a professional working at two clinics); each session operates within exactly one active organization (JWT claim / organization switcher in the UI).

### Data isolation: two layers

1. **Prisma Client Extension** (primary layer): uses `AsyncLocalStorage` to carry the current request's tenant context (`organizationId`, `userId`), and automatically injects that `organizationId` into the `where` of every read/update/delete and into the `data` of every create, for tenant-scoped models. Makes it structurally impossible to forget the filter in a new Server Action.
2. **Postgres Row-Level Security** (defense in depth): every tenant-scoped table has a policy `USING ("organizationId" = current_setting('app.current_org_id', true))`. The tenant-context wrapper runs `SET LOCAL app.current_org_id = '<id>'` at the start of every transaction, so RLS protects even against raw SQL, a bug in the Prisma extension, or future admin tooling that bypasses the application layer.

## 4. Data model

Core entities and their purpose:

- **Organization**: the tenant. Name, slug, creation date.
- **User**: login account (email, password hash, name). Independent of organization; related via `Membership`.
- **Membership**: join table `User` to `Organization` with `role` (`ADMIN` | `NUTRITIONIST` | `FRONT_DESK`). Unique per (user, org) pair.
- **Professional**: clinical profile (license number, specialty, signature) linked 1:1 to a `Membership` of role `NUTRITIONIST`.
- **Patient**: patient demographics (name, ID document, birth date, sex, contact info), scoped by `organizationId`.
- **ClinicalHistory**: family history, personal pathologies, allergies, medications, surgeries, habits. Fields structured as flexible JSON (`{ condition, diagnosedAt, notes }` etc.) to avoid rigidifying the clinical schema. 1:1 with `Patient`.
- **Appointment**: patient, professional, date/time, duration, `status` (`SCHEDULED` | `CONFIRMED` | `COMPLETED` | `CANCELLED` | `NO_SHOW`), reason, notes.
- **Consultation**: the visit itself; may originate from a completed `Appointment` (optional 1:1 relation). Holds free-text subjective notes and plan in addition to the measurement and nutritional plan relations.
- **AnthropometricMeasurement**: 1:1 with `Consultation`. Weight, height, and optional skinfold fields (triceps, subscapular, biceps, iliac crest, supraspinale, abdominal, thigh, calf), circumferences (waist, hip, relaxed/flexed arm, calf), and diameters (humerus, femur, wrist).
- **BodyCompositionResult**: result calculated from a measurement, **tagged with the protocol/equation used** (`protocolKey`, `protocolLabel`), with a JSON snapshot of inputs and outputs. Never overwritten: every calculation (even a recalculation with a different protocol) creates a new record, for traceability and protocol comparison over time.
- **NutritionalPlan**: 1:1 with `Consultation`. Target calories, macros, meal plan (JSON), recommendations, validity period.
- **PatientAttachment**: attached file (progress photo, lab PDF) stored in Vercel Blob, with `organizationId`, a reference to the patient and/or consultation, and metadata (type, upload date, uploaded by).
- **AuditLog**: who (userId) did what (`action`) to which entity (`entityType`, `entityId`) and when, with metadata and IP. Mandatory for every write to `ClinicalHistory`, `Consultation`, `AnthropometricMeasurement`, `NutritionalPlan`, `PatientAttachment`; for reads, at minimum on `ClinicalHistory` and `Consultation` detail views.

Every tenant-scoped table has an indexed `organizationId`.

## 5. Body composition calculation engine

**Pattern: Strategy + Registry.** Each equation/protocol is a self-contained module implementing a common interface:

```ts
interface BodyCompositionProtocol {
  key: string;                    // "durnin-womersley-siri"
  label: string;                  // "Durnin-Womersley (4 skinfolds) + Siri"
  category: 'skinfold_equation' | 'general_formula' | 'somatotype' | 'growth_chart';
  applicablePopulations: Population[];   // 'general' | 'colombia_adult' | 'athlete' | 'pediatric'
  applicableSex: Sex[] | 'both';
  ageRange?: [number, number];
  requiredInputs: string[];
  isApplicable(ctx: ProtocolContext): boolean;
  calculate(ctx: ProtocolContext): ProtocolResult;
}
```

A central `ProtocolRegistry` filters, given a patient's context (sex, age, population, which measurements are available), which protocols apply. The UI can show "what can be calculated with this data" or run several protocols in parallel to compare results. Adding a new equation is an additive change: a new self-registering file in `src/calc-engine/protocols/`, with no changes to the rest of the system.

### v1 protocols (validated, with solid evidence)

- **Durnin-Womersley (4 skinfolds) + Siri equation**: body fat %, general adult population.
- **Jackson-Pollock (3-site)**: standard alternative.
- **BMI**: general formula, always applicable with weight and height.
- **BMR (Mifflin-St Jeor)**: general formula, always applicable with weight, height, and age.

### On Colombian/Latin American population equations

The **Ramírez/Torun** equation exists, studied in Colombian adult women (Aristizábal et al., *Colombia Médica*, 2018), but the validation study itself found **poor agreement** against the hydrodensitometry gold standard (32.0±5.3% vs 29.6±5.8%, a statistically significant difference). There is no ISAK-level consensus on a Colombian equation clearly superior to Durnin-Womersley/Jackson-Pollock for adults.

**Decision**: include Ramírez/Torun as an **optional, clearly labeled** protocol with the validation caveat shown in the UI, not recommended by default, and requiring sign-off from a nutrition professional before promoting it. The registry architecture supports this without friction.

**Pediatric patients** are out of scope for these adult equations. If needed, they require a WHO/ICBF percentile-based approach as a separate protocol category (`growth_chart`), to be defined in a later phase. Not in v1 scope.

## 6. Security and sensitive data

- Passwords with **argon2id** (not bcrypt), minimum 12-character policy, checked against breached passwords (HIBP range API).
- Short-lived JWT session (~8h) with a `tokenVersion` field on `User` to invalidate all sessions for an account.
- Rate limiting on authentication routes (Upstash Ratelimit) against credential stuffing.
- RBAC with a per-role permission matrix, **always verified server-side** (Server Actions/Route Handlers), never only by hiding UI on the client.
- TLS + HSTS by default (Vercel); backups with point-in-time recovery (Neon).
- Compliance with Colombia's **Law 1581 of 2012 (Habeas Data)** for sensitive health data: informed consent captured when creating a patient, a Data Processing Policy page, a breach-notification process. Requires legal review, not just engineering.
- MFA (TOTP) for the ADMIN role and an evaluation of field-level encryption for the most sensitive clinical notes: recommended hardening before handling real patients in production, not an MVP blocker.

### Role permission matrix (reference)

| Action | ADMIN | NUTRITIONIST | FRONT_DESK |
|---|---|---|---|
| Manage organization members/roles | yes | no | no |
| Patient CRUD | yes | yes | yes (demographics only) |
| View clinical history/consultations | yes | yes | no |
| Create/edit consultations, measurements, plans | yes | yes | no |
| Schedule/manage appointments | yes | yes | yes |
| View reports/dashboards | yes | yes (own) | limited (occupancy only) |

## 7. UI/UX and animation

Sidebar with organization switcher and navigation (Dashboard / Patients / Appointments / Settings). Patient profile in tabs: Overview, Background, Consultation History, Nutritional Plans. Warm/clinical palette via shadcn CSS variables (adjustable without rebuilding components).

Purposeful animation, not decorative:
- Subtle route transitions (fade + slide on main content).
- Dashboard stat cards with staggered entrance and animated count-up on load.
- Evolution charts that "draw themselves" on load, reinforcing the progress narrative that is the product's core value.
- Form feedback: shake on validation error, checkmark on successful save.
- Empty states ("no patients/appointments yet") with gentle motion.

Avoid: animating every list item on every render, scroll-jacking, or any animation that adds perceived latency to data-entry-heavy flows.

## 8. Delivery phases

**Phase 0: Scaffold, auth, multi-tenant skeleton**
Next.js+TS+Tailwind+shadcn; Prisma+Neon; `Organization`/`User`/`Membership`/`Professional` models; login/registration with organization creation; tenant-context middleware + Prisma extension tested with two organizations (verify zero cross-visibility); RLS applied; working Vercel+Neon preview deploys.

**Phase 1: Patients, appointments, and file storage**
`Patient` CRUD (search/filter/profile); `Appointment` + calendar (FullCalendar) with status transitions; per-role RBAC; `PatientAttachment` with Vercel Blob and signed URLs; audit log on patient creation/edit/view.

**Phase 2: Clinical history, anthropometric capture, and calculation engine**
`ClinicalHistory` CRUD; `Consultation` creation (optionally from a completed appointment); `AnthropometricMeasurement` form with range validation (Zod); calculation engine (registry + Durnin-Womersley+Siri, Jackson-Pollock, BMI, Mifflin-St Jeor) persisting to `BodyCompositionResult`.

**Phase 3: Nutritional plans**
`NutritionalPlan` tied to a consultation (calories/macros/meal plan/recommendations); per-patient plan history; basic PDF export.

**Phase 4: Charts and dashboards**
Patient evolution (weight, BMI, %fat, sum of skinfolds, multi-series); per-consultation composition radar/bar charts; org-level dashboard (upcoming appointments, active patients, statuses).

**Phase 5: Polish, animation, and hardening**
Framer Motion pass per §7; MFA (TOTP) for ADMIN; auth rate limiting; field-level encryption evaluation; Habeas Data consent + data policy page; performance review (streaming, pagination, indexes).

## 9. Testing and security strategy

This section documents **which tools will be used and why**. The actual CI wiring (GitHub Actions), the "harness," is defined in a later iteration; this fixes the strategy so the harness gets built on top of decisions already made.

| Layer | Tool | Use |
|---|---|---|
| Unit/integration tests | **Vitest** + React Testing Library | Business logic (calculation engine, Zod validators, RBAC/tenant-context helpers) and isolated components. Fast, native TS/ESM, fits Next.js. |
| End-to-end tests | **Playwright** | Full flows: register/login, create organization, create patient, schedule appointment, capture a consultation with measurements, generate a nutritional plan. Runs headless in CI against a preview environment or local test database (Neon branching per PR). |
| SAST | **Semgrep** (OWASP Top 10 rules + JS/TS/React rules) | Static analysis on every PR via GitHub Action. |
| Security lint | **eslint-plugin-security** | Additional layer within normal linting, catches common insecure patterns in Node/JS. |
| Secret scanning | **gitleaks** | Pre-commit and in CI, prevents committing credentials/tokens. |
| DAST | **OWASP ZAP Baseline Scan** | Against the Vercel preview deployment on every PR, once a deployed environment exists. |
| SBOM | **`@cyclonedx/cyclonedx-npm`** (run via `pnpm dlx`) | Generates a CycloneDX-format SBOM on every build/release, published as an artifact. |
| Dependency scanning | **GitHub Dependabot** (alerts + automated PRs) + `pnpm audit --audit-level=high` | Dependabot for continuous updates; `pnpm audit` as a hard gate in CI. |
| Reference checklist | **OWASP ASVS / Top 10** | Explicitly mapped to controls already present in the architecture: RLS (injection/access control), server-side RBAC (broken access control), argon2id (cryptographic failures), audit log (logging/monitoring failures), rate limiting (brute force). |

See `CLAUDE.md` for how each of these tools is invoked once the project scaffold exists, and the definition of "done" for a change.

## 10. Risks and open decisions

1. **Ramírez/Torun equation**: pending sign-off from a nutrition professional before recommending it by default (see §5).
2. **Pediatric patients**: if needed, require a separate WHO/ICBF percentile module, not covered in v1.
3. **Data residency**: Neon defaults to US/EU regions. Confirm whether there's a legal requirement for Colombian data residency before scaling to production with real patients.
4. **Legal review**: formal compliance with Law 1581 of 2012 before processing real patient data. Requires someone with Colombian data-protection legal expertise, not just engineering.
5. **Multi-org per professional**: the model supports a user belonging to multiple organizations; confirm whether this is a real enough scenario to justify the organization-switcher UX, or whether it can be simplified.
6. **Telehealth/video**: out of scope per current requirements. Confirm before locking down the `Consultation` model, since it would add video integration and change the flow.
