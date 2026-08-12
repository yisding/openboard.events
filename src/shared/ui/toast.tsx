"use client";

import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type ToastKind = "success" | "error";
export type ToastOptions = { kind?: ToastKind; durationMs?: number };
type ToastContextValue = { toast: (message: string, options?: ToastOptions) => void };
type ToastState = { message: string; kind: ToastKind };
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastMessage({ message, kind, onDismiss }: ToastState & { onDismiss: () => void }) {
  const error = kind === "error";
  return (
    <div className="toast" role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"} aria-atomic="true">
      {/* The error tint comes from `.toast[role="alert"] > svg` (var(--red-bright)),
          not an inline hex: a colour in JSX is invisible to the stylesheet and to
          every audit that reads it. */}
      {error ? <AlertCircle size={18} aria-hidden /> : <CheckCircle2 size={18} aria-hidden />}
      <span>{message}</span>
      <button type="button" aria-label="Dismiss" onClick={onDismiss}><X size={16} /></button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<ToastState | null>(null);
  const timerRef = useRef<number | null>(null);
  const dismiss = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setCurrent(null);
  }, []);
  const toast = useCallback((message: string, options: ToastOptions = {}) => {
    const kind = options.kind ?? "success";
    setCurrent({ message, kind });
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    const timer = window.setTimeout(() => {
      if (timerRef.current !== timer) return;
      timerRef.current = null;
      setCurrent(null);
    }, options.durationMs ?? (kind === "error" ? 6000 : 3200));
    timerRef.current = timer;
  }, []);
  useEffect(() => () => { if (timerRef.current !== null) window.clearTimeout(timerRef.current); }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return <ToastContext.Provider value={value}>{children}{current && <ToastMessage {...current} onDismiss={dismiss} />}</ToastContext.Provider>;
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be inside ToastProvider");
  return value;
}
