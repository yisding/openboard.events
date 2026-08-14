"use client";

import { PublicRouteErrorState } from "@/shared/ui/app/public-route-error-state";

export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PublicRouteErrorState
      title="Openboard hit a snag"
      description="A temporary problem interrupted this page. Try it again; anything already saved is still safe."
      reset={reset}
      backHref="/"
      backLabel="Openboard home"
    />
  );
}
