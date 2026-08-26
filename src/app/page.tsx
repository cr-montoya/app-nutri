import { auth } from "@/lib/auth";
import { logoutAction } from "@/server/actions/session";
import { Button } from "@/components/ui/button";

/**
 * Server Component: checks the session (auth()'s own cheap JWT decode, see
 * design.md's "Tenant-context propagation") so a logged-in visitor sees a
 * "Log out" action instead of "Log in" -- this is currently the only place
 * `logoutAction` (REQ-015, T5.2) has a UI to wire into, since the org
 * workspace dashboard doesn't exist until T6.
 */
export default async function Home() {
  const session = await auth();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">AppNutri</h1>
      {session ? (
        <form action={logoutAction}>
          <Button type="submit">Log out</Button>
        </form>
      ) : (
        <Button asChild>
          <a href="/login">Log in</a>
        </Button>
      )}
    </div>
  );
}
