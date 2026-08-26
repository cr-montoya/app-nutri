import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * T4.4, closes REQ-018, REQ-022. Direct single-row fetch, no streaming
 * benefit (design.md's routing table). `findUnique({ where: { id } })`
 * doesn't add `organizationId` manually: the tenant-context extension
 * (src/lib/db.ts) injects it, so a `patientId` from a different
 * organization simply finds nothing here -- the same 404 a nonexistent id
 * gets, per REQ-019's "never a hint it belongs to someone else." The
 * REQ-022 audit-log write only happens once a patient is actually found
 * (never logged for a 404), inside the same `withTenant` transaction as
 * the read.
 */
export default async function PatientDetailPage({
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
    async (tx) => {
      const found = await tx.patient.findUnique({ where: { id: patientId } });
      if (!found) {
        return null;
      }

      await logAudit(tx, {
        action: "patient.view",
        entityType: "Patient",
        entityId: found.id,
        userId: session.user.id,
        organizationId: session.organizationId,
      });

      return found;
    }
  );

  if (!patient) {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="patient-full-name">
            {patient.fullName}
          </h1>
          {patient.archivedAt && (
            <p className="text-sm text-muted-foreground" data-testid="archived-badge">
              Archived
            </p>
          )}
        </div>
        <Link href={`/${orgSlug}/patients/${patient.id}/edit`}>
          <Button variant="outline">Edit</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">Phone: </span>
            <span data-testid="patient-phone">{patient.phone}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Document ID: </span>
            <span data-testid="patient-documentId">{patient.documentId ?? "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Birth date: </span>
            {patient.birthDate ? patient.birthDate.toISOString().slice(0, 10) : "—"}
          </div>
          <div>
            <span className="text-muted-foreground">Sex: </span>
            {patient.sex ?? "—"}
          </div>
          <div>
            <span className="text-muted-foreground">Email: </span>
            {patient.email ?? "—"}
          </div>
          <div>
            <span className="text-muted-foreground">Address: </span>
            {patient.address ?? "—"}
          </div>
        </CardContent>
      </Card>

      <Link href={`/${orgSlug}/patients`} className="text-sm text-muted-foreground hover:underline">
        ← Back to patients
      </Link>
    </div>
  );
}
