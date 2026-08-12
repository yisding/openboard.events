"use client";

import { useState } from "react";
import { Compass, Sparkles } from "lucide-react";
import { emojiRain } from "./emoji-rain";

// Easter egg on the 404 page: the compass icon spins when clicked, and five
// spins "find true north". A cumulative rotation with a CSS transition (rather
// than a keyframe animation) means every extra click keeps winding it up —
// re-triggering a keyframe from React would need a remount, which would drop
// focus mid-egg.
const SPINS_TO_FIND_NORTH = 5;

export function LostCompass() {
  const [spins, setSpins] = useState(0);
  const found = spins >= SPINS_TO_FIND_NORTH;

  function spin() {
    const next = spins + 1;
    setSpins(next);
    if (next === SPINS_TO_FIND_NORTH) emojiRain(["🧭", "✨", "🗺️"]);
  }

  return (
    <>
      <button type="button" className="empty-icon lost-compass" onClick={spin} aria-label="Spin the compass">
        <span style={{ transform: `rotate(${spins * 540}deg)` }}>
          {found ? <Sparkles size={24} aria-hidden="true" /> : <Compass size={24} aria-hidden="true" />}
        </span>
      </button>
      {found && (
        <p className="lost-compass-note" role="status">
          You found true north. The best hallway tracks start with someone getting a little lost.
        </p>
      )}
    </>
  );
}
