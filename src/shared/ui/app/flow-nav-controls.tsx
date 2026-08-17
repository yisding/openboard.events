import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * M57 — the small "3 of 24" + prev/next affordance a flow-through slide-over
 * shows beside its title, so the keyboard shortcut (`useFlowKeyboardNav`) has
 * a visible, clickable equivalent rather than being a secret.
 *
 * `itemNoun` names what the arrows step through, and is required rather than
 * defaulted: bare "Previous"/"Next" was the one pair of icon-buttons in the app
 * with no object in its label, and read out of the surrounding context — which
 * is how a screen reader's element list reads them — "Previous" says nothing
 * about what it would leave. A default would let the next flow drawer quietly
 * reintroduce that.
 */
export function FlowNavControls({ index, total, itemLabel, itemNoun, onPrev, onNext }: { index: number; total: number; itemLabel?: string | undefined; itemNoun: string; onPrev?: (() => void) | undefined; onNext?: (() => void) | undefined }) {
  if (total <= 1) return null;
  return (
    <div className="flow-nav-controls">
      <button type="button" className="icon-button" aria-label={`Previous ${itemNoun}`} disabled={!onPrev} onClick={onPrev}><ChevronUp size={14} /></button>
      <button type="button" className="icon-button" aria-label={`Next ${itemNoun}`} disabled={!onNext} onClick={onNext}><ChevronDown size={14} /></button>
      <span role="status" aria-live="polite" aria-atomic="true"><span className="sr-only">{itemLabel ? `Viewing ${itemLabel}, ` : ""}</span>{index + 1} of {total}</span>
    </div>
  );
}
