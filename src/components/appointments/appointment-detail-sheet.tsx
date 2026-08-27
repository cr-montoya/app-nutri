"use client";

import { useEffect, useState } from "react";
import type { AppointmentStatus } from "@prisma/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { allowedNextStatuses } from "@/lib/appointments";
import { transitionAppointmentStatusAction } from "@/server/actions/appointments";
import type { AppointmentForCalendar } from "@/server/actions/appointments";
import { updateAppointmentAction } from "@/server/actions/appointments";
import { formatBogotaDateAndTime, type CreateAppointmentInput } from "@/validation/appointments";
import { statusMeta } from "./status-meta";
import { AppointmentForm } from "./appointment-form";
import type { AppointmentFormProfessional } from "./appointment-form";

/**
 * T4.5/T4.6, closes REQ-011, REQ-014 through REQ-017, REQ-024, REQ-026.
 * Opens on a calendar event click/tap and on keyboard activation
 * (calendar.tsx focuses each event chip and forwards Enter/Space here via
 * the same `onEventSelect` -> `setSelectedAppointmentId` path click uses).
 * Shows fields read-only by default; "Edit" reveals `AppointmentForm`
 * (T4.5, the non-drag reschedule/edit path, REQ-024) with no `patients`
 * prop, so the patient can never be changed (REQ-011). The same sheet
 * renders status-transition buttons computed from `allowedNextStatuses`
 * (T3.2's shared source of truth) so a button for a transition the server
 * would reject is never shown (Hick's Law, design.md).
 */
export function AppointmentDetailSheet({
  appointment,
  professionals,
  open,
  onOpenChange,
  onChanged,
}: {
  appointment: AppointmentForCalendar | null;
  professionals: AppointmentFormProfessional[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void | Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<AppointmentStatus | null>(null);

  useEffect(() => {
    if (!open) {
      setIsEditing(false);
      setStatusError(null);
      setPendingStatus(null);
    }
  }, [open]);

  if (!appointment) {
    return <Sheet open={open} onOpenChange={onOpenChange} />;
  }

  const meta = statusMeta(appointment.status);
  const StatusIcon = meta.Icon;
  const { date, time } = formatBogotaDateAndTime(new Date(appointment.startAt));
  const durationMinutes = Math.round(
    (new Date(appointment.endAt).getTime() - new Date(appointment.startAt).getTime()) / 60_000
  );
  const professional = professionals.find((p) => p.id === appointment.professionalId);
  const isEditable = appointment.status === "SCHEDULED" || appointment.status === "CONFIRMED";
  const nextStatuses = allowedNextStatuses(appointment.status);

  async function handleTransition(newStatus: AppointmentStatus) {
    if (!appointment) return;
    setStatusError(null);
    setPendingStatus(newStatus);
    const result = await transitionAppointmentStatusAction(appointment.id, appointment.status, newStatus);
    setPendingStatus(null);
    if (!result.success) {
      setStatusError(result.error ?? "Could not update the appointment's status.");
      return;
    }
    await onChanged();
  }

  async function handleEditSubmit(values: CreateAppointmentInput) {
    if (!appointment) return { success: false, error: "Appointment not found." };
    const result = await updateAppointmentAction(appointment.id, values);
    if (result.success) {
      setIsEditing(false);
      await onChanged();
    }
    return result;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{appointment.patientName}</SheetTitle>
          <SheetDescription>Appointment details</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4">
          <div
            data-testid="appointment-status-chip"
            className={`flex min-h-[44px] w-fit items-center gap-2 rounded-md px-3 text-sm ${meta.chipClassName}`}
          >
            <StatusIcon className="size-4" aria-hidden="true" />
            <span className={meta.strikethrough ? "line-through" : ""}>{meta.label}</span>
          </div>

          {isEditing ? (
            <AppointmentForm
              professionals={professionals}
              defaultValues={{
                professionalId: appointment.professionalId,
                date,
                time,
                durationMinutes: String(durationMinutes),
                reason: appointment.reason ?? "",
                notes: appointment.notes ?? "",
              }}
              action={handleEditSubmit}
              submitLabel="Save changes"
              onSuccess={() => setIsEditing(false)}
              onCancel={() => setIsEditing(false)}
            />
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                <span className="font-medium">Professional:</span> {professional?.displayName ?? "—"}
              </p>
              <p>
                <span className="font-medium">Date:</span> {date} <span className="font-medium">Time:</span> {time}
              </p>
              <p>
                <span className="font-medium">Duration:</span> {durationMinutes} min
              </p>
              {appointment.reason && (
                <p>
                  <span className="font-medium">Reason:</span> {appointment.reason}
                </p>
              )}
              {appointment.notes && (
                <p>
                  <span className="font-medium">Notes:</span> {appointment.notes}
                </p>
              )}

              {isEditable && (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2 min-h-11 w-fit"
                  onClick={() => setIsEditing(true)}
                >
                  Edit
                </Button>
              )}
            </div>
          )}

          {nextStatuses.length > 0 && !isEditing && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Change status</p>
              <div className="flex flex-wrap gap-2">
                {nextStatuses.map((status) => {
                  const targetMeta = statusMeta(status);
                  const TargetIcon = targetMeta.Icon;
                  return (
                    <Button
                      key={status}
                      type="button"
                      variant="outline"
                      className="min-h-11 gap-1.5"
                      disabled={pendingStatus !== null}
                      onClick={() => handleTransition(status)}
                    >
                      <TargetIcon className="size-4" aria-hidden="true" />
                      {targetMeta.label}
                    </Button>
                  );
                })}
              </div>
              {statusError && <p className="text-sm text-destructive">{statusError}</p>}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
