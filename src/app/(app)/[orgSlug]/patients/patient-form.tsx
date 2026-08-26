"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Shared create/edit form (T4.3, T4.5), used by ./new/new-patient-form.tsx
 * and ./[patientId]/edit/edit-patient-form.tsx. Deliberately not wired to
 * `zodResolver(patientSchema)`: `patientSchema` (src/validation/patients.ts)
 * uses `z.preprocess` on several fields (to turn a blank form field into
 * "not provided"), which makes its Zod *input* type `unknown` for those
 * fields -- exactly what `@hookform/resolvers/zod` needs to type a
 * `useForm` generic against breaks down for a plain HTML form where every
 * field value is always a string. The server action re-validates every
 * field with the real schema regardless (REQ-002 through REQ-011 are
 * enforced there, proven in tests/integration/create-patient.test.ts and
 * update-patient.test.ts); this form's own typing only needs to describe
 * what the browser actually submits.
 */
export interface PatientFormValues {
  fullName: string;
  phone: string;
  documentId: string;
  birthDate: string;
  sex: string;
  email: string;
  address: string;
}

export interface PatientActionResult {
  success: boolean;
  error?: string;
  patientId?: string;
}

export function PatientForm({
  defaultValues,
  action,
  submitLabel,
  onSuccess,
}: {
  defaultValues?: Partial<PatientFormValues>;
  action: (input: unknown) => Promise<PatientActionResult>;
  submitLabel: string;
  onSuccess: (result: PatientActionResult) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const { register, handleSubmit } = useForm<PatientFormValues>({
    defaultValues: {
      fullName: "",
      phone: "",
      documentId: "",
      birthDate: "",
      sex: "",
      email: "",
      address: "",
      ...defaultValues,
    },
  });

  function onSubmit(values: PatientFormValues) {
    setServerError(null);
    startTransition(async () => {
      const result = await action(values);
      if (!result.success) {
        setServerError(result.error ?? "Could not save the patient.");
        return;
      }
      onSuccess(result);
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="patient-fullName">Full name</Label>
        <Input id="patient-fullName" required {...register("fullName")} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="patient-phone">Phone</Label>
        <Input id="patient-phone" type="tel" required {...register("phone")} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="patient-documentId">Document ID</Label>
        <Input id="patient-documentId" {...register("documentId")} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="patient-birthDate">Birth date</Label>
        <Input id="patient-birthDate" type="date" {...register("birthDate")} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="patient-sex">Sex</Label>
        <select
          id="patient-sex"
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          {...register("sex")}
        >
          <option value="">Not specified</option>
          <option value="MALE">Male</option>
          <option value="FEMALE">Female</option>
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="patient-email">Email</Label>
        <Input id="patient-email" type="email" {...register("email")} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="patient-address">Address</Label>
        <Input id="patient-address" {...register("address")} />
      </div>

      {serverError && (
        <p className="text-sm text-destructive" data-testid="patient-form-error">
          {serverError}
        </p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
