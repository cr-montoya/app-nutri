# AppNutri — Plan de arquitectura (spec)

> Este documento es la fuente de verdad de la arquitectura de AppNutri. Cualquier cambio de arquitectura, modelo de datos o decisión de stack se refleja primero aquí antes que en código. `CLAUDE.md` explica cómo trabajar en este repo día a día; este archivo explica **qué se está construyendo y por qué**.

## 1. Visión del producto

AppNutri es una plataforma web SaaS **multi-tenant** para profesionales de nutrición (nutricionistas individuales y consultorios/clínicas con varios profesionales) que centraliza:

- Gestión de pacientes y su historia clínica/antecedentes.
- Agendamiento interno de citas (sin auto-agendamiento público en v1).
- Captura de datos de consulta: mediciones antropométricas (pliegues, perímetros, diámetros).
- Cálculo de composición corporal usando múltiples ecuaciones/protocolos según población, sexo y edad.
- Planes nutricionales por paciente/consulta.
- Visualización gráfica de la evolución del paciente en el tiempo.
- Almacenamiento de archivos adjuntos (fotos de progreso, PDFs de laboratorio).

Requisitos no funcionales explícitos: seguridad para datos clínicos sensibles, login robusto, aislamiento estricto de datos entre organizaciones, y una UI cuidada con animación con criterio.

## 2. Decisiones de stack

| Área | Elección | Motivo |
|---|---|---|
| Framework | Next.js 15 (App Router) + TypeScript + RSC | Un solo framework full-stack, encaja con despliegue en Vercel |
| Base de datos | Postgres en **Neon** (serverless, branching por PR) | Nativo de Vercel, buen free tier, branching de BD para previews y tests |
| ORM | **Prisma** (elegido sobre Drizzle) | Modelo muy relacional (Org→Profesional→Paciente→Cita→Consulta→Mediciones→Resultados→Plan); `$extends` permite forzar aislamiento multi-tenant globalmente sin poder "olvidarlo"; migraciones legibles y auditables, importante en un esquema clínico sujeto a revisión |
| Auth | **Auth.js (NextAuth) v5** — Credentials + argon2id, sesión JWT con claims de org/rol; Google OAuth opcional | Control total del modelo de roles/organización en nuestra propia base de datos (necesario para RLS); sin costo por usuario activo; permite añadir MFA después sin pelear con la UI de un proveedor externo |
| Aislamiento multi-tenant | `organizationId` en cada tabla tenant-scoped + **Postgres Row-Level Security** como defensa en profundidad | Doble capa: una Prisma Client Extension inyecta el filtro automáticamente en cada query; RLS protege incluso ante SQL crudo, bugs de código o herramientas de administración futuras |
| Almacenamiento de archivos | **Vercel Blob** (alternativa: Supabase Storage) con URLs firmadas | Fotos de progreso y PDFs de laboratorio, con control de acceso por organización, incluido desde el inicio (no diferido) |
| UI | Tailwind CSS v4 + shadcn/ui (Radix) + Framer Motion | Look propio, no "template de admin genérico"; accesible; animable con criterio |
| Gráficos | **Recharts** | Encaja con evolución temporal, radar de somatotipo, composición — sin la complejidad extra de una librería de bajo nivel como Visx |
| Calendario de citas | **FullCalendar** | Reprogramar con drag&drop y columnas por profesional; difícil de igualar a mano con calidad comparable |
| Formularios/validación | React Hook Form + Zod, esquemas compartidos cliente/servidor | Type-safe, mismos esquemas de validación en Server Actions |

## 3. Modelo multi-tenant

```
Organization (tenant)
  └─ Membership (User ↔ Organization, con role: ADMIN | NUTRICIONISTA | RECEPCION)
       └─ Professional (perfil clínico ligado 1:1 a una Membership con rol NUTRICIONISTA)
  └─ Patient
       └─ ClinicalHistory
       └─ Appointment
       └─ Consultation
            └─ AnthropometricMeasurement
                 └─ BodyCompositionResult (uno o más, por protocolo usado)
            └─ NutritionalPlan
       └─ PatientAttachment
  └─ AuditLog
```

Un `User` puede tener membership en varias organizaciones (ej. un profesional que trabaja en dos consultorios); cada sesión opera dentro de exactamente una organización activa (claim en el JWT / selector de organización en la UI).

### Aislamiento de datos — dos capas

