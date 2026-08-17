"use client";

import { RouteErrorState } from "@/shared/ui/app/route-error-state";

/**
 * Renders inside `layout.tsx` (branded header intact), so it is `inline` for
 * the same reason the organization boundary is. The reassurance is specific:
 * the one thing a reader of the sessions page fears when it breaks is that
 * their own session went with it.
 */
export default function AccountError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteErrorState
      inline
      title="We couldn’t load your account"
      description="A temporary read failed before this page was ready. You are still signed in — retry here, or head back to your events."
      reset={reset}
      backHref="/events"
    />
  );
}
