import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PatientList } from "./patient-list";
import { PatientListSkeleton } from "./patient-list-skeleton";

/**
 * T4.2, per design.md's routing table: a Server Component shell (search
 * box, "new patient" button, archived toggle) that renders immediately,
 * with the list itself as a separate async Server Component
 * (./patient-list.tsx) streamed in behind a `<Suspense>` boundary --
 * `nextjs-architect.md`'s named example for this project's first use of
 * streaming. `q`/`archived` are plain URL search params (REQ-015 through
 * REQ-017), read here and passed down, not client-side state -- keeps the
 * list linkable and back-button-friendly.
 */
export default async function PatientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  const { orgSlug } = await params;
  const { q, archived } = await searchParams;
  const session = await auth();

  // Defensive: middleware and the parent layout already gate this.
  if (!session) {
    notFound();
  }

  const includeArchived = archived === "true";
  const query = q?.trim() || undefined;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Patients</h1>
        <Link href={`/${orgSlug}/patients/new`}>
          <Button>New patient</Button>
        </Link>
      </div>

      <form action={`/${orgSlug}/patients`} method="GET" className="flex gap-2">
        <Input
          type="text"
          name="q"
          defaultValue={query ?? ""}
          placeholder="Search by name or document ID"
          aria-label="Search patients"
        />
        {includeArchived && <input type="hidden" name="archived" value="true" />}
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <div className="flex gap-4 text-sm">
        <Link
          href={{ pathname: `/${orgSlug}/patients`, query: query ? { q: query } : {} }}
          className={includeArchived ? "text-muted-foreground underline" : "font-medium"}
          data-testid="filter-active"
        >
          Active
        </Link>
        <Link
          href={{
            pathname: `/${orgSlug}/patients`,
            query: { ...(query ? { q: query } : {}), archived: "true" },
          }}
          className={includeArchived ? "font-medium" : "text-muted-foreground underline"}
          data-testid="filter-archived"
        >
          Show archived
        </Link>
      </div>

      <Suspense key={`${query ?? ""}-${includeArchived}`} fallback={<PatientListSkeleton />}>
        <PatientList
          organizationId={session.organizationId}
          userId={session.user.id}
          orgSlug={orgSlug}
          query={query}
          includeArchived={includeArchived}
        />
      </Suspense>
    </div>
  );
}
