"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revokeInviteAction } from "@/server/actions/team";
import { Button } from "@/components/ui/button";

/**
 * REQ-014: one revoke button per pending invite row in team/page.tsx.
 * Client Component only for the click handler and pending/error state; the
 * actual authorization check runs server-side inside revokeInviteAction.
 */
export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onRevoke() {
    setError(null);
    startTransition(async () => {
      const result = await revokeInviteAction(inviteId);
      if (!result.success) {
        setError(result.error ?? "Could not revoke the invite.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={isPending}
        onClick={onRevoke}
      >
        {isPending ? "Revoking..." : "Revoke"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
