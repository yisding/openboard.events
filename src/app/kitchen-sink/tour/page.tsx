import { TourHarness } from "@/features/shell/tour-harness";

export const metadata = { title: "Guided tour" };

/**
 * The guided tour engine on its own, driven by a fixture script and an
 * in-memory transport. It is the fastest way to check the awkward parts by
 * hand — the spotlight tracking an anchor across a scroll, the coach
 * portalling into a native dialog, the card degrading to the centre when an
 * anchor never mounts, and the whole layer going still under
 * `prefers-reduced-motion`.
 */
export default function GuidedTourKitchenSinkPage() {
  return <TourHarness />;
}
