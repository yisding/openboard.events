import { expect, test, type Locator } from "@playwright/test";
import { NO_TARGET, targetConfigured } from "./helpers/env";

async function contrastRatio(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (value: string) => {
      const [red = 0, green = 0, blue = 0] = rgb(value).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const tile = element.closest(".stat-tile");
    if (!tile) throw new Error("Tone label must belong to a stat tile");
    const foreground = luminance(getComputedStyle(element).color);
    const background = luminance(getComputedStyle(tile).backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
}

test.describe("rendered UI polish", () => {
  test.skip(!targetConfigured(), NO_TARGET);
  test.use({ viewport: { width: 390, height: 900 } });

  test("keeps compact controls named, titles concise, and tone labels legible", async ({ page }) => {
    await page.goto("/kitchen-sink");
    await expect(page).toHaveTitle("Kitchen sink · Openboard");
    await expect(page.getByRole("button", { name: "Search anything" })).toBeVisible();

    await page.goto("/kitchen-sink/rich");
    await expect(page).toHaveTitle("Rich primitives · Openboard");
    expect(await contrastRatio(page.locator(".stat-tile--warning .stat-tile__label"))).toBeGreaterThanOrEqual(4.5);
    expect(await contrastRatio(page.locator(".stat-tile--danger .stat-tile__label"))).toBeGreaterThanOrEqual(4.5);
  });
});
