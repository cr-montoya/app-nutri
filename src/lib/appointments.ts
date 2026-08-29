import type { AppointmentStatus } from "@prisma/client";

/**
 * T3.2: the allowed-transitions table (REQ-014 through REQ-017) as a
 * shared, importable pure function, per design.md's "Calendar UX" section
 * -- this is the single source of truth for which status transitions are
 * legal. `transitionAppointmentStatusAction` (src/server/actions/appointments.ts)
 * imports it to enforce the rule server-side; `AppointmentDetailSheet`
 * (T4.6) imports the same function to render only the buttons a
 * transition would actually accept, so the UI hint and the enforcement
 * can never drift apart.
 */
export function allowedNextStatuses(current: AppointmentStatus): AppointmentStatus[] {
  // A switch, not a Record lookup keyed by `current`: ESLint's
  // security/detect-object-injection flags dynamic property access even
  // when, as here, `current` is a closed enum rather than user input.
  switch (current) {
    case "SCHEDULED":
      return ["CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"];
    case "CONFIRMED":
      return ["COMPLETED", "CANCELLED", "NO_SHOW"];
    case "COMPLETED":
    case "CANCELLED":
    case "NO_SHOW":
      return [];
  }
}
