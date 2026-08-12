"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "./confirm-dialog";

type GuardContext = {
  register: (token: symbol, active: boolean) => void;
  runGuarded: (action: () => void) => void;
  allowNextNavigation: (action?: () => void, options?: NavigationOptions) => void;
};

type NavigationOptions = { hardUnload?: boolean; destination?: string };

const GuardContext = createContext<GuardContext>({
  register: () => undefined,
  runGuarded: (action) => action(),
  allowNextNavigation: (action) => action?.(),
});

type PendingDecision = { confirm: () => void | Promise<void>; cancel: () => void };

type NavigationEventLike = Event & {
  canIntercept: boolean;
  destination: { sameDocument: boolean };
  downloadRequest: string | null;
  hashChange: boolean;
  navigationType?: string;
  intercept: (options: { handler: () => Promise<void> }) => void;
};

type NavigationTarget = EventTarget & { addEventListener: EventTarget["addEventListener"]; removeEventListener: EventTarget["removeEventListener"] };

const HISTORY_GUARD_MARKER = "__openboardUnsavedWork";
const HISTORY_POSITION = "__openboardHistoryPosition";

type HistoryFallback = { leave: (action?: () => void) => void };

export function isSameNavigationDestination(destination: string, currentHref: string) {
  return new URL(destination, currentHref).href === new URL(currentHref).href;
}

export function shouldInterceptNavigation(event: Pick<NavigationEventLike, "canIntercept" | "destination" | "downloadRequest" | "hashChange" | "navigationType">) {
  return event.navigationType !== "reload"
    && event.destination.sameDocument
    && event.canIntercept
    && event.downloadRequest === null
    && !event.hashChange;
}

function historyPosition(state: unknown): number | null {
  if (typeof state !== "object" || state === null) return null;
  const position = (state as Record<string, unknown>)[HISTORY_POSITION];
  return typeof position === "number" && Number.isFinite(position) ? position : null;
}

function withHistoryPosition(state: unknown, position: number): Record<string, unknown> {
  return typeof state === "object" && state !== null
    ? { ...state, [HISTORY_POSITION]: position }
    : { [HISTORY_POSITION]: position };
}

export function historyTraversalDelta(currentState: unknown, targetState: unknown): number | null {
  const current = historyPosition(currentState);
  const target = historyPosition(targetState);
  return current === null || target === null ? null : target - current;
}

/**
 * Mounted once by the root layout so routes visited before a guarded shell
 * (notably /events) already carry positions when dirty work begins later.
 * Cross-document entries never reach this popstate fallback; beforeunload owns
 * those transitions.
 */
export function HistoryPositionTracker() {
  useEffect(() => {
    const history = window.history;
    let currentPosition = historyPosition(history.state) ?? 0;
    if (historyPosition(history.state) === null) {
      history.replaceState(withHistoryPosition(history.state, currentPosition), "", window.location.href);
    }

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    const trackedPushState: History["pushState"] = (data, unused, url) => {
      currentPosition += 1;
      return originalPushState.call(history, withHistoryPosition(data, currentPosition), unused, url);
    };
    const trackedReplaceState: History["replaceState"] = (data, unused, url) => {
      currentPosition = historyPosition(data) ?? currentPosition;
      return originalReplaceState.call(history, withHistoryPosition(data, currentPosition), unused, url);
    };
    const trackTraversal = (event: PopStateEvent) => {
      const nextPosition = historyPosition(event.state);
      if (nextPosition !== null) currentPosition = nextPosition;
    };

    history.pushState = trackedPushState;
    history.replaceState = trackedReplaceState;
    globalThis.addEventListener("popstate", trackTraversal, { capture: true });
    return () => {
      globalThis.removeEventListener("popstate", trackTraversal, { capture: true });
      if (history.pushState === trackedPushState) history.pushState = originalPushState;
      if (history.replaceState === trackedReplaceState) history.replaceState = originalReplaceState;
    };
  }, []);

  return null;
}

