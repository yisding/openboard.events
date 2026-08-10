import Image from "next/image";

// A confirmed speaker's headshot, or an initials placeholder when the seed
// (deliberately) has none. Reused by both the schedule's speaker chips and the
// speaker gallery so the placeholder rule never drifts between the two.
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = `${parts[0]?.[0] ?? ""}${parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : ""}`;
  return initials.toUpperCase() || "?";
}

const SIZE_PX = { sm: 27, md: 34, lg: 44, xl: 72 } as const;

export function SpeakerAvatar({ name, headshotUrl, size = "sm", color }: { name: string; headshotUrl: string | null; size?: "sm" | "md" | "lg" | "xl"; color?: string }) {
  const className = `person-avatar person-avatar-${size}`;
  if (headshotUrl) {
    // `/f/[fileId]` is our own immutable-cached route, not a remote host — the
    // Next image optimizer would only reprocess an already-cache-perfect
    // asset, so this follows the same `unoptimized` convention as the portal
    // profile photo.
    const px = SIZE_PX[size];
    return <Image src={headshotUrl} alt={name} width={px} height={px} className={className} style={{ objectFit: "cover" }} unoptimized />;
  }
  return <span className={className} style={{ background: color ?? "var(--purple)" }}>{initialsOf(name)}</span>;
}
