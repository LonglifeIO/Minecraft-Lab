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
  const { likedAddons, isLiked, toggle, count, loaded } = useLikedAddons();

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-5xl mx-auto pb-20">
      <div className="mc-dark-panel flex flex-wrap items-center justify-between gap-2 px-4 py-2 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/addons" className="mc-btn mc-btn-sm mc-btn-icon" aria-label="Back to add-ons">&lt;</Link>
          <span className="mc-title text-sm">Saved Add-ons</span>
        </div>
        <span className="mc-gray text-xs">{count} saved</span>
      </div>

      {!loaded ? (
        <p className="mc-note py-8 text-center">Loading…</p>
      ) : likedAddons.length === 0 ? (
        <div className="mc-dark-panel p-8 text-center">
          <p className="mc-gray text-xs mb-3">No saved add-ons yet. Tap ♡ on any add-on to save it here.</p>
          <Link href="/addons" className="mc-btn mc-btn-amber mc-btn-sm">Browse add-ons</Link>
        </div>
      ) : (
        <div className="mc-inventory-grid mb-4">
          {likedAddons.map((addon) => (
            <Link key={addon.id} href={`/addons/${addon.id}`} className="h-full">
              <div className="mc-addon-card">
                <div className="mc-addon-banner relative">
                  <button
                    type="button"
                    aria-pressed={isLiked(addon.id)}
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
                  <div className="mc-dark-gray text-[11px] mb-3">
                    by <span className="mc-white">{addon.authors.map((a) => a.name).join(", ") || "Unknown"}</span>
                  </div>
                  <div className="mc-gray flex-1 text-[11px] line-clamp-2 leading-relaxed font-sans mb-4">
                    {addon.summary}
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t border-white/5 mt-auto">
                    <div className="flex items-center gap-1.5">
                      <span className="mc-aqua text-[11px] font-bold">{formatCount(addon.downloadCount)}</span>
                      <span className="mc-dark-gray text-[11px] uppercase tracking-wider">Downloads</span>
                    </div>
                    <span className="mc-dark-gray text-[11px]">{timeAgo(addon.dateModified)}</span>
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
