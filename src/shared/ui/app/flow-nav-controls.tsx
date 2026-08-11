import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * M57 — the small "3 of 24" + prev/next affordance a flow-through slide-over
 * shows beside its title, so the keyboard shortcut (`useFlowKeyboardNav`) has
 * a visible, clickable equivalent rather than being a secret.
 */
export function FlowNavControls({ index, total, onPrev, onNext }: { index: number; total: number; onPrev?: (() => void) | undefined; onNext?: (() => void) | undefined }) {
  if (total <= 1) return null;
  return (
    <div className="flow-nav-controls">
      <button type="button" className="icon-button" aria-label="Previous" disabled={!onPrev} onClick={onPrev}><ChevronUp size={14} /></button>
      <button type="button" className="icon-button" aria-label="Next" disabled={!onNext} onClick={onNext}><ChevronDown size={14} /></button>
      <span>{index + 1} of {total}</span>
    </div>
  );
}
