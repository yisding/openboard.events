import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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

test.describe("guided onboarding responsiveness", () => {
  test.use({ viewport: { width: 600, height: 800 } });

  test("keeps every setup step named at tablet width without horizontal overflow", async ({ page }) => {
    const styles = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");

    await page.setContent(`<!doctype html><html><head><style>${styles}</style></head><body>
      <main style="padding:32px 16px">
        <div class="panel settings-section onboarding-wizard" style="margin:auto">
          <ol class="cfp-progress onboarding-progress" aria-label="Setup progress">
            <li class="active"><span>1</span><b>Event details</b></li>
            <li><span>2</span><b>Tracks</b></li>
            <li><span>3</span><b>First form</b></li>
            <li><span>4</span><b>Share</b></li>
          </ol>
        </div>
      </main>
    </body></html>`, { waitUntil: "networkidle" });

    const progress = page.getByRole("list", { name: "Setup progress" });
    const labels = progress.locator("b");
    await expect(labels).toHaveCount(4);
    for (const label of await labels.all()) await expect(label).toBeVisible();

    const layout = await progress.evaluate((element) => {
      const progressBox = element.getBoundingClientRect();
      const labelBoxes = [...element.querySelectorAll("b")].map((label) => label.getBoundingClientRect());
      return {
        labelsFit: labelBoxes.every((box) => box.left >= progressBox.left && box.right <= progressBox.right),
        documentScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(layout.labelsFit).toBe(true);
    expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  });

  test("keeps the disclosure and publish row comfortably tappable on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    const styles = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");

    await page.setContent(`<!doctype html><html><head><style>${styles}</style></head><body>
      <main style="padding:24px">
        <div class="panel settings-section onboarding-wizard">
          <details class="onboarding-advanced">
            <summary>Customize public URL</summary>
          </details>
          <label class="onboarding-toggle">
            <input type="checkbox" checked>
            Publish immediately so the link is shareable right away
          </label>
        </div>
      </main>
    </body></html>`);

    const disclosure = page.getByText("Customize public URL", { exact: true });
    const publishRow = page.getByText("Publish immediately so the link is shareable right away", { exact: true });
    await expect(disclosure).toBeVisible();
    await expect(publishRow).toBeVisible();
    expect((await disclosure.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect((await publishRow.boundingBox())?.height).toBeGreaterThanOrEqual(44);

    const publishAlignment = await publishRow.evaluate((element) => {
      const input = element.querySelector("input");
      if (!input) throw new Error("Publish fixture is incomplete");
      const rowBox = element.getBoundingClientRect();
      const inputBox = input.getBoundingClientRect();
      return Math.abs((rowBox.top + rowBox.bottom - inputBox.top - inputBox.bottom) / 2);
    });
    expect(publishAlignment).toBeLessThanOrEqual(1);
  });

  test("wraps completion actions before they overflow the tablet wizard", async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 800 });
    const styles = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    await page.setContent(`<!doctype html><html><head><style>${styles}</style></head><body>
      <main style="padding:32px 16px">
        <div class="panel settings-section onboarding-wizard" style="margin:auto">
          <div class="cfp-step onboarding-done">
            <footer class="cfp-actions">
              <a class="button button-secondary" href="#">Manage form</a>
              <a class="button button-secondary" href="#">Preview form</a>
              <a class="button button-secondary" href="#">Open live form</a>
              <a class="button button-primary" href="#">Open dashboard</a>
            </footer>
          </div>
        </div>
      </main>
    </body></html>`);

    const footer = page.locator(".onboarding-done .cfp-actions");
    const layout = await footer.evaluate((element) => {
      const footerBox = element.getBoundingClientRect();
      const actionBoxes = [...element.children].map((action) => action.getBoundingClientRect());
      return {
        actionsFit: actionBoxes.every((box) => box.left >= footerBox.left && box.right <= footerBox.right),
        distinctRows: new Set(actionBoxes.map((box) => Math.round(box.top))).size,
        documentScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(layout.actionsFit).toBe(true);
    expect(layout.distinctRows).toBe(2);
    expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  });
});

test.describe("mobile auth touch targets", () => {
  test.use({ viewport: { width: 320, height: 700 } });

  test("gives the password reveal control the full field-height hit area", async ({ page }) => {
    const styles = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    await page.setContent(`<!doctype html><html><head><style>${styles}</style></head><body>
      <main style="padding:24px">
        <div class="field">
          <label for="password">Password</label>
          <div class="auth-password-input">
            <input id="password" type="password">
            <button class="auth-password-toggle" type="button" aria-label="Show password"></button>
          </div>
        </div>
      </main>
    </body></html>`);

    const metrics = await page.locator(".auth-password-input").evaluate((element) => {
      const input = element.querySelector("input");
      const button = element.querySelector("button");
      if (!input || !button) throw new Error("Password fixture is incomplete");
      const inputBox = input.getBoundingClientRect();
      const buttonBox = button.getBoundingClientRect();
      return {
        inputHeight: inputBox.height,
        buttonWidth: buttonBox.width,
        buttonHeight: buttonBox.height,
        verticalCenterDelta: Math.abs((inputBox.top + inputBox.bottom - buttonBox.top - buttonBox.bottom) / 2),
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });

    expect(metrics.inputHeight).toBeGreaterThanOrEqual(44);
    expect(metrics.buttonWidth).toBeGreaterThanOrEqual(44);
    expect(metrics.buttonHeight).toBeGreaterThanOrEqual(44);
    expect(metrics.verticalCenterDelta).toBeLessThanOrEqual(1);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);
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
          <span class="status-badge status-tone-success" id="hosted-badge"><i></i>Open</span>
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
