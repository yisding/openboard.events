"use client";

import { usePathname } from "next/navigation";
import { PublicRouteErrorState } from "@/shared/ui/app/public-route-error-state";

/** Parent-segment boundary: catches failures in the event portal layout itself. */
export default function PortalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const eventSlug = usePathname().split("/")[2];
  return (
    <PublicRouteErrorState
      title="The speaker portal didn’t load"
      description="A temporary problem interrupted this page. Try again; your profile, submissions, and completed tasks are still safe."
      reset={reset}
      backHref={eventSlug ? `/e/${encodeURIComponent(eventSlug)}/agenda` : "/"}
      backLabel="View the event"
    />
  );
}
