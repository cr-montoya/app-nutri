"use client";

import { useRouter } from "next/navigation";
import { createPatientAction } from "@/server/actions/patients";
import { PatientForm } from "../patient-form";

/** T4.3: wires the shared form to `createPatientAction`, closes REQ-001. */
export function NewPatientForm({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();

  return (
    <PatientForm
      submitLabel="Create patient"
      action={createPatientAction}
      onSuccess={(result) => {
        if (result.patientId) {
          router.push(`/${orgSlug}/patients/${result.patientId}`);
        }
      }}
    />
  );
}
