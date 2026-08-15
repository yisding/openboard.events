/**
 * A one-event bus that lets a success handler tell the tour "something just
 * happened, look now" instead of waiting out the poll interval.
 *
 * It is a latency optimisation and **never an authority**. Every objective is
 * still decided by the server's world snapshot, so a signal that is never
 * emitted — because the organizer acted in a second tab, or through a route
 * nobody wired up — costs at most one poll interval and changes no outcome.
 * Delete an `emitTourSignal` call and the tour still completes; that property
 * is what an integration test with the bus stubbed out exists to protect.
 *
 * It lives in its own module so a feature component can import the emitter
 * without pulling the engine into its chunk.
 */

const TOUR_SIGNAL_EVENT = "openboard:tour-signal";

export function emitTourSignal(name: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOUR_SIGNAL_EVENT, { detail: { name } }));
}

/** Subscribe to every signal. Returns the unsubscribe. */
export function onTourSignal(listener: (name: string) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ name?: unknown }>).detail;
    if (detail && typeof detail.name === "string") listener(detail.name);
  };
  window.addEventListener(TOUR_SIGNAL_EVENT, handler);
  return () => window.removeEventListener(TOUR_SIGNAL_EVENT, handler);
}
