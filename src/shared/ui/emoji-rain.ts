// Shared engine for the app's easter eggs: a short, self-cleaning shower of
// emoji over the whole viewport. Imperative DOM rather than a React portal on
// purpose — callers fire it from event handlers (palette selection, a key
// sequence) and nothing else in the tree needs to re-render or hold state for
// a decoration that removes itself four seconds later.
export function emojiRain(emojis: string[], count = 28) {
  if (typeof document === "undefined") return;
  // The global reduced-motion rule would collapse the fall to .01ms anyway;
  // skip the overlay entirely so the egg degrades to "nothing happens"
  // instead of a flash of emoji.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const overlay = document.createElement("div");
  overlay.className = "egg-rain";
  overlay.setAttribute("aria-hidden", "true");
  for (let i = 0; i < count; i += 1) {
    const drop = document.createElement("span");
    drop.textContent = emojis[i % emojis.length] ?? "✨";
    drop.style.left = `${Math.random() * 100}%`;
    drop.style.animationDelay = `${Math.random() * 1.2}s`;
    drop.style.animationDuration = `${2.2 + Math.random() * 1.6}s`;
    drop.style.fontSize = `${18 + Math.random() * 22}px`;
    overlay.appendChild(drop);
  }
  document.body.appendChild(overlay);
  // Longest possible drop: 1.2s delay + 3.8s fall. The overlay is
  // pointer-events:none, so a slightly generous timeout costs nothing.
  window.setTimeout(() => overlay.remove(), 5200);
}
