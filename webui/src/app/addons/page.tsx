"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";

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
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const params = new URLSearchParams({ pageSize: String(pageSize), index: String(page * pageSize), sortField });
  if (query) params.set("q", query);

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

  const totalPages = data ? Math.ceil(data.pagination.totalCount / pageSize) : 0;

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-5xl mx-auto pb-20">
      {/* Title bar */}
      <div className="mc-dark-panel flex items-center justify-between px-4 py-2 mb-4">
        <div className="flex items-center gap-3">
          <Link href="/"><button className="mc-btn text-xs px-2 py-0">&lt;</button></Link>
          <span className="mc-title text-sm">Add-on Library</span>
        </div>
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
        <div className="flex gap-2 items-center">
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
        </div>
      </div>

      {/* Results */}
      {isLoading && <p className="mc-gray text-xs py-8 text-center">Searching CurseForge...</p>}
      {error && !isLoading && <p className="mc-red text-xs py-8 text-center">Failed to load add-ons</p>}

      {data && data.results.length === 0 && (
        <div className="mc-dark-panel p-6 text-center">
          <p className="mc-gray text-xs">No add-ons found. Try a different search.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        {data?.results.map((addon) => (
          <Link key={addon.id} href={`/addons/${addon.id}`}>
            <div className="mc-dark-panel p-3 mc-lift h-full cursor-pointer">
              <div className="flex gap-3">
                {addon.thumbUrl ? (
                  <img
                    src={addon.thumbUrl}
                    alt=""
                    className="w-12 h-12 flex-shrink-0"
                    style={{ imageRendering: "pixelated", border: "2px solid #5a5b5c" }}
                  />
                ) : (
                  <div
                    className="w-12 h-12 flex-shrink-0 flex items-center justify-center"
                    style={{ background: "#3a3a3a", border: "2px solid #5a5b5c" }}
                  >
                    <span className="mc-gold text-lg">{addon.name.charAt(0)}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="mc-white text-xs font-bold truncate">{addon.name}</div>
                  <div className="mc-gray" style={{ fontSize: 10 }}>
                    by {addon.authors.map((a) => a.name).join(", ") || "Unknown"}
                  </div>
                  <div className="mc-dark-gray mt-1 line-clamp-2" style={{ fontSize: 10, lineHeight: 1.4 }}>
                    {addon.summary}
                  </div>
                </div>
              </div>
              <div className="flex justify-between mt-2 text-xs">
                <span className="mc-aqua">{formatCount(addon.downloadCount)} downloads</span>
                <span className="mc-dark-gray">{timeAgo(addon.dateModified)}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            className="mc-btn text-xs px-3"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            &lt; Prev
          </button>
          <span className="mc-gray text-xs flex items-center">
            Page {page + 1} of {totalPages}
          </span>
          <button
            className="mc-btn text-xs px-3"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(page + 1)}
          >
            Next &gt;
          </button>
        </div>
      )}
    </div>
  );
}
