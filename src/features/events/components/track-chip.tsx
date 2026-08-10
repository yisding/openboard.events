import type { TrackDTO } from "@/shared/contracts";

/**
 * The one place a track renders as a colored pill. `null` (no track set) is
 * an expected, designed state — an em dash, never a crash — because the
 * empty "Empty Conf" seed event and any submission routed before a track
 * existed both hit this path constantly.
 */
export function TrackChip({ track }: { track: Pick<TrackDTO, "name" | "color"> | null }) {
  if (!track) return <span className="track-chip track-chip--empty">—</span>;
  return (
    <span className="track-chip">
      <i style={{ background: track.color }} />
      {track.name}
    </span>
  );
}
