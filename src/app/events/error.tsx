"use client";

import { usePathname } from "next/navigation";
import { RouteErrorState } from "@/shared/ui/app/route-error-state";

export default function EventsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const atHub = usePathname() === "/events";
  return (
    <RouteErrorState
      title={atHub ? "We couldn't load your events" : "We couldn't open this event"}
      description="The connection may have been interrupted. Your saved data is still safe; retry the request when you are ready."
      reset={reset}
      backHref={atHub ? "/organizations" : "/events"}
      backLabel={atHub ? "Organization home" : "Back to events"}
    />
  );
}
