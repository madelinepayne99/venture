import { signIn } from "@/auth";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-hq-cream px-4">
      <div className="w-full max-w-sm rounded-2xl border border-hq-brass/20 bg-white/70 p-8 text-center shadow-desk">
        <h1 className="font-display text-2xl font-semibold text-hq-tealDark">Venture HQ</h1>
        <p className="mt-2 text-sm text-hq-slate">
          The founders&apos; desk is private to Ellis and Maddie.
        </p>
        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signIn("github");
          }}
        >
          <button
            type="submit"
            className="w-full rounded-md bg-hq-brass px-4 py-2 text-sm font-semibold text-white transition hover:bg-hq-brassDark"
          >
            Sign in with GitHub
          </button>
        </form>
      </div>
    </main>
  );
}
