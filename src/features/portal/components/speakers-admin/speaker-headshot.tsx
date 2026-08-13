"use client";

import { useState } from "react";
import { Avatar, type AvatarSize } from "@/shared/ui/ui-kit";

/**
 * A speaker's headshot in the admin: `/f/{headshotFileId}` when there is one,
 * the initials avatar otherwise. Same serving route and CSS classes as the
 * public gallery's `SpeakerAvatar` (`src/features/public/speaker-avatar.tsx`),
 * which is a server-rendered component in another module's folder and so
 * cannot carry the piece this surface needs: `headshot_file_id` may point at
 * an asset row that has since been deleted, and M27's edge-case list requires
 * that to fall back to initials rather than show a broken image. `onError`
 * is the only way to learn that on the client, hence the local component.
 *
 * The failure is remembered per file id, not per mount, so a table row that
 * scrolls or paginates into a different speaker re-tries that speaker's photo
 * instead of inheriting the previous one's verdict.
 */
export function SpeakerHeadshot({
  name,
  initials,
  headshotFileId,
  size = "md",
}: {
  name: string;
  initials: string;
  headshotFileId: string | null;
  size?: AvatarSize;
}) {
  const [brokenId, setBrokenId] = useState<string | null>(null);
  const imageUrl = headshotFileId && brokenId !== headshotFileId ? `/f/${headshotFileId}` : null;
  return (
    <Avatar
      initials={initials}
      size={size}
      {...(imageUrl
        ? { imageUrl, imageAlt: name, onImageError: () => setBrokenId(headshotFileId) }
        : {})}
    />
  );
}
