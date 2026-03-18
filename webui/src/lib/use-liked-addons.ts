"use client";

import { useEffect, useState } from "react";

export interface LikedAddon {
  id: number;
  name: string;
  thumbUrl: string;
  authors: { name: string }[];
  downloadCount: number;
  dateModified: string;
  summary: string;
}

const STORAGE_KEY = "mc-liked-addons";

function readLikedAddons(): LikedAddon[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLikedAddons(addons: LikedAddon[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(addons));
}

export function useLikedAddons() {
  const [likedAddons, setLikedAddons] = useState<LikedAddon[]>([]);

  useEffect(() => {
    setLikedAddons(readLikedAddons());
  }, []);

  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        setLikedAddons(readLikedAddons());
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  function toggle(addon: LikedAddon) {
    setLikedAddons((current) => {
      const exists = current.some((item) => item.id === addon.id);
      const next = exists ? current.filter((item) => item.id !== addon.id) : [addon, ...current];
      writeLikedAddons(next);
      return next;
    });
  }

  const likedIds = new Set(likedAddons.map((addon) => addon.id));

  return {
    likedAddons,
    likedIds,
    isLiked: (id: number) => likedIds.has(id),
    toggle,
    count: likedAddons.length,
  };
}
