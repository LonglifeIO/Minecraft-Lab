"use client";

import Link from "next/link";
import { useLikedAddons } from "@/lib/use-liked-addons";

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export default function LikedAddonsPage() {
  const { likedAddons, isLiked, toggle, count } = useLikedAddons();

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-5xl mx-auto pb-20">
      <div className="mc-dark-panel flex items-center justify-between px-4 py-2 mb-4">
        <div className="flex items-center gap-3">
          <Link href="/addons"><button className="mc-btn text-xs px-2 py-0">&lt;</button></Link>
          <span className="mc-title text-sm">Saved Add-ons</span>
        </div>
        <span className="mc-gray text-xs">{count} saved</span>
      </div>

      {likedAddons.length === 0 ? (
        <div className="mc-dark-panel p-8 text-center">
          <p className="mc-gray text-xs">No saved add-ons yet. Browse the library to find some.</p>
        </div>
      ) : (
        <div className="mc-inventory-grid mb-4">
          {likedAddons.map((addon) => (
            <Link key={addon.id} href={`/addons/${addon.id}`} className="h-full">
              <div className="mc-addon-card">
                <div className="mc-addon-banner relative">
                  <button
                    type="button"
                    aria-label={isLiked(addon.id) ? `Remove ${addon.name} from saved add-ons` : `Save ${addon.name}`}
                    className="absolute right-2 top-2 z-10 rounded-full bg-black/65 px-2 py-1 text-sm leading-none text-white"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggle(addon);
                    }}
                  >
                    <span className={isLiked(addon.id) ? "text-red-500" : "text-white/80"}>{isLiked(addon.id) ? "❤" : "♡"}</span>
                  </button>
                  {addon.thumbUrl ? (
                    <img src={addon.thumbUrl} alt="" className="transition-transform duration-500 hover:scale-105" />
                  ) : (
                    <div className="mc-addon-banner-placeholder">
                      {addon.name.charAt(0)}
                    </div>
                  )}
                </div>
                <div className="mc-addon-card-body">
                  <div className="mc-white text-sm font-bold truncate mb-1">{addon.name}</div>
                  <div className="mc-dark-gray text-[10px] mb-3">
                    by <span className="mc-white">{addon.authors.map((a) => a.name).join(", ") || "Unknown"}</span>
                  </div>
                  <div className="mc-gray flex-1 text-[11px] line-clamp-2 leading-relaxed font-sans mb-4">
                    {addon.summary}
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t border-white/5 mt-auto">
                    <div className="flex items-center gap-1.5">
                      <span className="mc-aqua text-[10px] font-bold">{formatCount(addon.downloadCount)}</span>
                      <span className="mc-dark-gray text-[9px] uppercase tracking-wider">Downloads</span>
                    </div>
                    <span className="mc-dark-gray text-[10px]">{timeAgo(addon.dateModified)}</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
