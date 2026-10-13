"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      if (res.ok) { router.push("/"); router.refresh(); return; }
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Login failed");
    } catch {
      setError("Couldn't reach the dashboard server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-green-500/10 rounded-full blur-[100px] pointer-events-none" aria-hidden="true" />
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-amber-500/10 rounded-full blur-[100px] pointer-events-none" aria-hidden="true" />

      <main className="mc-window w-full max-w-sm relative z-10 border-t-4 border-amber-500 shadow-[0_30px_60px_rgba(0,0,0,0.6)]">
        <div className="mc-window-inner bg-[#111] p-8">
          <div className="text-center mb-8">
            <h1 className="mc-title text-4xl tracking-tighter" style={{ textShadow: "4px 4px 0 rgba(0,0,0,0.5), 0 0 20px rgba(255,155,46,0.3)" }}>MinecraftLab</h1>
            <div className="flex items-center justify-center gap-2 mt-3">
              <div className="h-[1px] w-8 bg-white/10" aria-hidden="true" />
              <p className="mc-note uppercase tracking-[0.2em] font-bold">Family server dashboard</p>
              <div className="h-[1px] w-8 bg-white/10" aria-hidden="true" />
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="space-y-1.5">
              <label htmlFor="login-username" className="mc-note uppercase font-bold tracking-wider ml-1 block">Username</label>
              <input id="login-username" className="mc-input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required placeholder="Username" autoFocus />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="login-password" className="mc-note uppercase font-bold tracking-wider ml-1 block">Password</label>
              <input id="login-password" className="mc-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required placeholder="••••••••" />
            </div>
            {error && (
              <div className="bg-red-950/40 border border-red-500/30 p-2 text-center" role="alert">
                <p className="mc-red text-[12px] font-bold tracking-wide">{error}</p>
              </div>
            )}
            <button type="submit" className="mc-btn mc-btn-green w-full mt-2 font-bold uppercase tracking-[0.2em] shadow-lg" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mc-note text-center mt-8">
            Ask whoever runs the server for a login.
          </p>
        </div>
      </main>
    </div>
  );
}
