"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, RotateCw } from "lucide-react";
import { useId, useTransition } from "react";
import { Button } from "@/shared/ui/ui-kit";

export function RouteErrorState({
  title,
  description,
  reset,
  backHref,
  backLabel = "Back to events",
}: {
  title: string;
  description: string;
  reset: () => void;
  backHref: string;
  backLabel?: string;
}) {
  const [retrying, startRetry] = useTransition();
  const titleId = useId();
  return (
    <main className="route-error-state" role="alert" aria-labelledby={titleId}>
      <span className="route-error-state__icon"><AlertTriangle size={24} aria-hidden /></span>
      <div>
        <p className="page-eyebrow">Temporary problem</p>
        <h1 id={titleId}>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="route-error-state__actions">
        <Button disabled={retrying} onClick={() => startRetry(reset)}>
          <RotateCw size={15} aria-hidden /> {retrying ? "Retrying…" : "Try again"}
        </Button>
        <Link className="button button-secondary" href={backHref}>
          <ArrowLeft size={15} aria-hidden /> {backLabel}
        </Link>
      </div>
    </main>
  );
}
