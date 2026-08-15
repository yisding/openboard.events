"use client";

import { useEffect } from "react";

// Easter egg for the crew: a one-time greeting for whoever opens devtools.
// Organizers run stage productions; the console is our backstage, and anyone
// curious enough to look deserves a hello — and a breadcrumb to the next egg.
// The module flag keeps StrictMode's doubled effect (and any remount) from
// repeating the greeting within a page load.
let greeted = false;

export function ConsoleGreeting() {
  useEffect(() => {
    if (greeted) return;
    greeted = true;
    console.info(
      "%c Openboard %c backstage pass %c\n\nEvery great event has a crew that peeks behind the curtain. Hello, crew. 👋\nThe stage out front still answers to ↑ ↑ ↓ ↓ ← → ← → B A.\nMore footnotes for people like you: /humans.txt",
      "background:#00a878;color:#fff;font-weight:700;padding:3px 8px;border-radius:6px 0 0 6px;",
      "background:#1f2937;color:#fff;padding:3px 8px;border-radius:0 6px 6px 0;",
      "font-weight:400;",
    );
  }, []);

  return null;
}
