"use client";

import { RouteErrorState } from "@/shared/ui/app/route-error-state";

export default function EventError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteErrorState
      title="This event page didn't load"
      description="A temporary read failed before this page was ready. Retry here, or return to your event list without losing saved work."
      reset={reset}
      backHref="/events"
    />
  );
}
