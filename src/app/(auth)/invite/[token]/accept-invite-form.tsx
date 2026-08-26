"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { acceptInviteSchema, type AcceptInviteInput } from "@/validation/team";
import { acceptInviteAction } from "@/server/actions/team";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AcceptInviteFormProps {
  token: string;
  email: string;
}

/**
 * Client Component: needs client-side field state and submit handling,
 * same pattern as src/app/(auth)/register/register-form.tsx. `email` is
 * server-resolved (page.tsx's `lookupInviteByToken` call) and rendered
 * read-only -- REQ-006 requires it displayed but not editable, so it is
 * never part of `acceptInviteSchema` and never sent back to the server as
 * form input; `token` is threaded through as a prop from the route param,
 * not read from any client-editable field either.
 */
export function AcceptInviteForm({ token, email }: AcceptInviteFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AcceptInviteInput>({
    resolver: zodResolver(acceptInviteSchema),
  });

  function onSubmit(data: AcceptInviteInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await acceptInviteAction(token, data);
      if (!result.success) {
        setServerError(result.error ?? "Could not accept this invite.");
        return;
      }
      router.push("/login");
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="invited-email">Email</Label>
        <Input id="invited-email" type="email" value={email} readOnly disabled />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" type="text" autoComplete="name" {...register("name")} />
        {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          {...register("password")}
        />
        {errors.password && (
          <p className="text-sm text-destructive">{errors.password.message}</p>
        )}
      </div>

      {serverError && <p className="text-sm text-destructive">{serverError}</p>}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Accepting invite..." : "Accept invite"}
      </Button>
    </form>
  );
}
