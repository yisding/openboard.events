"use client";

import React, { createContext, useContext } from "react";

const FormUploadEventContext = createContext<string | null>(null);

/**
 * Keeps the frozen FormFieldRenderer props independent of any one feature while
 * still giving file fields the event scope required by the upload API.
 */
export function FormUploadProvider({ eventId, children }: { eventId: string; children?: React.ReactNode }) {
  return <FormUploadEventContext.Provider value={eventId}>{children}</FormUploadEventContext.Provider>;
}

export function useFormUploadEventId(): string | null {
  return useContext(FormUploadEventContext);
}