1. **Prisma Client Extension** (capa principal): usa `AsyncLocalStorage` para llevar el contexto de tenant (`organizationId`, `userId`) de la request actual, e inyecta automáticamente ese `organizationId` en el `where` de toda lectura/actualización/borrado y en el `data` de toda creación, para los modelos tenant-scoped. Hace estructuralmente imposible olvidar el filtro en un Server Action nuevo.
2. **Postgres Row-Level Security** (defensa en profundidad): cada tabla tenant-scoped tiene una policy `USING ("organizationId" = current_setting('app.current_org_id', true))`. El wrapper de tenant-context ejecuta `SET LOCAL app.current_org_id = '<id>'` al inicio de cada transacción, de modo que RLS protege incluso ante SQL crudo, un bug en la extensión de Prisma, o herramientas de administración futuras que no pasen por la capa de aplicación.

## 4. Modelo de datos

Entidades principales y su propósito:

- **Organization** — el tenant. Nombre, slug, fecha de creación.
- **User** — cuenta de login (email, hash de contraseña, nombre). Independiente de organización; se relaciona vía `Membership`.
- **Membership** — join table `User`↔`Organization` con `role` (`ADMIN` | `NUTRICIONISTA` | `RECEPCION`). Único por par (user, org).
- **Professional** — perfil clínico (número de licencia, especialidad, firma) ligado 1:1 a una `Membership` con rol `NUTRICIONISTA`.
- **Patient** — datos demográficos del paciente (nombre, documento, fecha de nacimiento, sexo, contacto), scoped por `organizationId`.
- **ClinicalHistory** — antecedentes familiares, patologías personales, alergias, medicamentos, cirugías, hábitos — campos estructurados como JSON flexible (`{ condition, diagnosedAt, notes }` etc.) para no rigidizar el esquema clínico. 1:1 con `Patient`.
- **Appointment** — cita: paciente, profesional, fecha/hora, duración, `status` (`SCHEDULED` | `CONFIRMED` | `COMPLETED` | `CANCELLED` | `NO_SHOW`), motivo, notas.
- **Consultation** — la visita en sí; puede originarse de un `Appointment` completado (relación opcional 1:1). Contiene notas subjetivas y plan en texto libre además de las relaciones a mediciones y plan nutricional.
- **AnthropometricMeasurement** — 1:1 con `Consultation`. Peso, talla, y campos opcionales de pliegues (tríceps, subescapular, bíceps, cresta ilíaca, supraespinal, abdominal, muslo, pantorrilla), perímetros (cintura, cadera, brazo relajado/flexionado, pantorrilla) y diámetros (húmero, fémur, muñeca).
- **BodyCompositionResult** — resultado calculado a partir de una medición, **etiquetado con el protocolo/ecuación usada** (`protocolKey`, `protocolLabel`), con snapshot de inputs y outputs en JSON. Nunca se sobrescribe: cada cálculo (incluso re-cálculos con otro protocolo) genera un nuevo registro, para trazabilidad y comparación entre protocolos a lo largo del tiempo.
- **NutritionalPlan** — 1:1 con `Consultation`. Calorías objetivo, macros, plan de comidas (JSON), recomendaciones, vigencia.
- **PatientAttachment** — archivo adjunto (foto de progreso, PDF de laboratorio) almacenado en Vercel Blob, con `organizationId`, referencia al paciente y/o consulta, y metadata (tipo, fecha de subida, quién lo subió).
- **AuditLog** — quién (userId) hizo qué (`action`) sobre qué entidad (`entityType`, `entityId`) y cuándo, con metadata e IP. Obligatorio para toda escritura sobre `ClinicalHistory`, `Consultation`, `AnthropometricMeasurement`, `NutritionalPlan`, `PatientAttachment`; para lectura, al menos en el detalle de `ClinicalHistory` y `Consultation`.

Todas las tablas tenant-scoped llevan `organizationId` indexado.

## 5. Motor de cálculo de composición corporal

**Patrón: Strategy + Registry.** Cada ecuación/protocolo es un módulo autocontenido que implementa una interfaz común:

```ts
interface BodyCompositionProtocol {
  key: string;                    // "durnin-womersley-siri"
  label: string;                  // "Durnin-Womersley (4 pliegues) + Siri"
  category: 'skinfold_equation' | 'general_formula' | 'somatotype' | 'growth_chart';
  applicablePopulations: Population[];   // 'general' | 'colombia_adult' | 'athlete' | 'pediatric'
  applicableSex: Sex[] | 'both';
  ageRange?: [number, number];
  requiredInputs: string[];
  isApplicable(ctx: ProtocolContext): boolean;
  calculate(ctx: ProtocolContext): ProtocolResult;
}
```

Un `ProtocolRegistry` central permite filtrar, dado el contexto de un paciente (sexo, edad, población, qué mediciones tiene disponibles), qué protocolos son aplicables — la UI puede mostrar "qué se puede calcular con estos datos" o correr varios protocolos en paralelo para comparar resultados. Añadir una ecuación nueva es un cambio aditivo: un archivo nuevo en `src/calc-engine/protocols/` que se auto-registra, sin tocar el resto del sistema.

