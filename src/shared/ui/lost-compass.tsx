"use client";

import { useState } from "react";
import { Compass, Sparkles, Star } from "lucide-react";
import { emojiRain } from "./emoji-rain";

// Easter egg on the 404 page: the compass icon spins when clicked, and five
// spins "find true north". A cumulative rotation with a CSS transition (rather
// than a keyframe animation) means every extra click keeps winding it up —
// re-triggering a keyframe from React would need a remount, which would drop
// focus mid-egg.
//
// Second act: whoever keeps spinning after finding north deserves more than
// silence, so five further spins find it *again* — a reward for the kind of
// persistence that also reads /humans.txt (which points here).
const SPINS_TO_FIND_NORTH = 5;
const SPINS_TO_FIND_IT_TWICE = 10;

export type CompassStage = "wandering" | "found" | "legend";

/** Which act of the egg a spin count has reached; exported pure for tests. */
export function compassStage(spins: number): CompassStage {
  if (spins >= SPINS_TO_FIND_IT_TWICE) return "legend";
  if (spins >= SPINS_TO_FIND_NORTH) return "found";
  return "wandering";
}

const NOTES: Record<Exclude<CompassStage, "wandering">, string> = {
  found: "You found true north. The best hallway tracks start with someone getting a little lost.",
  legend: "True north, found twice. Cartographers say that's impossible. Hallway tracks are built on it.",
};

const STAGE_ICON: Record<CompassStage, typeof Compass> = {
  wandering: Compass,
  found: Sparkles,
  legend: Star,
};

export function LostCompass() {
  const [spins, setSpins] = useState(0);
  const stage = compassStage(spins);

  function spin() {
    const next = spins + 1;
    setSpins(next);
    if (next === SPINS_TO_FIND_NORTH) emojiRain(["🧭", "✨", "🗺️"]);
    if (next === SPINS_TO_FIND_IT_TWICE) emojiRain(["⭐", "🧭", "🗺️", "✨"]);
  }

  const Icon = STAGE_ICON[stage];
  return (
    <>
      <button type="button" className="empty-icon lost-compass" onClick={spin} aria-label="Spin the compass">
        <span style={{ transform: `rotate(${spins * 540}deg)` }}>
          <Icon size={24} aria-hidden="true" />
        </span>
      </button>
      {stage !== "wandering" && (
        <p className="lost-compass-note" role="status">
          {NOTES[stage]}
        </p>
      )}
    </>
  );
}
