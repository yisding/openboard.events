"use client";

import { CheckCircle2, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

type ToastContextValue = { toast: (message: string) => void };
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const toast = useCallback((next: string) => {
    setMessage(next);
    window.setTimeout(() => setMessage(null), 3200);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return <ToastContext.Provider value={value}>{children}{message && <div className="toast"><CheckCircle2 size={18} /><span>{message}</span><button aria-label="Dismiss" onClick={() => setMessage(null)}><X size={16} /></button></div>}</ToastContext.Provider>;
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be inside ToastProvider");
  return value;
}
