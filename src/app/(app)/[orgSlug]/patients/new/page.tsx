import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewPatientForm } from "./new-patient-form";

/** T4.3, per design.md's routing table: server-rendered shell, Client
 * Component form, `createPatientAction` on submit. No streaming benefit
 * (a form, not a data-heavy read). */
export default async function NewPatientPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await auth();

  if (!session) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-2xl p-4">
      <Card>
        <CardHeader>
          <CardTitle>New patient</CardTitle>
        </CardHeader>
        <CardContent>
          <NewPatientForm orgSlug={orgSlug} />
        </CardContent>
      </Card>
    </div>
  );
}
