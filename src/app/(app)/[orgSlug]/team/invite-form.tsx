"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { sendInviteSchema, type SendInviteInput } from "@/validation/team";
import { sendInviteAction } from "@/server/actions/team";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Client Component: needs client-side field state and submit handling, same
 * pattern as src/app/(auth)/register/register-form.tsx. There is no
 * email-sending infrastructure yet (requirements.md's "Out of scope"), so a
 * successful submit surfaces `inviteUrl` for the ADMIN to copy and share
 * manually.
 */
export function InviteForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SendInviteInput>({
    resolver: zodResolver(sendInviteSchema),
    defaultValues: { role: "NUTRITIONIST" },
  });

  function onSubmit(data: SendInviteInput) {
    setServerError(null);
    setInviteUrl(null);
    startTransition(async () => {
      const result = await sendInviteAction(data);
      if (!result.success) {
        setServerError(result.error ?? "Could not send the invite.");
        return;
      }
      setInviteUrl(result.inviteUrl ?? null);
      reset();
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-email">Email</Label>
        <Input id="invite-email" type="email" autoComplete="email" {...register("email")} />
        {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-role">Role</Label>
        <select
          id="invite-role"
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          {...register("role")}
        >
          <option value="ADMIN">Admin</option>
          <option value="NUTRITIONIST">Nutritionist</option>
          <option value="FRONT_DESK">Front desk</option>
        </select>
        {errors.role && <p className="text-sm text-destructive">{errors.role.message}</p>}
      </div>

      {serverError && <p className="text-sm text-destructive">{serverError}</p>}
      {inviteUrl && (
        <p className="text-sm text-muted-foreground" data-testid="invite-url">
          Invite link: <span className="font-mono break-all">{inviteUrl}</span>
        </p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Sending invite..." : "Send invite"}
      </Button>
    </form>
  );
}
