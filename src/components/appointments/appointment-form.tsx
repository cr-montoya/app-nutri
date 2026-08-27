"use client";

import { useState, useTransition } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  appointmentFieldsSchema,
  createAppointmentSchema,
  type CreateAppointmentInput,
} from "@/validation/appointments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Shared create/edit fields (T4.5, T4.7), per design.md's "the create
 * form's schema/fields are reused, not duplicated" -- used directly by
 * `new/page.tsx`'s create form (with a `patients` list, so the patient
 * select renders) and by `AppointmentDetailSheet`'s edit mode (no
 * `patients` prop, so REQ-011's "never change the patient" holds simply by
 * never rendering that field at all). The resolver switches between
 * `createAppointmentSchema` and `appointmentFieldsSchema` based on whether
 * `patients` was passed, so edit mode's client-side validation doesn't
 * demand a `patientId` the form never collects; both actions' own
 * server-side `safeParse` are the actual authority either way (Zod object
 * schemas silently ignore extra keys, so submitting a `patientId` value
 * that the shape being edited never renders and isn't in the update
 * schema is harmless in edit mode).
 */
export interface AppointmentFormResult {
  success: boolean;
  error?: string;
}

export interface AppointmentFormProfessional {
  id: string;
  displayName: string;
}

export function AppointmentForm({
  professionals,
  patients,
  defaultValues,
  action,
  submitLabel,
  onSuccess,
  onCancel,
}: {
  professionals: AppointmentFormProfessional[];
  patients?: { id: string; fullName: string }[];
  defaultValues?: Partial<CreateAppointmentInput>;
  action: (values: CreateAppointmentInput) => Promise<AppointmentFormResult>;
  submitLabel: string;
  onSuccess: () => void;
  onCancel?: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateAppointmentInput>({
    // `appointmentFieldsSchema` (edit mode) validates a strict subset of
    // `CreateAppointmentInput` -- it never sees or requires `patientId`,
    // which edit mode never renders. Both schemas ignore extra keys
    // (non-strict Zod objects), so this cast is safe: at runtime each
    // resolver only ever validates the fields it actually declares.
    resolver: zodResolver(
      patients ? createAppointmentSchema : appointmentFieldsSchema
    ) as unknown as Resolver<CreateAppointmentInput>,
    defaultValues: {
      patientId: "",
      professionalId: "",
      date: "",
      time: "",
      durationMinutes: "",
      reason: "",
      notes: "",
      ...defaultValues,
    },
  });

  function onSubmit(values: CreateAppointmentInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await action(values);
      if (!result.success) {
        setServerError(result.error ?? "Could not save the appointment.");
        return;
      }
      onSuccess();
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      {patients && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="appointment-patientId">Patient</Label>
          <select
            id="appointment-patientId"
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            {...register("patientId")}
          >
            <option value="">Select a patient</option>
            {patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {patient.fullName}
              </option>
            ))}
          </select>
          {errors.patientId && <p className="text-sm text-destructive">{errors.patientId.message}</p>}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="appointment-professionalId">Professional</Label>
        <select
          id="appointment-professionalId"
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          {...register("professionalId")}
        >
          <option value="">Select a professional</option>
          {professionals.map((professional) => (
            <option key={professional.id} value={professional.id}>
              {professional.displayName}
            </option>
          ))}
        </select>
        {errors.professionalId && (
          <p className="text-sm text-destructive">{errors.professionalId.message}</p>
        )}
      </div>

      <div className="flex gap-4">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="appointment-date">Date</Label>
          <Input id="appointment-date" type="date" required {...register("date")} />
          {errors.date && <p className="text-sm text-destructive">{errors.date.message}</p>}
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="appointment-time">Time</Label>
          <Input id="appointment-time" type="time" required {...register("time")} />
          {errors.time && <p className="text-sm text-destructive">{errors.time.message}</p>}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="appointment-durationMinutes">Duration (minutes)</Label>
        <Input
          id="appointment-durationMinutes"
          type="number"
          min={5}
          max={480}
          placeholder="30"
          {...register("durationMinutes")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="appointment-reason">Reason</Label>
        <Input id="appointment-reason" {...register("reason")} />
        {errors.reason && <p className="text-sm text-destructive">{errors.reason.message}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="appointment-notes">Notes</Label>
        <Input id="appointment-notes" {...register("notes")} />
        {errors.notes && <p className="text-sm text-destructive">{errors.notes.message}</p>}
      </div>

      {serverError && (
        <p className="text-sm text-destructive" data-testid="appointment-form-error">
          {serverError}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
