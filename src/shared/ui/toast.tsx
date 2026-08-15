"use client";

import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { raiseTopLayerStack, registerTopLayerStack } from "./top-layer";

export type ToastKind = "success" | "error";
export type ToastAction = { label: string; onClick: () => void };
export type ToastOptions = { kind?: ToastKind; durationMs?: number; action?: ToastAction };
type ToastContextValue = { toast: (message: string, options?: ToastOptions) => void };
type ToastState = { id: number; message: string; kind: ToastKind; action?: ToastAction };
const ToastContext = createContext<ToastContextValue | null>(null);
const MAX_VISIBLE_TOASTS = 3;

export function ToastMessage({ message, kind, action, onDismiss }: Omit<ToastState, "id"> & { onDismiss: () => void }) {
  const error = kind === "error";
  return (
    <div className="toast" role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"} aria-atomic="true">
      {/* The error tint comes from `.toast[role="alert"] > svg` (var(--red-bright)),
          not an inline hex: a colour in JSX is invisible to the stylesheet and to
          every audit that reads it. */}
      {error ? <AlertCircle size={18} aria-hidden /> : <CheckCircle2 size={18} aria-hidden />}
      <span>{message}</span>
      {action && <button type="button" className="toast-action" onClick={() => { onDismiss(); action.onClick(); }}>{action.label}</button>}
      <button type="button" className="toast-dismiss" aria-label={`Dismiss “${message}”`} onClick={onDismiss}><X size={16} /></button>
    </div>
  );
}

/**
 * Drawers and dialogs are `<dialog>` elements opened with `showModal()`, which
 * promotes them to the top layer — painted above every z-index there is, and
 * dimmed behind their own `::backdrop`. A toast raised *by* a form inside one
 * was therefore clipped by the panel's edge, losing roughly half of the very
 * message the organizer needed to read.
 *
 * Showing the stack as a manual popover puts it in the top layer too, and
 * re-showing it whenever the set of toasts changes keeps it last in top-layer
 * order — above whichever dialog is currently open. `top-layer.ts` owns the
 * showing itself, because `ModalDialog` has to redo it from the other
 * direction: a drawer opened over a toast that is already up goes in *above*
 * it, which leaves the toast pointer-inert and out of the accessibility tree.
 */
function useTopLayerToasts(stack: HTMLDivElement | null, toasts: readonly ToastState[]) {
  useEffect(() => {
    registerTopLayerStack(stack);
    raiseTopLayerStack();
    return () => registerTopLayerStack(null);
  }, [stack, toasts]);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const [stack, setStack] = useState<HTMLDivElement | null>(null);
  const toastsRef = useRef<ToastState[]>([]);
  const nextIdRef = useRef(0);
  const timersRef = useRef(new Map<number, number>());
  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timersRef.current.delete(id);
    const next = toastsRef.current.filter((item) => item.id !== id);
    toastsRef.current = next;
    setToasts(next);
  }, []);
  const toast = useCallback((message: string, options: ToastOptions = {}) => {
    const kind = options.kind ?? "success";
    const id = nextIdRef.current += 1;
    const next = [...toastsRef.current, { id, message, kind, ...(options.action ? { action: options.action } : {}) }];
    const evicted = next.slice(0, -MAX_VISIBLE_TOASTS);
    for (const item of evicted) {
      const timer = timersRef.current.get(item.id);
      if (timer !== undefined) window.clearTimeout(timer);
      timersRef.current.delete(item.id);
    }
    toastsRef.current = next.slice(-MAX_VISIBLE_TOASTS);
    setToasts(toastsRef.current);
    // Errors carry information a person may need to recover from a failed
    // mutation, so they never disappear while being read. Success remains
    // transient and may opt into a custom duration.
    if (kind === "success") {
      const timer = window.setTimeout(() => dismiss(id), options.durationMs ?? 3200);
      timersRef.current.set(id, timer);
    }
  }, [dismiss]);
  useEffect(() => () => {
    for (const timer of timersRef.current.values()) window.clearTimeout(timer);
    timersRef.current.clear();
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  useTopLayerToasts(stack, toasts);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-stack" ref={setStack}>
          {toasts.map(({ id, ...item }) => <ToastMessage key={id} {...item} onDismiss={() => dismiss(id)} />)}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be inside ToastProvider");
  return value;
}
