"use client";

import dynamic from "next/dynamic";
import { forwardRef, type ForwardedRef } from "react";
import type { RichTextEditorHandle, RichTextEditorProps } from "./rich-text-editor";

/**
 * What every consumer imports. `ssr: false` is the whole point: TipTap and
 * ProseMirror never enter the server graph, so they cannot move the compressed
 * Worker artifact that the Free plan's 3 MB limit applies to. `scripts/check-client-bundle.sh`
 * measures the browser side separately, because they are different artifacts and
 * must never share a threshold.
 */
export type { RichTextEditorHandle, RichTextEditorProps } from "./rich-text-editor";

type DynamicEditorProps = RichTextEditorProps & {
  forwardedRef?: ForwardedRef<RichTextEditorHandle>;
};

// `next/dynamic` uses its React ref for the loadable component's retry handle,
// so pass the editor ref as an ordinary prop across that boundary and attach it
// only after the browser-only module has loaded.
const DynamicRichTextEditor = dynamic<DynamicEditorProps>(
  () => import("./rich-text-editor").then(({ RichTextEditor: LoadedEditor }) => {
    function LoadedRichTextEditor({ forwardedRef, ...props }: DynamicEditorProps) {
      return <LoadedEditor {...props} ref={forwardedRef} />;
    }
    return LoadedRichTextEditor;
  }),
  { ssr: false, loading: () => <div className="rich-text-editor rich-text-editor--loading" aria-busy="true" /> },
);

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor(props, ref) {
  return <DynamicRichTextEditor {...props} forwardedRef={ref} />;
});
