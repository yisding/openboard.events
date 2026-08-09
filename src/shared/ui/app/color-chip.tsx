import { cn } from "@/shared/lib/cn";

/**
 * A track, format or tag rendered with its own colour. The colour comes from the
 * row, not from a feature-local map — vocabulary colours are organizer-chosen
 * and must look identical in the agenda, the abstracts table and the public page.
 */
export function ColorChip({ label, color, className }: { label: string; color?: string | null; className?: string }) {
  const style = color ? { background: `${color}1f`, color } : undefined;
  return (
    <span className={cn("track-chip", className)} {...(style ? { style } : {})}>
      {label}
    </span>
  );
}
