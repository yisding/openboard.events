"use client";

import { PublicRouteErrorState } from "@/shared/ui/app/public-route-error-state";

export default function PublicEventError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PublicRouteErrorState
      title="This event page didn't load"
      description="The published program is temporarily unavailable. Try again to reconnect, or return to Openboard."
      reset={reset}
      backHref="/"
      backLabel="Openboard home"
    />
  );
}
