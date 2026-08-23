# Steering: Producto

Contexto persistente — léelo siempre antes de proponer o diseñar una feature.

## Visión

AppNutri centraliza el flujo completo de una consulta de nutrición para profesionales y consultorios: pacientes, citas, historia clínica, mediciones antropométricas, cálculo de composición corporal con múltiples ecuaciones según población, planes nutricionales, y visualización de la evolución del paciente en el tiempo.

## Usuarios

- **ADMIN**: gestiona la organización/consultorio, miembros y roles.
- **NUTRICIONISTA**: ve y edita historia clínica, captura consultas, calcula composición corporal, crea planes nutricionales.
- **RECEPCION**: gestiona pacientes (solo demografía) y citas; sin acceso a historia clínica ni datos de consulta.

Multi-tenant desde el diseño: varios profesionales/consultorios en la misma plataforma, con aislamiento estricto de datos entre organizaciones.

## Valor central

"Progreso a lo largo del tiempo" — el paciente y el profesional deben poder ver claramente cómo evolucionan las mediciones y la composición corporal consulta a consulta. Toda decisión de producto que oscurezca esa narrativa (UI recargada, gráficos poco claros, fricción en captura de datos) va en contra del valor central.

## Fuera de alcance (v1)

- Auto-agendamiento público de pacientes (agendamiento es solo interno).
- Telehealth/video.
- Pacientes pediátricos (requieren un enfoque de percentiles OMS/ICBF distinto — ver `plan.md` §5 y §10).

Detalle completo: `plan.md` §1.
