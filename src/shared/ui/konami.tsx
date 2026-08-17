"use client";

import { useEffect } from "react";
import { useToast } from "./toast";
import { emojiRain } from "./emoji-rain";

// The classic: ↑ ↑ ↓ ↓ ← → ← → B A, listened for app-wide. Letters are
// lowercased so the egg works with or without caps lock; the arrow prefix
// makes an accidental trigger while typing in a form effectively impossible,
// so there is no need to exclude inputs from the listener.
const CODE = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"] as const;

// Entering the code again is a fan asking for an encore, and an encore that
// repeats the opening number verbatim is a disappointment. Each repeat within
// a page load gets its own celebration, settling on the closer once the set
// list runs out.
const ENCORES = [
  { emojis: ["🕹️", "🎉", "✨", "🎊"], message: "Achievement unlocked: the Konami keynote 🕹️ +30 lives, all of them backstage passes" },
  { emojis: ["👾", "🕹️", "💫", "✨"], message: "An encore! The retro track is officially oversubscribed. +30 more lives 👾" },
  { emojis: ["🏆", "🎮", "🕹️", "✨"], message: "Three shows in one night. That’s not an easter egg anymore — that’s a residency. 🏆" },
] as const;

/** The celebration for the nth trigger (0-based); exported pure for tests. */
export function konamiEncore(timesTriggered: number): { emojis: readonly string[]; message: string } {
  return ENCORES[Math.min(timesTriggered, ENCORES.length - 1)] ?? ENCORES[0];
}

export function KonamiListener() {
  const { toast } = useToast();

  useEffect(() => {
    // A rolling window of the last ten keys, compared whole, instead of a
    // progress counter: a counter mishandles overlapping prefixes (after
    // ↑ ↑ ↑ the attempt is still two steps in, not zero), the window can't.
    let recent: string[] = [];
    let triggered = 0;
    function onKey(event: globalThis.KeyboardEvent) {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      recent = [...recent, key].slice(-CODE.length);
      if (recent.length === CODE.length && CODE.every((step, index) => recent[index] === step)) {
        recent = [];
        const encore = konamiEncore(triggered);
        triggered += 1;
        emojiRain([...encore.emojis]);
        toast(encore.message);
      }
    }
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [toast]);

  return null;
}
