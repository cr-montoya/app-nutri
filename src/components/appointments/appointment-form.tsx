"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import type { UseFormRegisterReturn } from "react-hook-form";
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
 * The professional/date/time/duration/reason/notes field markup itself
 * *is* shared, via `AppointmentSharedFields` below -- it takes the
 * *results* of calling `register("fieldName")` as props, typed as plain
 * `UseFormRegisterReturn` (unlike `UseFormRegister<T>` itself, this return
 * value isn't parameterized by the form's full value shape, so it's safe
 * to share between the two schemas). Each `*Inner` component still calls
 * its own exactly-typed `register`/`formState` and passes the bound
 * results down: no cast anywhere, no duplicated field markup.
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

/** Narrowed stand-in for react-hook-form's `FieldError<T>` (also parameterized by `T`): only the `message` this component renders. */
type FieldErrorLike = { message?: string };

interface AppointmentSharedFieldsProps {
  professionals: AppointmentFormProfessional[];
  professionalField: UseFormRegisterReturn;
  professionalError?: FieldErrorLike;
  dateField: UseFormRegisterReturn;
  dateError?: FieldErrorLike;
  timeField: UseFormRegisterReturn;
  timeError?: FieldErrorLike;
  durationField: UseFormRegisterReturn;
  reasonField: UseFormRegisterReturn;
  reasonError?: FieldErrorLike;
  notesField: UseFormRegisterReturn;
  notesError?: FieldErrorLike;
}

/**
 * The professional/date/time/duration/reason/notes fields, identical
 * between create and edit. Takes bound `register("fieldName")` results
 * rather than `register` itself, so it never needs to know which schema is
 * validating the form it's rendered inside.
 */
function AppointmentSharedFields({
  professionals,
  professionalField,
  professionalError,
  dateField,
  dateError,
  timeField,
  timeError,
  durationField,
  reasonField,
  reasonError,
  notesField,
  notesError,
}: AppointmentSharedFieldsProps) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="appointment-professionalId">Professional</Label>
        <select
          id="appointment-professionalId"
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          {...professionalField}
        >
          <option value="">Select a professional</option>
          {professionals.map((professional) => (
            <option key={professional.id} value={professional.id}>
              {professional.displayName}
            </option>
          ))}
        </select>
        {professionalError && (
          <p className="text-sm text-destructive">{professionalError.message}</p>
        )}
      </div>

      <div className="flex gap-4">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="appointment-date">Date</Label>
          <Input id="appointment-date" type="date" required {...dateField} />
          {dateError && <p className="text-sm text-destructive">{dateError.message}</p>}
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="appointment-time">Time</Label>
          <Input id="appointment-time" type="time" required {...timeField} />
          {timeError && <p className="text-sm text-destructive">{timeError.message}</p>}
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
          {...durationField}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="appointment-reason">Reason</Label>
        <Input id="appointment-reason" {...reasonField} />
        {reasonError && <p className="text-sm text-destructive">{reasonError.message}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="appointment-notes">Notes</Label>
        <Input id="appointment-notes" {...notesField} />
        {notesError && <p className="text-sm text-destructive">{notesError.message}</p>}
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

      <AppointmentSharedFields
        professionals={professionals}
        professionalField={register("professionalId")}
        professionalError={errors.professionalId}
        dateField={register("date")}
        dateError={errors.date}
        timeField={register("time")}
        timeError={errors.time}
        durationField={register("durationMinutes")}
        reasonField={register("reason")}
        reasonError={errors.reason}
        notesField={register("notes")}
        notesError={errors.notes}
      />

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
      <AppointmentSharedFields
        professionals={professionals}
        professionalField={register("professionalId")}
        professionalError={errors.professionalId}
        dateField={register("date")}
        dateError={errors.date}
        timeField={register("time")}
        timeError={errors.time}
        durationField={register("durationMinutes")}
        reasonField={register("reason")}
        reasonError={errors.reason}
        notesField={register("notes")}
        notesError={errors.notes}
      />

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
