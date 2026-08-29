"use client";

import { useRouter } from "next/navigation";
import { createAppointmentAction } from "@/server/actions/appointments";
import { AppointmentForm } from "@/components/appointments/appointment-form";

/** T4.7: wires the shared form to `createAppointmentAction`, closes REQ-001. */
export function NewAppointmentForm({
  orgSlug,
  patients,
  professionals,
  defaultValues,
}: {
  orgSlug: string;
  patients: { id: string; fullName: string }[];
  professionals: { id: string; displayName: string }[];
  defaultValues?: { date?: string; time?: string; professionalId?: string };
}) {
  const router = useRouter();

  return (
    <AppointmentForm
      submitLabel="Create appointment"
      patients={patients}
      professionals={professionals}
      defaultValues={defaultValues}
      action={createAppointmentAction}
      onSuccess={() => router.push(`/${orgSlug}/appointments`)}
    />
  );
}
