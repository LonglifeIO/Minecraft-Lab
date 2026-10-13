"use client";

import useSWR from "swr";
import { usePathname } from "next/navigation";

interface McxStatus {
  mismatch?: boolean;
  message?: string | null;
}

// Never throw: an SWR error state would permanently stop interval polling.
// Any failure (logged out, host-api down) just hides the banner this cycle.
const fetcher = async (url: string): Promise<McxStatus> => {
  try {
    const r = await fetch(url);
    if (!r.ok) return {};
    return await r.json();
  } catch {
    return {};
  }
};

export function BroadcasterBanner() {
  const pathname = usePathname();
  const { data } = useSWR<McxStatus>(
    pathname === "/login" ? null : "/api/broadcaster",
    fetcher,
    { refreshInterval: 60000 }
  );
  if (!data?.mismatch || !data.message) return null;
  return (
    <div
      className="mc-dark-panel p-4 mx-auto mt-4 max-w-4xl"
      role="status"
      style={{ borderLeft: "3px solid var(--mc-red)", background: "rgba(255,85,85,0.08)" }}
    >
      <p className="mc-red text-sm font-bold">Console joins unavailable</p>
      <p className="mc-note mt-1">{data.message}</p>
    </div>
  );
}
