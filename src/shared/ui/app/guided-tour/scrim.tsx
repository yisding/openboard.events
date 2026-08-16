"use client";

import { useEffect, useId, useRef, type CSSProperties } from "react";
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
 *
 * The easing is suspended while the page is moving, which is the difference
 * between a spotlight and a smear. The rectangle is re-measured every frame of
 * a scroll, and each measurement restarted a 220 ms transition from wherever
 * the hole had got to — so the cutout trailed several hundred milliseconds
 * behind the control it was framing and slid into place long after the scroll
 * had stopped. Measured on the tour's own `scrollIntoView`: the anchor moved
 * 73px in three frames and the hole took eleven more to catch up. Now the
 * transition only ever animates a step-to-step *jump*, which is the case it
 * was written for.
 */

/** Breathing room around the highlighted control, in CSS pixels. */
const PADDING = 8;
const RADIUS = 12;

/** How long after the last scroll or resize the glide is allowed back. */
const TRACKING_SETTLE_MS = 120;

export function TourScrim({ rect }: { rect: TourRect | null }) {
  const maskId = useId();
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Imperative on purpose: the whole point is to change nothing about what
  // React renders, so a scroll cannot cost a re-render of the card as well.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let timer = 0;
    const tracking = () => {
      svgRef.current?.classList.remove("tour-scrim-gliding");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => svgRef.current?.classList.add("tour-scrim-gliding"), TRACKING_SETTLE_MS);
    };
    // Capture, so a scroll inside any pane counts — the admin shell scrolls its
    // content region, not the document.
    window.addEventListener("scroll", tracking, true);
    window.addEventListener("resize", tracking);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", tracking, true);
      window.removeEventListener("resize", tracking);
    };
  }, []);

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
    <svg ref={svgRef} className="tour-scrim tour-scrim-gliding" aria-hidden="true" width="100%" height="100%" style={geometry}>
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
