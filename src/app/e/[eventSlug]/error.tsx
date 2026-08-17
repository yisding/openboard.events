"use client";

import { usePathname } from "next/navigation";
import { PublicRouteErrorState } from "@/shared/ui/app/public-route-error-state";

export default function PublicEventError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const eventSlug = usePathname().split("/")[2];
  return (
    <PublicRouteErrorState
      title="This event page didn’t load"
      description="This part of the published program is temporarily unavailable. Try again, or return to the event agenda."
      reset={reset}
      backHref={eventSlug ? `/e/${encodeURIComponent(eventSlug)}/agenda` : "/"}
      backLabel="View the event agenda"
    />
  );
}
