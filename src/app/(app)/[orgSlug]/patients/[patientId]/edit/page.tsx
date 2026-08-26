import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditPatientForm } from "./edit-patient-form";
import { ArchiveToggleButton } from "./archive-toggle-button";

/**
 * T4.5, per design.md's routing table: server-rendered shell, Client
 * Component form, `updatePatientAction` on submit, plus the archive/
 * unarchive buttons. This GET itself isn't a "profile view" for REQ-022's
 * purposes (only `[patientId]/page.tsx`'s detail view is, per design.md's
 * requirement-coverage table) so it doesn't call `logAudit()`.
 */
export default async function EditPatientPage({
  params,
}: {
  params: Promise<{ orgSlug: string; patientId: string }>;
}) {
  const { orgSlug, patientId } = await params;
  const session = await auth();

  if (!session) {
    notFound();
  }

  const patient = await withTenant(
    { organizationId: session.organizationId, userId: session.user.id },
    (tx) => tx.patient.findUnique({ where: { id: patientId } })
  );

  if (!patient) {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Edit patient</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <EditPatientForm
            orgSlug={orgSlug}
            patientId={patient.id}
            defaultValues={{
              fullName: patient.fullName,
              phone: patient.phone,
              documentId: patient.documentId ?? "",
              birthDate: patient.birthDate ? patient.birthDate.toISOString().slice(0, 10) : "",
              sex: patient.sex ?? "",
              email: patient.email ?? "",
              address: patient.address ?? "",
            }}
          />
          <ArchiveToggleButton patientId={patient.id} archived={Boolean(patient.archivedAt)} />
        </CardContent>
      </Card>
    </div>
  );
}
