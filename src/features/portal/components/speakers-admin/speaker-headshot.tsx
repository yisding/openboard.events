"use client";

import Image from "next/image";
import { useState } from "react";
import { Avatar } from "@/shared/ui/ui-kit";

const SIZE_PX = { sm: 27, md: 34, lg: 44, xl: 72 } as const;

type Size = keyof typeof SIZE_PX;

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
  size?: Size;
}) {
  const [brokenId, setBrokenId] = useState<string | null>(null);

  if (!headshotFileId || brokenId === headshotFileId) return <Avatar initials={initials} size={size} />;

  const px = SIZE_PX[size];
  return (
    <Image
      // Our own immutable-cached route, not a remote host — optimizing an
      // already-cache-perfect asset buys nothing, same `unoptimized`
      // convention as the portal profile photo and the public gallery.
      src={`/f/${headshotFileId}`}
      alt={name}
      width={px}
      height={px}
      className={`person-avatar person-avatar-${size}`}
      style={{ objectFit: "cover" }}
      unoptimized
      onError={() => setBrokenId(headshotFileId)}
    />
  );
}
