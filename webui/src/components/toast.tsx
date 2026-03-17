"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface Toast { id: number; message: string; type: "success" | "error" | "info" }
interface ToastContextValue { toast: (message: string, type?: Toast["type"]) => void }

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });
export function useToast() { return useContext(ToastContext); }
let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex flex-col gap-2 z-50 w-full max-w-sm px-4">
        {toasts.map((t) => (
          <div key={t.id} className="mc-dark-panel px-4 py-3 mc-toast" style={{ fontSize: 13 }}>
            <span className={t.type === "success" ? "mc-green" : t.type === "error" ? "mc-red" : "mc-aqua"}>
              {t.type === "success" ? "[+] " : t.type === "error" ? "[!] " : "[i] "}
            </span>
            <span className="mc-white">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
