"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "./confirm-dialog";

type GuardContext = {
  register: (token: symbol, active: boolean) => void;
  runGuarded: (action: () => void) => void;
  allowNextNavigation: (action?: () => void) => void;
};

const GuardContext = createContext<GuardContext>({
  register: () => undefined,
  runGuarded: (action) => action(),
  allowNextNavigation: (action) => action?.(),
});

type PendingDecision = { confirm: () => void | Promise<void>; cancel: () => void };

type NavigationEventLike = Event & {
  canIntercept: boolean;
  downloadRequest: string | null;
  hashChange: boolean;
  intercept: (options: { handler: () => Promise<void> }) => void;
};

type NavigationTarget = EventTarget & { addEventListener: EventTarget["addEventListener"]; removeEventListener: EventTarget["removeEventListener"] };

const HISTORY_GUARD_MARKER = "__openboardUnsavedWork";
const HISTORY_GUARD_ACTIVE = "__openboardUnsavedWorkActive";

type HistoryFallback = { leave: (action?: () => void) => void };

export function UnsavedWorkGuardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const guardsRef = useRef(new Set<symbol>());
  const [guardCount, setGuardCount] = useState(0);
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const allowNextRef = useRef(false);
  const historyFallbackRef = useRef<HistoryFallback | null>(null);
  const hasUnsavedWork = guardCount > 0;

  const register = useCallback((token: symbol, active: boolean) => {
    if (active) guardsRef.current.add(token);
    else guardsRef.current.delete(token);
    setGuardCount(guardsRef.current.size);
  }, []);

  const allowNextNavigation = useCallback((action?: () => void) => {
    const fallback = historyFallbackRef.current;
    if (fallback && action) {
      fallback.leave(action);
      return;
    }
    allowNextRef.current = true;
    action?.();
  }, []);

  const runGuarded = useCallback((action: () => void) => {
    if (guardsRef.current.size === 0) {
      action();
      return;
    }
    // Keep the first requested destination stable while its confirmation is
    // open. Global keyboard shortcuts may still fire behind the native dialog;
    // replacing this decision would make “Discard” perform a different action
    // than the one the organizer was asked to confirm.
    setPending((current) => current ?? { confirm: action, cancel: () => undefined });
  }, []);

  useEffect(() => {
    if (!hasUnsavedWork) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowNextRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    globalThis.addEventListener("beforeunload", warnBeforeUnload);
    return () => globalThis.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedWork]);

  useEffect(() => {
    if (!hasUnsavedWork) allowNextRef.current = false;
  }, [hasUnsavedWork]);

  useEffect(() => {
    if (!hasUnsavedWork) return;
    const navigation = (globalThis as typeof globalThis & { navigation?: NavigationTarget }).navigation;
    if (!navigation) {
      const marker = `${Date.now()}-${Math.random()}`;
      const currentUrl = window.location.href;
      const previousState = window.history.state;
      const markerState = typeof previousState === "object" && previousState !== null
        ? { ...previousState, [HISTORY_GUARD_MARKER]: marker }
        : { [HISTORY_GUARD_MARKER]: marker };
      const activeState = typeof previousState === "object" && previousState !== null
        ? { ...previousState, [HISTORY_GUARD_ACTIVE]: marker }
        : { [HISTORY_GUARD_ACTIVE]: marker };
      window.history.replaceState(markerState, "", currentUrl);
      window.history.pushState(activeState, "", currentUrl);
      let restoringMarker = false;
      let active = true;
      const leave = (action?: () => void) => {
        if (!active) {
          action?.();
          return;
        }
        active = false;
        historyFallbackRef.current = null;
        const performAction = () => {
          allowNextRef.current = Boolean(action);
          action?.();
        };
        const finish = () => {
          window.history.replaceState(previousState, "", currentUrl);
          performAction();
        };
        const state = window.history.state as Record<string, unknown> | null;
        if (state?.[HISTORY_GUARD_ACTIVE] === marker) {
          allowNextRef.current = true;
          globalThis.addEventListener("popstate", finish, { once: true });
          window.history.back();
        } else if (state?.[HISTORY_GUARD_MARKER] === marker) {
          finish();
        } else {
          performAction();
        }
      };
      historyFallbackRef.current = { leave };
      const guardHistory = (event: PopStateEvent) => {
        if (allowNextRef.current) {
          allowNextRef.current = false;
          return;
        }
        const state = event.state as Record<string, unknown> | null;
        if (restoringMarker && state?.[HISTORY_GUARD_ACTIVE] === marker) {
          restoringMarker = false;
          setPending((current) => current ?? {
            confirm: () => leave(() => {
              allowNextRef.current = true;
              window.history.back();
            }),
            cancel: () => undefined,
          });
          return;
        }
        if (state?.[HISTORY_GUARD_MARKER] === marker) {
          restoringMarker = true;
          window.history.forward();
        }
      };
      globalThis.addEventListener("popstate", guardHistory);
      return () => {
        globalThis.removeEventListener("popstate", guardHistory);
        if (active) leave();
      };
    }
    const guardNavigation = (rawEvent: Event) => {
      const event = rawEvent as NavigationEventLike;
      if (allowNextRef.current) {
        allowNextRef.current = false;
        return;
      }
      if (!event.canIntercept || event.downloadRequest !== null || event.hashChange) return;
      event.intercept({
        handler: () => new Promise<void>((resolve, reject) => {
          setPending({
            confirm: resolve,
            cancel: () => reject(new DOMException("Navigation cancelled", "AbortError")),
          });
        }),
      });
    };
    navigation.addEventListener("navigate", guardNavigation);
    return () => navigation.removeEventListener("navigate", guardNavigation);
  }, [hasUnsavedWork]);

  const context = useMemo(() => ({ register, runGuarded, allowNextNavigation }), [register, runGuarded, allowNextNavigation]);

  function captureLink(event: React.MouseEvent) {
    if (!hasUnsavedWork || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const origin = event.target;
    if (!(origin instanceof Element)) return;
    const anchor = origin.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
    if (anchor.hasAttribute("data-unsaved-guard-owned")) return;
    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
    event.preventDefault();
    event.stopPropagation();
    runGuarded(() => allowNextNavigation(() => {
      router.push(`${destination.pathname}${destination.search}${destination.hash}`);
    }));
  }

  return (
    <GuardContext.Provider value={context}>
      <div onClickCapture={captureLink} style={{ display: "contents" }}>{children}</div>
      <ConfirmDialog
        open={pending !== null}
        title="Discard unsaved work?"
        body="Your unsaved changes will be lost if you leave this page or switch to another item."
        confirmLabel="Discard changes"
        onConfirm={async () => {
          const decision = pending;
          setPending(null);
          await decision?.confirm();
        }}
        onCancel={() => {
          pending?.cancel();
          setPending(null);
        }}
      />
    </GuardContext.Provider>
  );
}

export function useUnsavedWorkGuard(active: boolean) {
  const { register } = useContext(GuardContext);
  const token = useRef(Symbol("unsaved-work"));
  useEffect(() => {
    const current = token.current;
    register(current, active);
    return () => register(current, false);
  }, [active, register]);
}

export function useGuardedAction() {
  const { runGuarded, allowNextNavigation } = useContext(GuardContext);
  return { runGuarded, allowNextNavigation };
}
