/**
 * T4.2's `<Suspense>` fallback, shown while the shell has already painted
 * (search box, "new patient" button) but `PatientList`'s query hasn't
 * resolved yet.
 */
export function PatientListSkeleton() {
  return (
    <div className="flex flex-col gap-2" data-testid="patient-list-skeleton" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-9 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}
