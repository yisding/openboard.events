"use client";

import { usePathname } from "next/navigation";
import { RouteErrorState } from "@/shared/ui/app/route-error-state";

/**
 * `/organizations` has no layout, so this boundary is the outermost one for
 * the whole organization subtree: it catches the chooser page *and* anything
 * `[organizationId]/layout.tsx` throws before its own boundary exists. Without
 * it those failures reached `app/error.tsx`, which hands a signed-in
 * organization owner the marketing shell and a link to the public home page.
 */
export default function OrganizationsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const atChooser = usePathname() === "/organizations";
  return (
    <RouteErrorState
      title={atChooser ? "We couldn't load your organizations" : "We couldn't open this organization"}
      description="A temporary read failed before this page was ready. Retry when you are ready; every member, invitation and event in this workspace is untouched."
      reset={reset}
      backHref="/events"
    />
  );
}
