"use client";

import { usePathname } from "next/navigation";
import { RouteErrorState } from "@/shared/ui/app/route-error-state";

/**
 * Renders inside `layout.tsx`, so the branded header and its "Back to events"
 * link stay on screen and only the content area is replaced — which is why
 * this one is `inline`.
 *
 * Team, Billing, Audit, CRM and the guided setup all share it. A sub-page that
 * fails can still fall back to organization home; organization home itself has
 * to send the reader one level further out.
 */
export default function OrganizationError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const segments = usePathname().split("/").filter(Boolean);
  const organizationId = segments[1] ?? "";
  const atHome = segments.length < 3 || !organizationId;
  return (
    <RouteErrorState
      inline
      title={atHome ? "We couldn’t load this organization" : "This organization page didn’t load"}
      description="A temporary read failed before the page was ready. Retry here, or step back — nothing in this workspace has changed."
      reset={reset}
      backHref={atHome ? "/events" : `/organizations/${organizationId}`}
      backLabel={atHome ? "Back to events" : "Organization home"}
    />
  );
}
