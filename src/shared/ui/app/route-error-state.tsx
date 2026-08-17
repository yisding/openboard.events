"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, RotateCw } from "lucide-react";
import { useId, useTransition } from "react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/ui-kit";

export function RouteErrorState({
  title,
  description,
  reset,
  backHref,
  backLabel = "Back to events",
  backTarget,
  inline = false,
}: {
  title: string;
  description: string;
  reset: () => void;
  backHref: string;
  backLabel?: string;
  backTarget?: React.HTMLAttributeAnchorTarget;
  /**
   * Set by the boundaries that render underneath a layout which already owns
   * the page's `<main>` and its branded header. They get a `<section>` sized to
   * the content area instead — a second landmark, or a second full viewport of
   * height, would both be wrong there.
   */
  inline?: boolean;
}) {
  const [retrying, startRetry] = useTransition();
  const titleId = useId();
  const Wrapper = inline ? "section" : "main";
  return (
    <Wrapper className={cn("route-error-state", inline && "route-error-state--inline")} role="alert" aria-labelledby={titleId}>
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
        <Link className="button button-secondary" href={backHref} target={backTarget}>
          <ArrowLeft size={15} aria-hidden /> {backLabel}
        </Link>
      </div>
    </Wrapper>
  );
}
