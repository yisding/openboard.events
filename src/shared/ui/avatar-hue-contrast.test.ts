import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Placeholder avatars draw their initials in the same custom property that
 * paints the disc, so the pair can only be verified together: the glyph is
 * `color-mix(--avatar-accent 75%, --avatar-ink)` and the darkest ground it
 * lands on is `color-mix(--avatar-accent 18%, --surface)`. A hue added to the
 * palette without checking that pair ships 12px semibold text at ~3.6:1, which
 * is what the raw accent measures on its own tint.
 *
 * Both inputs are resolved per shell rather than read straight out of `:root`,
 * because a scoped remap can move one of them without the other: the dark
 * embed remaps `--ink` to the near-white `--fill` and leaves `--surface` white,
 * which is exactly how the glyph once fell to 2.9:1 there while this file still
 * reported the light shell's 5.7:1.
 */

type Rgb = [number, number, number];

const stylesheet = readFileSync(`${process.cwd()}/src/app/globals.css`, "utf8");

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8});`).exec(stylesheet);
  if (!match?.[1]) throw new Error(`Missing token --${name} in globals.css`);
  return match[1];
}

/** The `.embed-shell.embed-dark` token remaps, as declared -> raw value. */
const embedDarkRemaps = new RegExp("\\.embed-shell\\.embed-dark\\s*\\{([^}]*--[^}]*)\\}", "g");

function embedDarkToken(name: string): string {
  for (const block of stylesheet.matchAll(embedDarkRemaps)) {
    const declared = new RegExp(`--${name}:\\s*([^;}]+)`).exec(block[1] ?? "")?.[1]?.trim();
    if (!declared) continue;
    const alias = /^var\(\s*--([\w-]+)\s*\)$/.exec(declared);
    return alias?.[1] ? token(alias[1]) : declared;
  }
  return token(name);
}

function rgb(hex: string): Rgb {
  const value = hex.slice(1);
  const full = value.length === 3 ? [...value].map((digit) => digit + digit).join("") : value;
  return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16)) as Rgb;
}

/** `color-mix(in srgb, a p%, b)` — sRGB mixing happens on the encoded values. */
function mix(a: Rgb, b: Rgb, portion: number): Rgb {
  return a.map((channel, index) => Math.round(channel * portion + (b[index] ?? 0) * (1 - portion))) as Rgb;
}

function luminance([red, green, blue]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrast(foreground: Rgb, background: Rgb): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

describe("placeholder avatar hues", () => {
  const hues = [...Array.from({ length: 10 }, (_, index) => `avatar-hue-${index + 1}`), "accent-dark"];
  const shells = [
    { name: "light shell", resolve: token },
    { name: "dark embed", resolve: embedDarkToken },
  ];

  it.each(shells.flatMap((shell) => hues.map((hue) => [hue, shell.name, shell.resolve] as const)))(
    "keeps %s initials readable on their own tint in the %s",
    (name, _shell, resolve) => {
      const hue = rgb(resolve(name));
      const glyph = mix(hue, rgb(resolve("avatar-ink")), 0.75);
      const darkestStop = mix(hue, rgb(resolve("surface")), 0.18);
      expect(contrast(glyph, darkestStop)).toBeGreaterThanOrEqual(4.5);
    },
  );

  // Without this the dark-embed cases above could pass by resolving every
  // token from :root, which is the shell they are there to stop trusting.
  it("reads the dark embed's own token remaps", () => {
    expect(embedDarkToken("ink")).toBe(token("fill"));
    expect(embedDarkToken("avatar-ink")).toBe(token("avatar-ink"));
  });

  // On the public site and the embed, `--accent-dark` is not a token at all:
  // `public-event-shell.tsx` writes the organizer's brand colour into it as an
  // inline style. `accentTextShade()` only proves that colour reads as text on
  // white, which is a different measurement from the glyph-on-its-own-tint pair
  // above — a brand accent that passes as text can land at 3.6:1 here. So the
  // two branded shells pin the initials to a hue this file actually checks.
  it("keeps branded shells off the organizer's accent for placeholder initials", () => {
    const rule = /\.public-event \.person-avatar-placeholder, \.embed-shell \.person-avatar-placeholder \{([^}]*)\}/.exec(stylesheet)?.[1];
    expect(rule).toBeDefined();
    const pinned = /--avatar-accent:\s*var\(\s*--([\w-]+)\s*\)/.exec(rule ?? "")?.[1];
    expect(pinned).toBeDefined();
    expect(hues).toContain(pinned);
    expect(pinned).not.toBe("accent-dark");
  });

  it("keeps the seeded portal palette on tokens rather than raw hex", () => {
    const shell = readFileSync(`${process.cwd()}/src/features/portal/server/shell.ts`, "utf8");
    const palette = /const AVATAR_COLORS = \[([\s\S]*?)\] as const;/.exec(shell)?.[1] ?? "";
    expect(palette).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect([...palette.matchAll(/--avatar-hue-\d+/g)]).toHaveLength(10);
  });
});
