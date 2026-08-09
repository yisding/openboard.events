"use client";

import dynamic from "next/dynamic";

/**
 * What every consumer imports. `ssr: false` is the whole point: TipTap and
 * ProseMirror never enter the server graph, so they cannot move the compressed
 * Worker artifact that the Free plan's 3 MB limit applies to. `scripts/check-client-bundle.sh`
 * measures the browser side separately, because they are different artifacts and
 * must never share a threshold.
 */
export const RichTextEditor = dynamic(
  () => import("./rich-text-editor").then((module) => module.RichTextEditor),
  { ssr: false, loading: () => <div className="rich-text-editor rich-text-editor--loading" aria-busy="true" /> },
);
