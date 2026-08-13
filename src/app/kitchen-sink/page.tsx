import { KitchenSink } from "@/features/shell/kitchen-sink";

export const metadata = { title: "Kitchen sink" };

/**
 * Every core primitive on one page, against a fixture. It exists so a behaviour
 * can be checked without navigating to the feature that happens to use it — and
 * so the three table edge cases (pager clamping, dashes, nulls-last sorting) are
 * visible rather than described.
 */
export default function KitchenSinkPage() {
  return <KitchenSink />;
}
