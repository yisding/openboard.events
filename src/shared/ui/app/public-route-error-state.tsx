"use client";

import { Brand } from "@/shared/ui/brand";
import { RouteErrorState } from "./route-error-state";

/** Branded recovery shell for attendees and speakers outside the admin app. */
export function PublicRouteErrorState({ brandTarget, ...props }: React.ComponentProps<typeof RouteErrorState> & { brandTarget?: React.HTMLAttributeAnchorTarget }) {
  return (
    <div className="public-route-error">
      <div className="public-route-error__brand"><Brand dark {...(brandTarget ? { target: brandTarget } : {})} /></div>
      <RouteErrorState {...props} />
    </div>
  );
}
