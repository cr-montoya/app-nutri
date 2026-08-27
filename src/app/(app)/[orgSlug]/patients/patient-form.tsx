"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { patientSchema, type PatientInput } from "@/validation/patients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Shared create/edit form (T4.3, T4.5), used by ./new/new-patient-form.tsx
 * and ./[patientId]/edit/edit-patient-form.tsx. Wired to
 * `zodResolver(patientSchema)` for real inline per-field errors, same
 * pattern as `professional-profile-form.tsx`'s
 * `zodResolver(updateProfessionalProfileSchema)` -- `patientSchema`
 * (src/validation/patients.ts) accepts an empty string as "not provided"
 * via `z.union([..., z.literal("")])` rather than `z.preprocess`
 * specifically so its Zod input type stays a plain string per field,
 * compatible with `useForm`'s generic (code-quality finding: an earlier
 * version of this file skipped `zodResolver` entirely because
 * `z.preprocess` broke that typing; see design.md's `## Deviations`).
 *
 * REQ-008's future-birthDate rejection isn't a `zodResolver`-visible
 * inline error: `patientSchema.birthDate` is deliberately just a plain
 * string (validated by `parseBirthDate` server-side, see
 * src/validation/patients.ts's doc comment), so an invalid birth date
 * surfaces through the generic `serverError` message below instead.
 */
export type PatientFormValues = PatientInput;

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

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PatientFormValues>({
    resolver: zodResolver(patientSchema),
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
        {errors.fullName && <p className="text-sm text-destructive">{errors.fullName.message}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="patient-phone">Phone</Label>
        <Input id="patient-phone" type="tel" required {...register("phone")} />
        {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="patient-documentId">Document ID</Label>
        <Input id="patient-documentId" {...register("documentId")} />
        {errors.documentId && (
          <p className="text-sm text-destructive">{errors.documentId.message}</p>
        )}
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
        {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="patient-address">Address</Label>
        <Input id="patient-address" {...register("address")} />
        {errors.address && <p className="text-sm text-destructive">{errors.address.message}</p>}
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
