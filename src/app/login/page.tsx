import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata = { title: { absolute: "Sign in · PAKZ Admin" }, robots: { index: false } };

async function Form({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { next } = await searchParams;
  return <LoginForm next={next ?? "/admin"} />;
}

export default function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--page)] px-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="mb-1 text-lg font-semibold">PAKZ Admin</h1>
        <p className="mb-5 text-sm text-[var(--ink-2)]">Owner and staff accounts only.</p>
        <Suspense fallback={<div className="h-40" />}>
          <Form searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
