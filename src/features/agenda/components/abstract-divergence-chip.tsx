"use client";

import { EyeOff, PenLine } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import {
  abstractDivergence,
  divergenceNotice,
  type DivergenceSession,
} from "../lib/abstract-divergence";

/**
 * The one mark every agenda surface uses when a session and its abstract have
 * stopped agreeing. Renders nothing at all for the ordinary case, so a healthy
 * row keeps exactly the layout it had.
 *
 * The label is short enough for a table cell; the whole story is in `title` for
 * a pointer and in an `.sr-only` sentence for everyone else, because a chip
 * reading "Not on the public schedule" with no reason is its own small mystery.
 */
export function AbstractDivergenceChip({ session, className }: { session: DivergenceSession; className?: string }) {
  const divergence = abstractDivergence(session);
  if (!divergence) return null;
  const notice = divergenceNotice(divergence);
  const Icon = divergence.kind === "title_drift" ? PenLine : EyeOff;
  return (
    <span
      className={cn("agenda-divergence-chip", `agenda-divergence-chip--${notice.tone}`, className)}
      title={notice.detail}
    >
      <Icon size={11} aria-hidden />
      <span>{notice.label}</span>
      <span className="sr-only">. {notice.detail}</span>
    </span>
  );
}
