"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archivePatientAction, unarchivePatientAction } from "@/server/actions/patients";
import { Button } from "@/components/ui/button";

/** T4.5: archive/unarchive buttons, closes REQ-013, REQ-014. The action
 * itself calls `revalidatePath` on the list and detail paths; this only
 * needs a local `router.refresh()` so the edit page's own "archived" state
 * (and this button's label) reflects the change immediately. */
export function ArchiveToggleButton({
  patientId,
  archived,
}: {
  patientId: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const action = archived ? unarchivePatientAction : archivePatientAction;
      const result = await action(patientId);
      if (!result.success) {
        setError(result.error ?? "Could not update the patient.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1 border-t pt-4">
      <Button
        type="button"
        variant={archived ? "outline" : "destructive"}
        disabled={isPending}
        onClick={onClick}
      >
        {isPending ? "Saving..." : archived ? "Unarchive patient" : "Archive patient"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
