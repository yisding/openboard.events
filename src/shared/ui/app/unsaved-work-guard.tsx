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

export function holdHistoryTraversal(
  history: Pick<History, "replaceState">,
  currentUrl: string,
  markerState: unknown,
  targetUrl: string,
  targetState: unknown,
  replay: (state: unknown) => void,
): PendingDecision {
  history.replaceState(markerState, "", currentUrl);
  return {
    confirm: () => {
      history.replaceState(targetState, "", targetUrl);
      replay(targetState);
    },
    cancel: () => undefined,
  };
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
      const guardHistory = (event: PopStateEvent) => {
        if (allowNextRef.current) {
          allowNextRef.current = false;
          return;
        }
        const state = event.state as Record<string, unknown> | null;
        if (state?.[HISTORY_GUARD_MARKER] === marker) return;
        event.stopImmediatePropagation();
        const targetState = event.state;
        const targetUrl = window.location.href;
        // Popstate is delivered after a same-document traversal. Temporarily
        // turn the traversed entry into the guarded page instead of probing in
        // either direction, which could cross into an unrelated document.
        // Confirm restores the exact target entry and replays the event for
        // Next; cancel intentionally leaves this one entry replaced.
        const decision = holdHistoryTraversal(
          window.history,
          currentUrl,
          markerState,
          targetUrl,
          targetState,
          (replayState) => {
            allowNextRef.current = true;
            window.dispatchEvent(new PopStateEvent("popstate", { state: replayState }));
          },
        );
        setPending((current) => current ?? {
          confirm: () => leave(decision.confirm),
          cancel: decision.cancel,
        });
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
