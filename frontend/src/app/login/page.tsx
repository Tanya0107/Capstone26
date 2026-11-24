/**
 * Login (Firebase Auth, email/password). Account provisioning is admin side
 * only (Q5, dev seed script backend/scripts/seed_users.py).
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import EmulatorCheck from "@/components/shared/EmulatorCheck";
import { strings } from "./strings";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.replace("/");
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      setError(code.includes("invalid") || code.includes("credential") || code.includes("password") || code.includes("user-not-found")
        ? strings.errorInvalid
        : strings.errorGeneric);
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-8">
      <h1 className="mb-6 font-display text-2xl font-bold text-brand">{strings.title}</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink-muted">{strings.emailLabel}</span>
          <input
            type="email"
            required
            dir="ltr"
            className="rounded-card border border-line bg-surface p-2.5"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="login-email"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink-muted">{strings.passwordLabel}</span>
          <input
            type="password"
            required
            dir="ltr"
            className="rounded-card border border-line bg-surface p-2.5"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="login-password"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm font-medium text-danger" data-testid="login-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-card bg-brand p-2.5 font-semibold text-brand-contrast transition-colors hover:bg-brand-strong disabled:opacity-50"
          data-testid="login-submit"
        >
          {submitting ? strings.submitting : strings.submit}
        </button>
      </form>
      <div className="mt-8">
        <EmulatorCheck />
      </div>
    </main>
  );
}
