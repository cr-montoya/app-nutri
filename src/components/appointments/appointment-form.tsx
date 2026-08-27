"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  appointmentFieldsSchema,
  createAppointmentSchema,
  type AppointmentFieldsInput,
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
 * never rendering that field at all).
 *
 * `AppointmentForm` is a thin dispatcher on whether `patients` was passed,
 * delegating to `CreateAppointmentFormInner`/`EditAppointmentFormInner`
 * below -- two separate `useForm` calls, each typed exactly against the
 * schema it validates (`createAppointmentSchema`/`appointmentFieldsSchema`),
 * so `zodResolver`'s inferred `Resolver<...>` type always matches the
 * `useForm` generic it's passed to, with no cast anywhere. This replaces a
 * single shared `useForm` call that previously needed `resolver:
 * zodResolver(...) as unknown as Resolver<CreateAppointmentInput>` to paper
 * over the two schemas' different output shapes (`appointmentFieldsSchema`
 * has no `patientId` key at all).
 *
 * The professional/date/time/duration/reason/notes field markup is *not*
 * factored into a shared component that takes `register`/`errors` as
 * props: `react-hook-form`'s `UseFormRegister<T>`/`FieldErrors<T>` are
 * effectively invariant in `T` (their `RegisterOptions`'s `validate`/`deps`
 * fields reference the full form-values shape), so passing either mode's
 * `register` into a component typed against the other's -- or against a
 * generic `T extends AppointmentFieldsInput` -- doesn't type-check without
 * a cast. Both attempts were tried and both failed to compile cleanly, so
 * the markup is duplicated between the two `*Inner` components below
 * instead: each stays fully and independently type-checked, and the
 * duplication is small and unlikely to drift (both render the exact same
 * six fields from the same schema family).
 */
export interface AppointmentFormResult {
  success: boolean;
  error?: string;
}

export interface AppointmentFormProfessional {
  id: string;
  displayName: string;
}

interface BaseFormProps {
  professionals: AppointmentFormProfessional[];
  submitLabel: string;
  onSuccess: () => void;
  onCancel?: () => void;
}

interface CreateFormProps extends BaseFormProps {
  patients: { id: string; fullName: string }[];
  defaultValues?: Partial<CreateAppointmentInput>;
  action: (values: CreateAppointmentInput) => Promise<AppointmentFormResult>;
}

interface EditFormProps extends BaseFormProps {
  patients?: undefined;
  defaultValues?: Partial<AppointmentFieldsInput>;
  action: (values: AppointmentFieldsInput) => Promise<AppointmentFormResult>;
}

function FormActions({
  isPending,
  submitLabel,
  serverError,
  onCancel,
}: {
  isPending: boolean;
  submitLabel: string;
  serverError: string | null;
  onCancel?: () => void;
}) {
  return (
    <>
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
    </>
  );
}

function CreateAppointmentFormInner({
  professionals,
  patients,
  defaultValues,
  action,
  submitLabel,
  onSuccess,
  onCancel,
}: CreateFormProps) {
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateAppointmentInput>({
    resolver: zodResolver(createAppointmentSchema),
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

      <FormActions
        isPending={isPending}
        submitLabel={submitLabel}
        serverError={serverError}
        onCancel={onCancel}
      />
    </form>
  );
}

function EditAppointmentFormInner({
  professionals,
  defaultValues,
  action,
  submitLabel,
  onSuccess,
  onCancel,
}: EditFormProps) {
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AppointmentFieldsInput>({
    resolver: zodResolver(appointmentFieldsSchema),
    defaultValues: {
      professionalId: "",
      date: "",
      time: "",
      durationMinutes: "",
      reason: "",
      notes: "",
      ...defaultValues,
    },
  });

  function onSubmit(values: AppointmentFieldsInput) {
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

      <FormActions
        isPending={isPending}
        submitLabel={submitLabel}
        serverError={serverError}
        onCancel={onCancel}
      />
    </form>
  );
}

export type AppointmentFormProps = CreateFormProps | EditFormProps;

export function AppointmentForm(props: AppointmentFormProps) {
  if (props.patients) {
    return <CreateAppointmentFormInner {...props} />;
  }
  return <EditAppointmentFormInner {...props} />;
}