### Protocolos en v1 (validados, con evidencia sólida)

- **Durnin-Womersley (4 pliegues) + ecuación de Siri** — %grasa corporal, población adulta general.
- **Jackson-Pollock (3 sitios)** — alternativa estándar.
- **IMC** — fórmula general, siempre aplicable con peso y talla.
- **TMB (Mifflin-St Jeor)** — fórmula general, siempre aplicable con peso, talla y edad.

### Sobre ecuaciones de población colombiana/latina

Existe la ecuación **Ramírez/Torun**, estudiada en mujeres adultas colombianas (Aristizábal et al., *Colombia Médica*, 2018), pero el propio estudio de validación encontró **concordancia pobre** frente al estándar de hidrodensitometría (32.0±5.3% vs 29.6±5.8%, diferencia estadísticamente significativa). No existe consenso tipo ISAK sobre una ecuación colombiana claramente superior a Durnin-Womersley/Jackson-Pollock para adultos.

**Decisión**: incluir Ramírez/Torun como protocolo **opcional y claramente etiquetado** con la salvedad de validación en la UI, no como recomendado por defecto, y pedir el visto bueno de un profesional de nutrición antes de promoverla. La arquitectura de registro soporta esto sin fricción.

**Pacientes pediátricos** quedan fuera del alcance de estas ecuaciones de adultos. Si se necesitan, requieren un enfoque de percentiles OMS/ICBF como categoría de protocolo separada (`growth_chart`), a definir en una fase posterior — no está en el alcance de v1.

## 6. Seguridad y datos sensibles

- Contraseñas con **argon2id** (no bcrypt), política mínima de 12 caracteres, verificación contra contraseñas filtradas (HIBP range API).
- Sesión JWT de vida corta (~8h) con `tokenVersion` en `User` para poder invalidar todas las sesiones de una cuenta.
- Rate limiting en rutas de autenticación (Upstash Ratelimit) contra credential stuffing.
- RBAC con matriz de permisos por rol, **verificado siempre en el servidor** (Server Actions/Route Handlers), nunca solo ocultando UI en cliente.
- TLS + HSTS por defecto (Vercel); backups con point-in-time recovery (Neon).
- Cumplimiento de la **Ley 1581 de 2012 (Habeas Data)** de Colombia para datos sensibles de salud: consentimiento informado al crear un paciente, página de Política de Tratamiento de Datos, proceso de notificación de brechas. Requiere revisión legal, no solo ingeniería.
- MFA (TOTP) para rol ADMIN y evaluación de cifrado a nivel de campo para las notas clínicas más sensibles: endurecimiento recomendado antes de manejar pacientes reales en producción, no bloqueante para el MVP.

### Matriz de permisos por rol (referencia)

| Acción | ADMIN | NUTRICIONISTA | RECEPCION |
|---|---|---|---|
| Gestionar miembros/roles de la organización | sí | no | no |
| CRUD de pacientes | sí | sí | sí (solo demografía) |
| Ver historia clínica/consultas | sí | sí | no |
| Crear/editar consultas, mediciones, planes | sí | sí | no |
| Agendar/gestionar citas | sí | sí | sí |
| Ver reportes/dashboards | sí | sí (propios) | limitado (ocupación) |

## 7. UI/UX y animación

Sidebar con selector de organización y navegación (Dashboard / Pacientes / Citas / Configuración). Perfil de paciente en tabs: Resumen, Antecedentes, Historial de Consultas, Planes Nutricionales. Paleta cálida/clínica vía variables CSS de shadcn (ajustable sin rehacer componentes).

Animación con criterio, no decorativa:
- Transición sutil entre rutas (fade + slide en el contenido principal).
- Stat cards del dashboard con aparición escalonada y conteo animado al cargar.
- Gráficos de evolución que se "dibujan" al cargar — refuerza la narrativa de progreso que es el valor central del producto.
- Feedback de formularios: shake en error de validación, check en guardado exitoso.
- Estados vacíos ("aún no hay pacientes/citas") con motion suave.

Evitar: animar cada elemento de una lista en cada render, scroll-jacking, o cualquier animación que añada latencia percibida a flujos de captura de datos intensivos.

## 8. Fases de entrega

**Fase 0 — Scaffold, auth, esqueleto multi-tenant**
Next.js+TS+Tailwind+shadcn; Prisma+Neon; modelos `Organization`/`User`/`Membership`/`Professional`; login/registro con creación de organización; middleware de tenant-context + Prisma extension probado con dos organizaciones (verificar cero visibilidad cruzada); RLS aplicado; deploys de preview en Vercel+Neon funcionando.

