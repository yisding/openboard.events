"use client";

import { Brand } from "@/shared/ui/brand";
import { RouteErrorState } from "./route-error-state";

/** Branded recovery shell for attendees and speakers outside the admin app. */
export function PublicRouteErrorState(props: React.ComponentProps<typeof RouteErrorState>) {
  return (
    <div className="public-route-error">
      <div className="public-route-error__brand"><Brand dark /></div>
      <RouteErrorState {...props} />
    </div>
  );
}
