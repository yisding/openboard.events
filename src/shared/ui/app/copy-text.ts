export type ClipboardWriter = { writeText: (text: string) => Promise<void> };
export type CopyFallback = (text: string) => boolean;

function copyWithSelection(text: string): boolean {
  if (typeof document === "undefined" || !document.body) return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

/** Clipboard API first, selection-based fallback second, truthful result. */
export async function copyText(
  text: string,
  clipboard: ClipboardWriter | null = typeof navigator === "undefined" ? null : navigator.clipboard,
  fallback: CopyFallback = copyWithSelection,
): Promise<boolean> {
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Older browsers and denied clipboard permissions can still use the
      // synchronous selection fallback below.
    }
  }

  try {
    return fallback(text);
  } catch {
    return false;
  }
}