**Fase 1 — Pacientes, citas y almacenamiento de archivos**
CRUD de `Patient` (búsqueda/filtro/perfil); `Appointment` + calendario (FullCalendar) con transiciones de estado; RBAC por rol; `PatientAttachment` con Vercel Blob y URLs firmadas; audit log en creación/edición/vista de paciente.

**Fase 2 — Historia clínica + captura antropométrica + motor de cálculo**
`ClinicalHistory` CRUD; creación de `Consultation` (opcionalmente desde una cita completada); formulario de `AnthropometricMeasurement` con validación de rangos (Zod); motor de cálculo (registry + Durnin-Womersley+Siri, Jackson-Pollock, IMC, Mifflin-St Jeor) persistiendo en `BodyCompositionResult`.

**Fase 3 — Planes nutricionales**
`NutritionalPlan` ligado a una consulta (calorías/macros/plan de comidas/recomendaciones); historial de planes por paciente; exportación básica a PDF.

**Fase 4 — Gráficos y dashboards**
Evolución del paciente (peso, IMC, %grasa, suma de pliegues, series múltiples); radar/barras de composición por consulta; dashboard a nivel de organización (citas próximas, pacientes activos, estados).

**Fase 5 — Pulido, animación y endurecimiento**
Pase de Framer Motion según §7; MFA (TOTP) para ADMIN; rate limiting de auth; evaluación de cifrado a nivel de campo; consentimiento Habeas Data + página de política de datos; revisión de rendimiento (streaming, paginación, índices).

## 9. Estrategia de testing y seguridad

Esta sección documenta **qué herramientas se usarán y por qué**. El cableado real en CI (GitHub Actions) — el "harness" — se define en una iteración posterior; aquí se fija la estrategia para que el harness se construya sobre decisiones ya tomadas.

| Capa | Herramienta | Uso |
|---|---|---|
| Tests unitarios/integración | **Vitest** + React Testing Library | Lógica de negocio (motor de cálculo, validadores Zod, helpers de RBAC/tenant-context) y componentes aislados. Rápido, nativo TS/ESM, encaja con Next.js. |
| Tests end-to-end | **Playwright** | Flujos completos: registro/login, crear organización, crear paciente, agendar cita, capturar consulta con mediciones, generar plan nutricional. Corre headless en CI contra un entorno de preview o local con base de datos de prueba (Neon branching por PR). |
| SAST | **Semgrep** (reglas OWASP Top 10 + reglas JS/TS/React) | Análisis estático en cada PR vía GitHub Action. |
| Lint de seguridad | **eslint-plugin-security** | Capa adicional dentro del lint normal, detecta patrones inseguros comunes en Node/JS. |
| Secret scanning | **gitleaks** | Pre-commit y en CI, evita commitear credenciales/tokens. |
| DAST | **OWASP ZAP Baseline Scan** | Contra el deployment de preview de Vercel en cada PR, una vez exista un entorno desplegado. |
| SBOM | **`@cyclonedx/cyclonedx-npm`** | Genera SBOM en formato CycloneDX en cada build/release, publicado como artifact. |
| Escaneo de dependencias | **GitHub Dependabot** (alerts + PRs automáticos) + `npm audit --audit-level=high` | Dependabot para actualizaciones continuas; `npm audit` como gate duro en CI. |
| Checklist de referencia | **OWASP ASVS / Top 10** | Mapeado explícitamente a los controles ya presentes en la arquitectura: RLS (inyección/control de acceso), RBAC server-side (control de acceso roto), argon2id (fallas criptográficas), audit log (fallas de logging/monitoreo), rate limiting (fuerza bruta). |

Ver `CLAUDE.md` para cómo se invoca cada una de estas herramientas una vez exista el scaffold del proyecto, y la definición de "listo" para un cambio.

## 10. Riesgos y decisiones abiertas

1. **Ecuación Ramírez/Torun**: pendiente visto bueno de un profesional de nutrición antes de recomendarla por defecto (ver §5).
2. **Pacientes pediátricos**: si se necesitan, requieren un módulo de percentiles OMS/ICBF separado, no cubierto en v1.
3. **Residencia de datos**: Neon usa por defecto regiones US/EU — confirmar si hay requisito legal de residencia en Colombia antes de escalar a producción con pacientes reales.
4. **Revisión legal**: cumplimiento formal de la Ley 1581 de 2012 antes de procesar datos de pacientes reales — requiere a alguien con experiencia legal en protección de datos en Colombia, no solo ingeniería.
5. **Multi-org por profesional**: el modelo soporta que un usuario pertenezca a varias organizaciones; confirmar si es un escenario real que justifique la UX de un selector de organización, o si se puede simplificar.
6. **Telehealth/video**: fuera de alcance según los requisitos actuales — confirmar antes de fijar el modelo de `Consultation`, ya que añadiría integración de video y cambiaría el flujo.
