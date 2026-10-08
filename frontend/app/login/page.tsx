"use client";

import { useQueryClient } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { authApi, queryKeys } from "@/lib/api";

function safeNext(next: string | null): string {
  // Only allow same-origin relative paths (no open redirects).
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const user = await authApi.login(username, password);
      qc.setQueryData(queryKeys.me, user);
      router.replace(safeNext(params.get("next")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="glass w-full max-w-[400px] rounded-[28px] p-8 animate-fade-in">
      <div className="mb-8 flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-[#5b8cff] to-[#2a5ee8] text-white shadow-[0_8px_20px_-8px_rgb(47_107_255/0.8)]">
          <FlaskConical className="size-6" strokeWidth={1.8} />
        </div>
        <div>
          <p className="text-[17px] font-semibold leading-tight tracking-[-0.015em]">Lab Server Control Center</p>
          <p className="text-[13px] text-muted">Sign in to continue</p>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <Field label="Username" htmlFor="username">
          <Input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="password" error={error}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            aria-invalid={!!error}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="mt-2 w-full" loading={pending}>
          Sign in
        </Button>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
