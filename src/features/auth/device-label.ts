/**
 * A readable name for the device behind a session row.
 *
 * The user-agent string is an identifier, not an answer to "is this the laptop
 * I left at the office?" — and two sign-ins from the same browser print the
 * same 120 characters, which is precisely the case where someone has to decide
 * which one to end. This keeps the browser and platform the string actually
 * carries and leaves the rest off screen.
 *
 * Order matters in both tables: every Chromium browser still claims `Safari`,
 * Edge and Opera still claim `Chrome`, and iOS Chrome/Firefox announce
 * themselves as `CriOS`/`FxiOS`. First match wins, most specific first.
 */
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\//, "Opera"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bHeadlessChrome\//, "Headless Chrome"],
  [/\bChrome\/|\bCriOS\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

const PLATFORMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "Mac"],
  [/\bLinux\b/, "Linux"],
];

function firstMatch(userAgent: string, table: ReadonlyArray<readonly [RegExp, string]>): string | null {
  return table.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
}

export function deviceLabel(userAgent: string | null): string {
  const value = userAgent?.trim() ?? "";
  if (value === "") return "Unknown device";
  const browser = firstMatch(value, BROWSERS);
  const platform = firstMatch(value, PLATFORMS);
  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;
  // Not a browser at all — a script or a CLI signing in with an API client.
  // Its product token ("curl/8.21.0") is the honest name for it; the version
  // is noise nobody is deciding on.
  return /^([\w.-]+)\//.exec(value)?.[1] ?? "Unknown device";
}
