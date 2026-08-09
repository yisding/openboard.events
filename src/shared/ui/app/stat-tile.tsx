import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { Dash } from "./dash";

/**
 * One dashboard number. `href` makes the whole tile a deep link, which is what
 * the attention strip needs — a number nobody can click is a number nobody acts
 * on. A null value renders `<Dash>` rather than "0", because "none yet" and
 * "zero" are different answers.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  href,
  isLoading = false,
}: {
  label: string;
  value: number | string | null | undefined;
  hint?: ReactNode;
  tone?: "default" | "warning" | "danger";
  href?: string;
  isLoading?: boolean;
}) {
  const body = (
    <>
      <span className="stat-tile__label">{label}</span>
      <strong className="stat-tile__value">{isLoading ? <span className="stat-tile__skeleton" /> : <Dash value={value} />}</strong>
      {hint && <small className="stat-tile__hint">{hint}</small>}
    </>
  );
  const className = cn("stat-tile", tone !== "default" && `stat-tile--${tone}`, href && "stat-tile--link");
  return href ? <Link href={href} className={className}>{body}</Link> : <article className={className}>{body}</article>;
}
