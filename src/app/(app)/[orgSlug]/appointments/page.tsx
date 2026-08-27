import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { getBogotaDayRange } from "@/validation/appointments";
import { getAppointmentsForRangeAction } from "@/server/actions/appointments";
import { Calendar } from "@/components/appointments/calendar";

/**
 * T4.7, per design.md's routing table: a Server Component shell that
 * fetches the initial visible day's appointments and the org's
 * professional list (for the calendar's resource columns), then renders
 * the Client Component calendar (calendar.tsx) with that data as initial
 * props. Subsequent range navigation calls `getAppointmentsForRangeAction`
 * from the client directly (design.md), not through this page again.
 */
export default async function AppointmentsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await auth();

  // Defensive: middleware and the parent layout already gate this.
  if (!session) {
    notFound();
  }

  const professionals = await withTenant(
    { organizationId: session.organizationId, userId: session.user.id },
    (tx) =>
      tx.professional.findMany({
        include: { membership: { include: { user: { select: { name: true } } } } },
        orderBy: { id: "asc" },
      })
  );

  const { start, end } = getBogotaDayRange();
  const rangeResult = await getAppointmentsForRangeAction(start.toISOString(), end.toISOString());

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Appointments</h1>
        <Link href={`/${orgSlug}/appointments/new`}>
          <Button>New appointment</Button>
        </Link>
      </div>

      <Calendar
        orgSlug={orgSlug}
        professionals={professionals.map((professional) => ({
          id: professional.id,
          displayName: professional.membership.user.name,
        }))}
        initialAppointments={rangeResult.appointments ?? []}
        initialRangeStart={start.toISOString()}
        initialRangeEnd={end.toISOString()}
      />
    </div>
  );
}
