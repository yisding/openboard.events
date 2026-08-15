import { describe, expect, it } from "vitest";
import { deviceLabel } from "./device-label";

describe("deviceLabel", () => {
  it("names the browser and platform instead of printing the user agent", () => {
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"))
      .toBe("Chrome on Mac");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1"))
      .toBe("Safari on iPhone");
    expect(deviceLabel("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36"))
      .toBe("Headless Chrome on Linux");
  });

  it("prefers the real browser over the compatibility tokens it also claims", () => {
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0"))
      .toBe("Edge on Windows");
    expect(deviceLabel("Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0"))
      .toBe("Firefox on Android");
  });

  it("falls back to the product token for non-browser clients, and to a plain label for nothing at all", () => {
    expect(deviceLabel("curl/8.21.0")).toBe("curl");
    expect(deviceLabel(null)).toBe("Unknown device");
    expect(deviceLabel("   ")).toBe("Unknown device");
  });
});
