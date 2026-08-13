import { expect, test, type Page } from "@playwright/test";
import { BASE_URL, NO_TARGET, targetConfigured } from "./helpers/env";

type Geometry = {
  cardLeft: number;
  cardRight: number;
  cardWidth: number;
  cardScrollWidth: number;
  actionLeft: number;
  actionRight: number;
  controls: Array<{ left: number; right: number; width: number }>;
};

async function geometry(page: Page, cardId: string, actionsId: string): Promise<Geometry> {
  return page.evaluate(({ cardSelector, actionSelector }) => {
    const cardElement = document.querySelector(cardSelector);
    const actionElement = document.querySelector(actionSelector);
    if (!(cardElement instanceof HTMLElement) || !(actionElement instanceof HTMLElement)) {
      throw new Error(`Missing responsive fixture: ${cardSelector} / ${actionSelector}`);
    }
    const cardBox = cardElement.getBoundingClientRect();
    const actionBox = actionElement.getBoundingClientRect();
    return {
      cardLeft: cardBox.left,
      cardRight: cardBox.right,
      cardWidth: cardElement.clientWidth,
      cardScrollWidth: cardElement.scrollWidth,
      actionLeft: actionBox.left,
      actionRight: actionBox.right,
      controls: [...actionElement.querySelectorAll("button, a")].map((control) => {
        const box = control.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width };
      }),
    };
  }, { cardSelector: `#${cardId}`, actionSelector: `#${actionsId}` });
}

test.describe("responsive action groups", () => {
  test.skip(!targetConfigured(), NO_TARGET);

  test("keeps form and CRM card actions inside narrow cards", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE_URL, javaScriptEnabled: false, viewport: { width: 320, height: 900 } });
    const page = await context.newPage();
    await page.goto("/kitchen-sink", { waitUntil: "domcontentloaded" });
    const styles = await page.locator("link[rel='stylesheet'], style").evaluateAll((nodes) => nodes.map((node) => node.outerHTML).join("\n"));
    expect(styles.length).toBeGreaterThan(0);
    await page.setContent(`<!doctype html><html><head>${styles}</head><body><main style="width:100%;padding:12px">
        <article class="form-list-card" id="responsive-form-card">
          <div class="form-list-icon"></div>
          <div class="form-list-main"><h2>Call for speakers</h2><p>A form with several useful actions</p></div>
          <div class="form-list-actions" id="responsive-form-actions">
            <a class="button button-secondary" href="#">Preview</a>
            <button class="button button-secondary">Duplicate as draft</button>
            <a class="button button-secondary" href="#">Edit form</a>
          </div>
        </article>
        <article class="crm-segment-card" id="responsive-segment-card">
          <header>
            <div><h3>Potential workshop speakers</h3><p>Every contact with workshop experience across prior events</p></div>
            <div class="crm-segment-card-actions" id="responsive-segment-actions">
              <button class="button button-secondary button-sm">View members</button>
              <button class="button button-sm">Email segment</button>
            </div>
          </header>
        </article>
      </main></body></html>`, { waitUntil: "networkidle" });

    for (const [cardId, actionsId] of [
      ["responsive-form-card", "responsive-form-actions"],
      ["responsive-segment-card", "responsive-segment-actions"],
    ] as const) {
      const card = page.locator(`#${cardId}`);
      const actions = page.locator(`#${actionsId}`);
      await expect(card).toBeVisible();
      await expect(actions.locator("button, a")).toHaveCount(cardId.includes("form") ? 3 : 2);

      const box = await geometry(page, cardId, actionsId);
      expect(box.cardScrollWidth).toBeLessThanOrEqual(box.cardWidth);
      expect(box.actionLeft).toBeGreaterThanOrEqual(box.cardLeft);
      expect(box.actionRight).toBeLessThanOrEqual(box.cardRight);
      expect(box.controls.every((control) => control.width > 0 && control.left >= box.cardLeft && control.right <= box.cardRight)).toBe(true);
    }
    await context.close();
  });
});
