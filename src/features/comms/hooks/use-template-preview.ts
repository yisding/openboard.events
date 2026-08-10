"use client";

import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import type { EventId, TemplateKey } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";

const previewResponseSchema = z.object({ subject: z.string(), html: z.string(), text: z.string() });

/** Backs the Templates tab's live preview panel (step 3). See the preview route's docstring for why this is a round-trip rather than an in-browser import of the renderer. */
export function useTemplatePreview(eventId: EventId) {
  return useMutation({
    mutationFn: (input: { key: TemplateKey; subject: string; bodyHtml: string }) =>
      api(`comms/${eventId}/preview`, previewResponseSchema, { method: "POST", body: input }),
  });
}
