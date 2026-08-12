"use client";

import { useEffect } from "react";
import { useToast } from "./toast";
import { emojiRain } from "./emoji-rain";

// The classic: ↑ ↑ ↓ ↓ ← → ← → B A, listened for app-wide. Letters are
// lowercased so the egg works with or without caps lock; the arrow prefix
// makes an accidental trigger while typing in a form effectively impossible,
// so there is no need to exclude inputs from the listener.
const CODE = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"] as const;

export function KonamiListener() {
  const { toast } = useToast();

  useEffect(() => {
    // A rolling window of the last ten keys, compared whole, instead of a
    // progress counter: a counter mishandles overlapping prefixes (after
    // ↑ ↑ ↑ the attempt is still two steps in, not zero), the window can't.
    let recent: string[] = [];
    function onKey(event: globalThis.KeyboardEvent) {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      recent = [...recent, key].slice(-CODE.length);
      if (recent.length === CODE.length && CODE.every((step, index) => recent[index] === step)) {
        recent = [];
        emojiRain(["🕹️", "🎉", "✨", "🎊"]);
        toast("Achievement unlocked: the Konami keynote 🕹️ +30 lives, all of them backstage passes");
      }
    }
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [toast]);

  return null;
}
