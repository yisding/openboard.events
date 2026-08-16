"use client";

import { useId, type CSSProperties } from "react";
import type { TourRect } from "./anchor";

/**
 * The spotlight: one `pointer-events: none` SVG with a real hole in it.
 *
 * That single property is the whole difference between a tutorial and a
 * screenshot tour. The player clicks the actual control, through the hole, in
 * the actual product — and can just as easily click something else, because a
 * spotlight directs attention rather than imprisoning it.
 *
 * The hole's geometry is published twice on purpose: as presentation
 * attributes, which every renderer understands, and as custom properties the
 * stylesheet turns into SVG2 geometry properties so the cutout glides between
 * steps. Where CSS geometry is supported the transition wins; where it is not,
 * the attributes still draw the correct hole. The failure mode of publishing
 * only the CSS would be an undimmed page at best and a fully black one at
 * worst, which is not a trade worth 220 ms of easing.
 */

/** Breathing room around the highlighted control, in CSS pixels. */
const PADDING = 8;
const RADIUS = 12;

export function TourScrim({ rect }: { rect: TourRect | null }) {
  const maskId = useId();
  if (!rect) return null;
  const x = Math.round(rect.left - PADDING);
  const y = Math.round(rect.top - PADDING);
  const width = Math.round(rect.width + PADDING * 2);
  const height = Math.round(rect.height + PADDING * 2);
  const geometry = {
    "--tour-hole-x": `${x}px`,
    "--tour-hole-y": `${y}px`,
    "--tour-hole-w": `${width}px`,
    "--tour-hole-h": `${height}px`,
  } as CSSProperties;
  return (
    <svg className="tour-scrim" aria-hidden="true" width="100%" height="100%" style={geometry}>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse">
          {/* Mask channels, not design colours: white keeps, black cuts. */}
          <rect x="0" y="0" width="100%" height="100%" fill="#fff" />
          <rect className="tour-scrim-hole" x={x} y={y} width={width} height={height} rx={RADIUS} fill="#000" />
        </mask>
      </defs>
      <rect className="tour-scrim-ground" x="0" y="0" width="100%" height="100%" mask={`url(#${maskId})`} />
      <rect className="tour-scrim-ring" x={x} y={y} width={width} height={height} rx={RADIUS} />
    </svg>
  );
}
