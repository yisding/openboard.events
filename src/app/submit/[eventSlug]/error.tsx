"use client";

import { usePathname } from "next/navigation";
import { PublicRouteErrorState } from "@/shared/ui/app/public-route-error-state";

export default function SubmitError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const eventSlug = usePathname().split("/")[2];
  return (
    <PublicRouteErrorState
      title="We couldn't open this submission form"
      description="The connection may have been interrupted before the form was ready. Try again; no saved draft has been removed."
      reset={reset}
      backHref={eventSlug ? `/e/${encodeURIComponent(eventSlug)}/agenda` : "/"}
      backLabel="View the event"
    />
  );
}