export function UnsavedWorkGuardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const guardsRef = useRef(new Set<symbol>());
  const [guardCount, setGuardCount] = useState(0);
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const allowNextRef = useRef(false);
  const allowNextUnloadRef = useRef(false);
  const historyFallbackRef = useRef<HistoryFallback | null>(null);
  const hasUnsavedWork = guardCount > 0;

  const register = useCallback((token: symbol, active: boolean) => {
    if (active) guardsRef.current.add(token);
    else guardsRef.current.delete(token);
    setGuardCount(guardsRef.current.size);
  }, []);

  const allowNextNavigation = useCallback((action?: () => void, options?: NavigationOptions) => {
    allowNextUnloadRef.current = options?.hardUnload === true;
    // A client router may accept a same-URL push without emitting a navigation
    // event or rerendering this provider. Do not consume either guard's one-shot
    // allowance when there is no destination change to allow.
    if (action && !options?.hardUnload && options?.destination && isSameNavigationDestination(options.destination, window.location.href)) {
      allowNextRef.current = false;
      allowNextUnloadRef.current = false;
      action();
      return;
    }
    const fallback = historyFallbackRef.current;
    if (fallback && action) {
      try {
        fallback.leave(action);
      } catch (error) {
        allowNextRef.current = false;
        allowNextUnloadRef.current = false;
        throw error;
      }
      return;
    }
    allowNextRef.current = true;
    try {
      action?.();
    } catch (error) {
      allowNextRef.current = false;
      allowNextUnloadRef.current = false;
      throw error;
    }
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
      if (allowNextUnloadRef.current) {
        allowNextUnloadRef.current = false;
        return;
      }
      if (allowNextRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    globalThis.addEventListener("beforeunload", warnBeforeUnload);
    return () => globalThis.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedWork]);

  useEffect(() => {
    if (!hasUnsavedWork) {
      allowNextRef.current = false;
      allowNextUnloadRef.current = false;
    }
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
      window.history.replaceState(markerState, "", currentUrl);
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
          try {
            action?.();
          } catch (error) {
            allowNextRef.current = false;
            allowNextUnloadRef.current = false;
            active = true;
            window.history.replaceState(markerState, "", currentUrl);
            historyFallbackRef.current = { leave };
            throw error;
          }
        };
        const finish = () => {
          window.history.replaceState(previousState, "", currentUrl);
          performAction();
        };
        const state = window.history.state as Record<string, unknown> | null;
        if (state?.[HISTORY_GUARD_MARKER] === marker) {
          finish();
        } else {
          performAction();
        }
      };
      historyFallbackRef.current = { leave };
      let returningTraversal: { delta: number } | null = null;
      const guardHistory = (event: PopStateEvent) => {
        if (allowNextRef.current) {
          allowNextRef.current = false;
          const returned = returningTraversal;
          returningTraversal = null;
          if (returned) {
            setPending((current) => current ?? {
              confirm: () => leave(() => {
                allowNextRef.current = true;
                window.history.go(returned.delta);
              }),
              cancel: () => undefined,
            });
          }
          return;
        }
        const state = event.state as Record<string, unknown> | null;
        if (state?.[HISTORY_GUARD_MARKER] === marker) return;
        const delta = historyTraversalDelta(markerState, event.state);
        if (delta === null || delta === 0) return;
        event.stopImmediatePropagation();
        // Every entry created while this shell is mounted has a monotonic
        // position. Return by the exact inverse delta, then offer the decision
        // from the still-guarded entry; this never searches adjacent history
        // and therefore cannot wander into a different document.
        returningTraversal = { delta };
        allowNextRef.current = true;
        window.history.go(-delta);
      };
      globalThis.addEventListener("popstate", guardHistory, { capture: true });
      return () => {
        globalThis.removeEventListener("popstate", guardHistory, { capture: true });
        if (active) leave();
      };
    }
    const guardNavigation = (rawEvent: Event) => {
      const event = rawEvent as NavigationEventLike;
      if (allowNextRef.current) {
        allowNextRef.current = false;
        return;
      }
      // Intercepting reloads or cross-document transitions turns them into
      // same-document navigation. Let beforeunload own both so confirming
      // actually loads the requested document.
      if (!shouldInterceptNavigation(event)) return;
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
    }, { destination: destination.href }));
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
