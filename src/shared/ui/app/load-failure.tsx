"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/ui-kit";

/**
 * The one shape a read that failed takes, anywhere in the product.
 *
 * Before this existed the same condition wore six costumes — a grey
 * `portal-note` with a text-button, a red `field-error` beside a secondary
 * button, a bare button with no message, an `EmptyState` (which announces
 * nothing and offers no way back), and two panels that simply printed the
 * error and left the reader stranded. The retry itself was labelled five
 * different ways, so "did that work?" had no consistent answer either.
 *
 * What a failed read owes the reader is always the same three things: an
 * announcement (`role="alert"`, because it arrives after the reader has
 * already looked away), a sentence saying what did not load, and the way to
 * ask again. `onRetry` is optional only for the rare surface that genuinely
 * cannot ask again; when it is there the label is always "Try again", the
 * same words the route-level error boundary uses.
 *
 * ```tsx
 * {loadError && <LoadFailure message="Assignments could not be loaded." onRetry={() => void load()} />}
 * ```
 */
export function LoadFailure({
  message,
  onRetry,
  retrying = false,
  className,
}: {
  message: string;
  onRetry?: (() => void) | undefined;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("load-failure", className)} role="alert">
      <span className="load-failure__icon"><AlertTriangle size={16} aria-hidden /></span>
      <p>{message}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" disabled={retrying} onClick={onRetry}>
          <RotateCw size={14} aria-hidden /> {retrying ? "Retrying…" : "Try again"}
        </Button>
      )}
    </div>
  );
}
