"use client";

import { usePathname } from "next/navigation";
import { PublicRouteErrorState } from "@/shared/ui/app/public-route-error-state";

export default function EmbedError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const eventSlug = usePathname().split("/")[2];
  return (
    <PublicRouteErrorState
      title="This embedded program didn't load"
      description="The event program is temporarily unavailable. Try again here, or open the full event agenda."
      reset={reset}
      backHref={eventSlug ? `/e/${encodeURIComponent(eventSlug)}/agenda` : "/"}
      backLabel="Open the full event"
      backTarget="_top"
      brandTarget="_top"
    />
  );
}
