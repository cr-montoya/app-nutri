import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">AppNutri</h1>
      <Button asChild>
        <a href="/login">Log in</a>
      </Button>
    </div>
  );
}
