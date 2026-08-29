import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listSchedulingOptions } from "@/server/services/appointments";
import { NewAppointmentForm } from "./new-appointment-form";

/**
 * T4.7, per design.md's routing table: server-rendered shell, Client
 * Component form, `createAppointmentAction` on submit. Reads
 * `?date=&time=&professionalId=` to pre-fill the form when navigated from
 * an empty calendar slot click (design.md's "Pre-filled create from an
 * empty slot click").
 */
export default async function NewAppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ date?: string; time?: string; professionalId?: string }>;
}) {
  const { orgSlug } = await params;
  const { date, time, professionalId } = await searchParams;
  const session = await auth();

  if (!session) {
    notFound();
  }

  const options = await listSchedulingOptions({
    organizationId: session.organizationId,
    userId: session.user.id,
  });

  return (
    <div className="mx-auto max-w-2xl p-4">
      <Card>
        <CardHeader>
          <CardTitle>New appointment</CardTitle>
        </CardHeader>
        <CardContent>
          <NewAppointmentForm
            orgSlug={orgSlug}
            patients={options.patients}
            professionals={options.professionals}
            defaultValues={{ date, time, professionalId }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
