import { expect, test, type Locator } from "@playwright/test";
import { NO_TARGET, targetConfigured } from "./helpers/env";

async function weight(locator: Locator): Promise<number> {
  return locator.evaluate((element) => Number.parseInt(getComputedStyle(element).fontWeight, 10));
}

test.describe("typography hierarchy", () => {
  test.skip(!targetConfigured(), NO_TARGET);
  test.use({ viewport: { width: 1280, height: 900 } });

  test("uses calm text and control weights while reserving strong weight for visual anchors", async ({ page }) => {
    await page.goto("/kitchen-sink");

    await expect(page.getByRole("heading", { name: "Kitchen sink" })).toBeVisible();
    expect(await weight(page.getByRole("heading", { name: "Kitchen sink" }))).toBe(600);
    expect(await weight(page.getByRole("heading", { name: "Status badges" }))).toBe(600);
    expect(await weight(page.getByRole("button", { name: "Show a 409" }))).toBe(550);
    expect(await weight(page.locator(".status-badge").first())).toBe(550);
    expect(await weight(page.locator(".data-table th").filter({ hasText: "Code" }))).toBe(550);
    expect(await weight(page.locator(".submission-title-cell b").first())).toBe(600);
    expect(await weight(page.locator(".person-avatar").first())).toBe(700);

    await page.goto("/kitchen-sink/rich");
    const trackField = page.locator(".field", { hasText: "Track" }).filter({ has: page.locator("select") }).first();
    await expect(trackField).toBeVisible();
    expect(await weight(trackField.locator(":scope > span"))).toBe(550);
    expect(await weight(trackField.locator("select"))).toBe(400);
    expect(await weight(page.locator(".stat-tile__value").first())).toBe(700);
  });
});
