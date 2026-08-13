import { RichPrimitives } from "@/features/shell/rich-primitives";

export const metadata = { title: "Rich primitives" };

/**
 * The rich half of the kitchen sink. `<FileUpload>` here talks to the real
 * presign and finalize endpoints, so this page is also the quickest way to
 * exercise the R2 round-trip from a browser — which is the only place CORS is
 * genuinely proven.
 */
export default function RichKitchenSinkPage() {
  return <RichPrimitives />;
}
