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
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="mc-window w-full max-w-sm">
        <div className="mc-window-inner">
          <div className="text-center mb-6">
            <h1 className="mc-title text-2xl">MinecraftLab</h1>
            <p className="mc-dark-gray text-xs mt-2">Server Administration</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="mc-gray text-xs block mb-1">Username</label>
              <input className="mc-input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </div>
            <div>
              <label className="mc-gray text-xs block mb-1">Password</label>
              <input className="mc-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </div>
            {error && <p className="mc-red text-xs">{error}</p>}
            <button type="submit" className="mc-btn mc-btn-green w-full py-2 mt-1" disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
