import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { lookupInviteByToken } from "@/server/actions/team";
import { GENERIC_INVALID_INVITE_ERROR } from "@/validation/team";
import { AcceptInviteForm } from "./accept-invite-form";

/**
 * T3.7. Public route (src/middleware.ts allowlists `/invite/*`), same
 * Server Component shell + Client Component form split as
 * src/app/(auth)/register/page.tsx (design.md's routing table). Resolves
 * the invite's email/role from the token server-side, via
 * `lookupInviteByToken` (T3.2's pre-authentication lookup, reused rather
 * than duplicated) *before* the form renders, so the invited email can be
 * shown read-only (REQ-006) without ever trusting client input for it.
 *
 * REQ-013: an invalid/expired/revoked/already-accepted token renders the
 * same generic error on the page itself -- not a 404, not a redirect --
 * and no form, so there is nothing to submit.
 */
export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await lookupInviteByToken(token);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{invite ? "Accept your invite" : "Invalid invite"}</CardTitle>
        </CardHeader>
        <CardContent>
          {invite ? (
            <AcceptInviteForm token={token} email={invite.email} />
          ) : (
            <p className="text-sm text-destructive">{GENERIC_INVALID_INVITE_ERROR}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
