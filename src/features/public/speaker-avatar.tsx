import { Avatar, type AvatarSize } from "@/shared/ui/ui-kit";

// A confirmed speaker's headshot, or an initials placeholder when the seed
// (deliberately) has none. Reused by both the schedule's speaker chips and the
// speaker gallery so the placeholder rule never drifts between the two.
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = `${parts[0]?.[0] ?? ""}${parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : ""}`;
  return initials.toUpperCase() || "?";
}

export function SpeakerAvatar({ name, headshotUrl, size = "sm", color }: { name: string; headshotUrl: string | null; size?: AvatarSize; color?: string }) {
  return (
    <Avatar
      initials={initialsOf(name)}
      size={size}
      {...(color ? { color } : {})}
      {...(headshotUrl ? { imageUrl: headshotUrl, imageAlt: name } : {})}
    />
  );
}
