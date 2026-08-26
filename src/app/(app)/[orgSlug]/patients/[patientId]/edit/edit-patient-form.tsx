"use client";

import { useRouter } from "next/navigation";
import { updatePatientAction } from "@/server/actions/patients";
import { PatientForm, type PatientFormValues } from "../../patient-form";

/** T4.5: wires the shared form to `updatePatientAction`, closes REQ-012. */
export function EditPatientForm({
  orgSlug,
  patientId,
  defaultValues,
}: {
  orgSlug: string;
  patientId: string;
  defaultValues: PatientFormValues;
}) {
  const router = useRouter();

  return (
    <PatientForm
      submitLabel="Save changes"
      defaultValues={defaultValues}
      action={(input) => updatePatientAction(patientId, input)}
      onSuccess={() => {
        // router.push to a dynamic id-based route always fetches a fresh
        // RSC payload; a following router.refresh() would just make the
        // detail page's Server Component (and its REQ-022 audit-log write)
        // run a second time for the same navigation.
        router.push(`/${orgSlug}/patients/${patientId}`);
      }}
    />
  );
}
