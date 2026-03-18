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
    const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    if (res.ok) { router.push("/"); router.refresh(); }
    else { const data = await res.json(); setError(data.error || "Login failed"); }
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-green-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-amber-500/10 rounded-full blur-[100px] pointer-events-none" />
      
      <div className="mc-window w-full max-w-sm relative z-10 border-t-4 border-amber-500 shadow-[0_30px_60px_rgba(0,0,0,0.6)]">
        <div className="mc-window-inner bg-[#111] p-8">
          <div className="text-center mb-10">
            <h1 className="mc-title text-4xl tracking-tighter" style={{ textShadow: "4px 4px 0 rgba(0,0,0,0.5), 0 0 20px rgba(255,155,46,0.3)" }}>MinecraftLab</h1>
            <div className="flex items-center justify-center gap-2 mt-3">
              <div className="h-[1px] w-8 bg-white/10" />
              <p className="mc-dark-gray text-[10px] uppercase tracking-[0.2em] font-bold">CORE AUTHENTICATION</p>
              <div className="h-[1px] w-8 bg-white/10" />
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div className="space-y-1.5">
              <label className="mc-dark-gray text-[10px] uppercase font-bold tracking-wider ml-1 block">IDENTIFIER</label>
              <input className="mc-input py-3 text-sm tracking-wide" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required placeholder="Username" />
            </div>
            <div className="space-y-1.5">
              <label className="mc-dark-gray text-[10px] uppercase font-bold tracking-wider ml-1 block">SECRET KEY</label>
              <input className="mc-input py-3 text-sm tracking-wide" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required placeholder="••••••••" />
            </div>
            {error && (
              <div className="bg-red-950/40 border border-red-500/30 p-2 text-center">
                <p className="mc-red text-[10px] uppercase font-bold tracking-widest">{error}</p>
              </div>
            )}
            <button type="submit" className="mc-btn mc-btn-green w-full py-3 mt-4 text-xs font-bold uppercase tracking-[0.25em] shadow-lg" disabled={loading}>
              {loading ? "ESTABLISHING..." : "SIGN IN"}
            </button>
          </form>

          <p className="mc-dark-gray text-[9px] text-center mt-10 uppercase tracking-widest opacity-50">
            Secure Terminal &middot; Authorized Access Only
          </p>
        </div>
      </div>
    </div>
  );
}
