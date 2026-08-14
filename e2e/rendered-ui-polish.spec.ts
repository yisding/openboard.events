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

test.describe("self-service auth readability", () => {
  test.skip(!targetConfigured(), NO_TARGET);
  test.use({ viewport: { width: 320, height: 700 } });

  test("wraps long signup addresses and gives explanatory copy readable rhythm", async ({ page }) => {
    const email = "very.long.organizer.address+signup@example.com";
    await page.goto(`/signup/check-email?email=${encodeURIComponent(email)}&next=%2Forganizations`);

    const address = page.getByText(email, { exact: true });
    const intro = address.locator("..");
    await expect(intro).toBeVisible();
    const layout = await intro.evaluate((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        lineHeightRatio: Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize),
        right: box.right,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(layout.lineHeightRatio).toBeGreaterThanOrEqual(1.4);
    expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);

    const resendHint = page.getByText("A new link can only be sent to the address used to create this account.", { exact: true });
    const hintStyle = await resendHint.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        lineHeightRatio: Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize),
      };
    });
    expect(hintStyle.lineHeightRatio).toBeGreaterThanOrEqual(1.4);
    expect(hintStyle.color).toBe(await intro.evaluate((element) => getComputedStyle(element).color));

    await page.goto("/signup/verified?error=invalid&next=%2Forganizations");
    const invalidLinkCopy = page.getByText("The confirmation link may be expired or invalid. Enter your email and we will send a fresh one.", { exact: true });
    const invalidCopyRatio = await invalidLinkCopy.evaluate((element) => {
      const style = getComputedStyle(element);
      return Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize);
    });
    expect(invalidCopyRatio).toBeGreaterThanOrEqual(1.4);
  });
});

test.describe("shared primitives inside feature hosts", () => {
  test.skip(!targetConfigured(), NO_TARGET);
  test.use({ viewport: { width: 1280, height: 900 } });

  test("keeps host selectors from overriding primitive layout and variants", async ({ page }) => {
    await page.goto("/kitchen-sink", { waitUntil: "domcontentloaded" });
    const styles = await page.locator("link[rel='stylesheet'], style").evaluateAll((nodes) => nodes.map((node) => node.outerHTML).join("\n"));
    expect(styles.length).toBeGreaterThan(0);

    await page.setContent(`<!doctype html><html><head>${styles}</head><body>
      <main>
        <table class="dashboard-recent"><tbody><tr><td>
          <span class="status-badge status-open" id="hosted-badge"><i></i>open</span>
        </td></tr></tbody></table>
        <div class="admin-task-progress">
          <div class="admin-task-progress-copy"><b>2/4</b><span>50%</span></div>
          <div class="progress-track" id="task-progress" role="progressbar"><i style="width:50%"></i></div>
        </div>
        <article class="review-progress-card">
          <div class="review-progress-copy"><span>Your progress</span><b>Finished 2 of 4</b></div>
          <div class="progress-track" id="review-progress" role="progressbar"><i style="width:50%"></i></div>
        </article>
        <div class="form-render">
          <label class="field" id="rich-field"><span>Biography</span><div class="rich-editor"><p><strong id="field-prose">Formatted emphasis</strong></p></div></label>
          <label class="field"><span>Name</span><strong role="alert" id="dynamic-error">Required</strong></label>
        </div>
        <button class="button button-primary button-sm" id="reference-primary">Reference primary</button>
        <button class="button button-secondary button-sm" id="reference-secondary">Reference secondary</button>
        <div class="accepted-tray"><div class="accepted-tray-actions">
          <button class="button button-secondary button-sm" id="hosted-secondary">Select all</button>
          <button class="button button-primary button-sm" id="hosted-primary">Add 2</button>
        </div></div>
      </main>
    </body></html>`, { waitUntil: "networkidle" });

    const computed = await page.evaluate(() => {
      const style = (id: string) => {
        const element = document.getElementById(id);
        if (!element) throw new Error(`Missing primitive fixture: ${id}`);
        return getComputedStyle(element);
      };
      const snapshot = (id: string) => {
        const value = style(id);
        return {
          alignItems: value.alignItems,
          backgroundColor: value.backgroundColor,
          borderColor: value.borderColor,
          color: value.color,
          display: value.display,
          height: value.height,
        };
      };
      return {
        badge: snapshot("hosted-badge"),
        taskProgress: snapshot("task-progress"),
        reviewProgress: snapshot("review-progress"),
        field: snapshot("rich-field"),
        prose: snapshot("field-prose"),
        error: snapshot("dynamic-error"),
        referencePrimary: snapshot("reference-primary"),
        referenceSecondary: snapshot("reference-secondary"),
        hostedPrimary: snapshot("hosted-primary"),
        hostedSecondary: snapshot("hosted-secondary"),
      };
    });

    expect(computed.badge).toMatchObject({ display: "inline-flex", alignItems: "center", height: "23px" });
    expect(computed.taskProgress).toMatchObject({ display: "block", height: "5px" });
    expect(computed.reviewProgress).toMatchObject({ display: "block", height: "5px" });
    expect(computed.prose).toMatchObject({ display: "inline", color: computed.field.color });
    expect(computed.error.display).toBe("block");
    expect(computed.error.color).not.toBe(computed.field.color);
    for (const [hosted, reference] of [
      [computed.hostedPrimary, computed.referencePrimary],
      [computed.hostedSecondary, computed.referenceSecondary],
    ] as const) {
      expect(["flex", "inline-flex"]).toContain(hosted.display);
      expect(hosted).toMatchObject({
        alignItems: reference.alignItems,
        backgroundColor: reference.backgroundColor,
        borderColor: reference.borderColor,
        color: reference.color,
        height: reference.height,
      });
    }
  });
});
