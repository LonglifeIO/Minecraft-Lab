"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { useLikedAddons, type LikedAddon } from "@/lib/use-liked-addons";

const fetcher = (url: string) => fetch(url).then((r) => { if (r.status === 401) throw new Error("unauthorized"); return r.json(); });

interface SearchResult {
  id: number;
  name: string;
  slug: string;
  summary: string;
  downloadCount: number;
  thumbUrl: string;
  authors: { name: string }[];
  dateModified: string;
}

interface SearchResponse {
  results: SearchResult[];
  pagination: { index: number; pageSize: number; totalCount: number };
}

const SORT_OPTIONS = [
  { label: "Popular", value: "2" },
  { label: "Updated", value: "3" },
  { label: "Name", value: "4" },
  { label: "Downloads", value: "6" },
];

// classId options map to top-level Bedrock classes (gameId=78022)
const CLASS_OPTIONS = [
  { label: "Addons", value: "" },           // classId=4984 (default)
  { label: "Maps", value: "6913" },
  { label: "Texture Packs", value: "6929" },
  { label: "Scripts", value: "6940" },
  { label: "Skins", value: "6925" },
];

// Subcategories for Addons class (4984)
const ADDON_CATEGORY_OPTIONS = [
  { label: "All", value: "" },
  { label: "Weapons", value: "8834" },
  { label: "Survival", value: "8831" },
  { label: "Vanilla+", value: "8830" },
  { label: "Magic", value: "8829" },
  { label: "Fantasy", value: "8828" },
  { label: "Roleplay", value: "8827" },
  { label: "Technology", value: "8826" },
  { label: "Horror", value: "8833" },
  { label: "Maps", value: "4986" },
  { label: "Multiplayer", value: "8835" },
  { label: "Cosmetics", value: "8825" },
  { label: "Food", value: "8836" },
  { label: "Utility", value: "8832" },
  { label: "Performance", value: "8837" },
];

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

export default function AddonsPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sortField, setSortField] = useState("2");
  const [classId, setClassId] = useState<string>("");      // top-level class (Maps, Skins, etc.)
  const [categoryId, setCategoryId] = useState<string>(""); // subcategory within Addons
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const { isLiked, toggle, count } = useLikedAddons();

  const params = new URLSearchParams({ pageSize: String(pageSize), index: String(page * pageSize), sortField });
  if (query) params.set("q", query);
  // classId overrides the default (4984 Addons) when user picks Maps/Skins/etc.
  if (classId) params.set("classId", classId);
  // categoryId is a subcategory filter (only meaningful within Addons class)
  if (categoryId && !classId) params.set("categoryId", categoryId);

  const { data, error, isLoading } = useSWR<SearchResponse>(
    `/api/addons/search?${params.toString()}`,
    fetcher,
    { onError: (err) => { if (err.message === "unauthorized") router.push("/login"); } }
  );

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setQuery(searchInput);
    setPage(0);
  }

  function toLikedAddon(addon: SearchResult): LikedAddon {
    return {
      id: addon.id,
      name: addon.name,
      thumbUrl: addon.thumbUrl,
      authors: addon.authors,
      downloadCount: addon.downloadCount,
      dateModified: addon.dateModified,
      summary: addon.summary,
    };
  }

  const totalPages = data ? Math.ceil(data.pagination.totalCount / pageSize) : 0;

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-5xl mx-auto pb-20">
      {/* Title bar */}
      <div className="mc-dark-panel flex items-center justify-between px-4 py-2 mb-4">
        <div className="flex items-center gap-3">
          <Link href="/"><button className="mc-btn text-xs px-2 py-0">&lt;</button></Link>
          <span className="mc-title text-sm">Add-on Library</span>
        </div>
        <Link href="/addons/liked" className="mc-btn text-xs px-3 py-1">
          ♥ Saved ({count})
        </Link>
      </div>

      {/* Search + Filters */}
      <div className="mc-dark-panel p-3 mb-4">
        <form onSubmit={handleSearch} className="flex gap-2 mb-3">
          <input
            className="mc-input flex-1"
            placeholder="Search add-ons..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" className="mc-btn text-xs px-4">Search</button>
        </form>
        {/* Sort + Class on one row */}
        <div className="flex gap-2 items-center flex-wrap mb-2">
          <span className="mc-gray text-xs">Sort:</span>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`mc-btn text-xs px-2 py-0 ${sortField === opt.value ? "mc-btn-active" : ""}`}
              onClick={() => { setSortField(opt.value); setPage(0); }}
            >
              {opt.label}
            </button>
          ))}
          <span className="mc-dark-gray text-xs mx-1">|</span>
          {CLASS_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              className={`mc-btn text-xs px-2 py-0 ${classId === opt.value ? "mc-btn-active" : ""}`}
              onClick={() => { setClassId(opt.value); setCategoryId(""); setPage(0); }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {/* Category: dropdown, only shown for Addons class */}
        {!classId && (
          <div className="flex gap-2 items-center mt-2">
            <span className="mc-gray text-xs flex-shrink-0">Category:</span>
            <select
              className="mc-input text-xs flex-1 max-w-[220px]"
              value={categoryId}
              onChange={(e) => { setCategoryId(e.target.value); setPage(0); }}
            >
              {ADDON_CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.label} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Results — vertical cards with skeleton loading */}
      <div className="mc-inventory-grid mb-4">
        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="mc-addon-card opacity-50">
              <div className="mc-addon-banner mc-skeleton" />
              <div className="mc-addon-card-body space-y-3">
                <div className="h-4 w-3/4 mc-skeleton" />
                <div className="h-3 w-1/4 mc-skeleton" />
                <div className="space-y-2">
                  <div className="h-2 w-full mc-skeleton" />
                  <div className="h-2 w-full mc-skeleton" />
                </div>
                <div className="flex justify-between pt-2">
                  <div className="h-3 w-1/4 mc-skeleton" />
                  <div className="h-3 w-1/4 mc-skeleton" />
                </div>
              </div>
            </div>
          ))
        ) : error ? (
          <div className="col-span-full p-8 text-center">
            <p className="mc-red text-xs">Failed to load add-ons</p>
          </div>
        ) : data && (data.results?.length ?? 0) === 0 ? (
          <div className="col-span-full p-8 text-center">
            <p className="mc-gray text-xs">No add-ons found. Try a different search.</p>
          </div>
        ) : (
          data?.results?.map((addon) => (
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
                      toggle(toLikedAddon(addon));
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
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button className="mc-btn text-xs px-3" disabled={page === 0} onClick={() => setPage(page - 1)}>
            &lt; Prev
          </button>
          <span className="mc-gray text-xs flex items-center">
            Page {page + 1} of {totalPages}
          </span>
          <button className="mc-btn text-xs px-3" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
            Next &gt;
          </button>
        </div>
      )}
    </div>
  );
}
