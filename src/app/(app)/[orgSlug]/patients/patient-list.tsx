import Link from "next/link";
import { listPatients } from "@/server/services/patients";

/**
 * T4.2: the async Server Component wrapped in the list page's `<Suspense>`
 * boundary -- its data fetch (`listPatients`) is what streams in behind
 * the shell, per design.md's routing table.
 */
export async function PatientList({
  organizationId,
  userId,
  orgSlug,
  query,
  includeArchived,
}: {
  organizationId: string;
  userId: string;
  orgSlug: string;
  query?: string;
  includeArchived: boolean;
}) {
  const patients = await listPatients({ organizationId, userId, query, includeArchived });

  if (patients.length === 0) {
    return <p className="text-sm text-muted-foreground">No patients found.</p>;
  }

  return (
    <ul className="flex flex-col gap-2" data-testid="patient-list">
      {patients.map((patient) => (
        <li
          key={patient.id}
          className="flex items-center justify-between border-b pb-2 last:border-0"
          data-testid="patient-list-row"
        >
          {/* prefetch={false}: the detail page (REQ-022) records an
              AuditLog "patient.view" entry on every render. Next.js's
              default Link prefetching would execute that Server Component
              -- and log a phantom view nobody actually made -- the moment
              this row scrolls into the viewport, not on an actual click. */}
          <Link
            href={`/${orgSlug}/patients/${patient.id}`}
            prefetch={false}
            className="font-medium hover:underline"
          >
            {patient.fullName}
          </Link>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {patient.documentId && <span>{patient.documentId}</span>}
            {patient.archivedAt && (
              <span
                className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground"
                data-testid="archived-badge"
              >
                Archived
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
