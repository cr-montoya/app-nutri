"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  updateProfessionalProfileSchema,
  type UpdateProfessionalProfileInput,
} from "@/validation/team";
import { updateProfessionalProfileAction } from "@/server/actions/team";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ProfessionalProfileFormProps {
  licenseNumber: string;
  specialty: string;
}

/**
 * Client Component: needs client-side field state and submit handling, same
 * pattern as src/app/(app)/[orgSlug]/team/invite-form.tsx. `licenseNumber`/
 * `specialty` are server-resolved defaults (page.tsx's own-membership
 * lookup) -- there is no id field anywhere in this form or in
 * `updateProfessionalProfileSchema` (T4.1), so there is nothing here that
 * could target any profile but the caller's own (REQ-019).
 */
export function ProfessionalProfileForm({
  licenseNumber,
  specialty,
}: ProfessionalProfileFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UpdateProfessionalProfileInput>({
    resolver: zodResolver(updateProfessionalProfileSchema),
    defaultValues: { licenseNumber, specialty },
  });

  function onSubmit(data: UpdateProfessionalProfileInput) {
    setServerError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateProfessionalProfileAction(data);
      if (!result.success) {
        setServerError(result.error ?? "Could not save your professional profile.");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="licenseNumber">License number</Label>
        <Input id="licenseNumber" type="text" {...register("licenseNumber")} />
        {errors.licenseNumber && (
          <p className="text-sm text-destructive">{errors.licenseNumber.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="specialty">Specialty</Label>
        <Input id="specialty" type="text" {...register("specialty")} />
        {errors.specialty && (
          <p className="text-sm text-destructive">{errors.specialty.message}</p>
        )}
      </div>

      {serverError && <p className="text-sm text-destructive">{serverError}</p>}
      {saved && (
        <p className="text-sm text-muted-foreground" data-testid="profile-saved">
          Saved.
        </p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving..." : "Save profile"}
      </Button>
    </form>
  );
}
