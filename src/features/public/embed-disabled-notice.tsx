// Rendered inside the embed shell when an organizer has flipped a content
// type's kill switch off. The page around this still returns HTTP 200 — a
// live host page's iframe should show a calm inert message, not a browser
// error page (M33 work order Step 3).
export function EmbedDisabledNotice({ label }: { label: string }) {
  return (
    <div className="embed-disabled-notice">
      <p>This {label} is not currently available.</p>
    </div>
  );
}
