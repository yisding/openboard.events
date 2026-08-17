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

test.describe("landing hero responsiveness", () => {
  test("keeps the product preview centered and fully visible across phone and tablet widths", async ({ page }) => {
    const styles = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    await page.setContent(`<!doctype html><html><head><style>${styles}</style></head><body>
      <main class="landing">
        <section class="hero container">
          <div class="hero-copy">
            <div class="eyebrow">Built for ambitious event teams</div>
            <h1>Every speaker. Every session. <span>One calm command center.</span></h1>
            <p>One beautifully focused workspace.</p>
          </div>
          <div class="hero-art" aria-hidden="true">
            <div class="preview-window"></div>
            <div class="floating-card floating-card-one">Schedule published</div>
            <div class="floating-card floating-card-two">Live sync</div>
          </div>
        </section>
      </main>
    </body></html>`);

    const measurements = new Map<number, { previewWidth: number }>();
    for (const width of [320, 375, 480, 600, 680, 768, 769]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.locator(".preview-window").evaluate((element) => {
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          previewWidth: box.width,
          centerDelta: Math.abs(box.left + box.width / 2 - window.innerWidth / 2),
          documentScrollWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        };
      });
      expect(layout.left).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.centerDelta).toBeLessThanOrEqual(0.5);
      expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
      measurements.set(width, { previewWidth: layout.previewWidth });
    }

    expect(measurements.get(320)?.previewWidth).toBeGreaterThanOrEqual(280);
    expect(measurements.get(768)?.previewWidth).toBeGreaterThanOrEqual(600);
    expect((measurements.get(768)?.previewWidth ?? 0) / (measurements.get(769)?.previewWidth ?? 1))
      .toBeGreaterThanOrEqual(0.8);
  });
});

test.describe("agenda workspace geometry", () => {
  test("anchors view tabs to their row and keeps placement guidance clear of actions", async ({ page }) => {
    const styles = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    await page.setContent(`<!doctype html><html><head><style>${styles}</style></head><body>
      <main class="page">
        <div class="agenda-toolbar">
          <div class="agenda-view-tabs" role="tablist" aria-label="Agenda views">
            <button class="active" role="tab" aria-selected="true">List</button>
            <button role="tab" aria-selected="false">Day</button>
            <button role="tab" aria-selected="false">Week</button>
            <button role="tab" aria-selected="false">Track</button>
            <button role="tab" aria-selected="false">Room</button>
          </div>
          <div class="agenda-toolbar-actions">
            <label class="table-search"><input aria-label="Find session" placeholder="Find session"></label>
            <button class="button button-secondary button-sm">Add invited talk</button>
            <button class="button button-primary button-sm">Add session</button>
          </div>
        </div>
        <div class="dv-root">
          <div class="dv-layout">
            <div class="dv-side-panels">
              <aside class="dv-unscheduled-panel">
                <header>
                  <div><h3>Unscheduled</h3><span>3</span></div>
                  <button class="button button-secondary button-sm">Auto-place</button>
                </header>
                <p class="dv-unscheduled-hint">Add a room, then open a session to place it.</p>
                <div class="dv-unscheduled-card"><div><b>Opening keynote</b><span>No track</span></div></div>
              </aside>
            </div>
            <div class="dv-no-rooms">Add a room to start building the day.</div>
          </div>
        </div>
      </main>
    </body></html>`);

    for (const width of [1280, 1024, 768, 480, 320]) {
      await page.setViewportSize({ width, height: 800 });
      const layout = await page.evaluate(() => {
        const rect = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`Agenda fixture is missing ${selector}`);
          return element.getBoundingClientRect();
        };
        const action = rect(".dv-unscheduled-panel header .button");
        const hint = rect(".dv-unscheduled-hint");
        const activeTab = rect(".agenda-view-tabs .active");
        const tabRow = rect(".agenda-view-tabs");
        return {
          actionOverlapsHint: action.left < hint.right
            && action.right > hint.left
            && action.top < hint.bottom
            && action.bottom > hint.top,
          activeTabHeight: activeTab.height,
          underlineOffset: Math.abs(tabRow.bottom - activeTab.bottom),
          documentScrollWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        };
      });

      expect(layout.actionOverlapsHint).toBe(false);
      // Match the 57px Submission Forms toolbar's label-to-indicator rhythm.
      // The agenda header has a border on both edges, leaving a 55px tab row.
      expect(layout.activeTabHeight).toBeGreaterThanOrEqual(55);
      expect(layout.underlineOffset).toBeLessThanOrEqual(0.5);
      expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    }
  });
});

test.describe("embedded itinerary phone spacing", () => {
  test("uses the host width for content while preserving full-size actions", async ({ page }) => {
    const styles = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    await page.setContent(`<!doctype html><html><head><style>${styles}</style></head><body>
      <div class="embed-shell">
        <header class="embed-header"><h1>AI Engineer Sandbox</h1><span>Oct 14–15</span></header>
        <main class="public-schedule embed-content">
          <div class="itinerary-toolbar">
            <button class="itinerary-my-schedule">My Schedule</button>
            <span class="itinerary-export disabled">Star sessions to export</span>
          </div>
          <section class="itinerary-day">
            <h3>Wednesday <span>Oct 14</span></h3>
            <div class="itinerary-sessions">
              <article>
                <button class="itinerary-star" aria-label="Add session to My Schedule">☆</button>
                <div>
                  <span class="itinerary-time">9:00 AM PDT – 9:45 AM PDT · Main Stage</span>
                  <h4>Opening keynote: the year agents grew up</h4>
                  <div class="public-session-speaker"><b>Ada Lovelace</b></div>
                  <p class="itinerary-desc">Where the last twelve months actually landed, and what shipped.</p>
                </div>
              </article>
            </div>
          </section>
        </main>
      </div>
    </body></html>`);

    for (const width of [320, 375, 480]) {
      await page.setViewportSize({ width, height: 800 });
      const layout = await page.evaluate(() => {
        const rect = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`Embed fixture is missing ${selector}`);
          return element.getBoundingClientRect();
        };
        const article = rect(".itinerary-sessions article");
        const title = rect(".itinerary-sessions h4");
        const star = rect(".itinerary-star");
        const headerTitle = rect(".embed-header h1");
        return {
          articleLeft: article.left,
          articleRight: article.right,
          titleWidth: title.width,
          starWidth: star.width,
          headerTitleLeft: headerTitle.left,
          documentScrollWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        };
      });

      expect(layout.articleLeft).toBeCloseTo(12, 0);
      expect(layout.articleRight).toBeCloseTo(width - 12, 0);
      expect(layout.headerTitleLeft).toBeCloseTo(12, 0);
      expect(layout.titleWidth).toBeGreaterThanOrEqual(220);
      expect(layout.starWidth).toBeGreaterThanOrEqual(44);
      expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    }
  });
});

test.describe("embed disabled notice", () => {
  test("pins the footer to the viewport bottom and centers the notice between header and footer", async ({ page }) => {
    const styles = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    await page.setContent(`<!doctype html><html><head><style>${styles}</style></head><body>
      <div class="embed-shell">
        <header class="embed-header"><h1>AI Engineer Sandbox</h1><span>Oct 14–15</span></header>
        <div class="embed-disabled-notice"><p>This session list is not currently available.</p></div>
        <footer>Powered by <b>openboard</b></footer>
      </div>
    </body></html>`);

    await page.setViewportSize({ width: 800, height: 900 });
    const layout = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Embed fixture is missing ${selector}`);
        return element.getBoundingClientRect();
      };
      const header = rect(".embed-header");
      const notice = rect(".embed-disabled-notice p");
      const footer = rect(".embed-shell > footer");
      return {
        footerBottom: footer.bottom,
        viewportHeight: window.innerHeight,
        noticeCenter: notice.top + notice.height / 2,
        midpoint: header.bottom + (footer.top - header.bottom) / 2,
      };
    });

    // Regression guard for #676: the footer used to stop right after the
    // short notice, leaving a dead band of blank space below it instead of
    // sitting at the bottom of the (possibly tall, iframed) viewport.
    expect(layout.footerBottom).toBeCloseTo(layout.viewportHeight, 0);
    // The notice centers in the space it actually has, not just the top of
    // a shell that is mostly empty beneath it.
    expect(Math.abs(layout.noticeCenter - layout.midpoint)).toBeLessThan(5);
  });
});

test.describe("public event phone navigation", () => {
  test("keeps the event identity and every destination readable without a clipped tab row", async ({ page }) => {
    const styles = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    await page.setContent(`<!doctype html><html><head><style>${styles}</style></head><body>
      <main class="public-event">
        <header class="public-event-header">
          <div class="public-event-container">
            <a class="public-event-logo" href="#" aria-label="AI Engineer Sandbox — NYC agenda">
              <span class="public-event-name">AI Engineer Sandbox — NYC</span>
            </a>
            <nav aria-label="Event navigation">
              <a href="#">Sessions</a>
              <a href="#">Agenda</a>
              <a href="#">Schedule</a>
              <a class="active" href="#">Speakers</a>
              <a href="#">Gallery</a>
            </nav>
            <a class="button public-cta" href="#">Speaker portal</a>
          </div>
        </header>
      </main>
    </body></html>`);

    for (const width of [320, 360, 480]) {
      await page.setViewportSize({ width, height: 700 });
      const layout = await page.locator(".public-event-header").evaluate((header) => {
        const logoName = header.querySelector(".public-event-name");
        const nav = header.querySelector("nav");
        if (!logoName || !nav) throw new Error("Public event header fixture is incomplete");
        const navBox = nav.getBoundingClientRect();
        const links = [...nav.querySelectorAll("a")];
        const linkBoxes = links.map((link) => link.getBoundingClientRect());
        // A label that wraps renders its text across more than one client
        // rect even though the cell's own box height is fixed — that extra
        // line is what makes one tab sit visibly taller than its siblings
        // (issue #682).
        const textLineCount = (link: Element) => {
          const range = document.createRange();
          range.selectNodeContents(link);
          return range.getClientRects().length;
        };
        return {
          nameFits: logoName.scrollWidth <= logoName.clientWidth && logoName.scrollHeight <= logoName.clientHeight,
          navFits: nav.scrollWidth <= nav.clientWidth
            && linkBoxes.every((box) => box.left >= navBox.left - 0.5 && box.right <= navBox.right + 0.5),
          touchTargets: linkBoxes.every((box) => box.height >= 44),
          singleLine: links.every((link) => textLineCount(link) === 1),
          documentScrollWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        };
      });
      expect(layout.nameFits).toBe(true);
      expect(layout.navFits).toBe(true);
      expect(layout.touchTargets).toBe(true);
      expect(layout.singleLine).toBe(true);
      expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    }
  });
});

test.describe("speaker portal sign-in rhythm", () => {
  test("uses one compact vertical rhythm from brand through the email field", async ({ page }) => {
    const styles = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    await page.setContent(`<!doctype html><html><head><style>${styles}</style></head><body>
      <main class="login-page">
        <section class="login-card portal-login-card">
          <div class="login-card__brand"><span style="display:block;width:32px;height:32px"></span></div>
          <form>
            <h1>Speaker portal</h1>
            <p>Enter your email to receive a one-time code and secure sign-in link.</p>
            <label class="field"><span>Email address</span><input type="email"></label>
            <button class="button button-primary" type="submit">Send sign-in code</button>
          </form>
        </section>
      </main>
    </body></html>`);

    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.locator(".portal-login-card").evaluate((card) => {
        const brand = card.querySelector(".login-card__brand");
        const heading = card.querySelector("h1");
        const copy = card.querySelector("form>p");
        const field = card.querySelector(".field");
        if (!brand || !heading || !copy || !field) throw new Error("Portal login fixture is incomplete");
        const cardBox = card.getBoundingClientRect();
        const brandBox = brand.getBoundingClientRect();
        const headingBox = heading.getBoundingClientRect();
        const copyBox = copy.getBoundingClientRect();
        const fieldBox = field.getBoundingClientRect();
        const copyStyle = getComputedStyle(copy);
        return {
          brandToHeading: headingBox.top - brandBox.bottom,
          headingToCopy: copyBox.top - headingBox.bottom,
          copyToField: fieldBox.top - copyBox.bottom,
          copyLineHeightRatio: Number.parseFloat(copyStyle.lineHeight) / Number.parseFloat(copyStyle.fontSize),
          cardFits: cardBox.left >= 0 && cardBox.right <= window.innerWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        };
      });
      expect(layout.brandToHeading).toBeCloseTo(16, 0);
      expect(layout.headingToCopy).toBeCloseTo(16, 0);
      expect(layout.copyToField).toBeCloseTo(16, 0);
      expect(layout.copyLineHeightRatio).toBeGreaterThanOrEqual(1.4);
      expect(layout.cardFits).toBe(true);
      expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    }
  });
});

test.describe("login form panel error color", () => {
  test("keeps a rejected sign-in red instead of the subtitle's muted grey", async ({ page }) => {
    const styles = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    await page.setContent(`<!doctype html><html><head><style>${styles}</style></head><body>
      <section class="login-form-panel"><div><form>
        <h1>Welcome back</h1>
        <p>Sign in to your Openboard workspace.</p>
        <label class="field"><span>Email address</span><input type="email"></label>
        <label class="field"><span>Password</span><input type="password"></label>
        <p class="field-error" role="alert">Invalid email or password</p>
        <button class="button button-primary" type="submit">Sign in</button>
      </form></div></section>
    </body></html>`);

    const colors = await page.evaluate(() => {
      const subtitle = document.querySelector(".login-form-panel form>p:not(.field-error)");
      const error = document.querySelector(".login-form-panel .field-error");
      if (!subtitle || !error) throw new Error("Login form fixture is incomplete");
      return { subtitle: getComputedStyle(subtitle).color, error: getComputedStyle(error).color };
    });

    expect(colors.error).not.toBe(colors.subtitle);
    // #af323d
    expect(colors.error).toBe("rgb(175, 50, 61)");
  });
});

test.describe("portal email-preferences rhythm", () => {
  test("keeps the preference state compact instead of inheriting dashboard empty-state height", async ({ page }) => {
    const styles = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    await page.setContent(`<!doctype html><html><head><style>${styles}</style></head><body>
      <main class="login-page">
        <section class="login-card portal-preferences-card">
          <div class="login-card__brand"><span style="display:block;width:32px;height:32px"></span></div>
          <div class="empty-state">
            <div class="empty-icon"></div>
            <h1>This unsubscribe link is invalid</h1>
            <p>The link may have expired. Contact the event organizer if you need help.</p>
          </div>
        </section>
      </main>
    </body></html>`);

    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.locator(".portal-preferences-card").evaluate((card) => {
        const brand = card.querySelector(".login-card__brand");
        const icon = card.querySelector(".empty-icon");
        const heading = card.querySelector("h1");
        const copy = card.querySelector(".empty-state>p");
        if (!brand || !icon || !heading || !copy) throw new Error("Email-preferences fixture is incomplete");
        const cardBox = card.getBoundingClientRect();
        const iconBox = icon.getBoundingClientRect();
        const copyBox = copy.getBoundingClientRect();
        const copyStyle = getComputedStyle(copy);
        return {
          cardHeight: cardBox.height,
          contentHeight: copyBox.bottom - iconBox.top,
          copyLineHeightRatio: Number.parseFloat(copyStyle.lineHeight) / Number.parseFloat(copyStyle.fontSize),
          cardFits: cardBox.left >= 0 && cardBox.right <= window.innerWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        };
      });
      expect(layout.cardHeight).toBeLessThan(400);
      expect(layout.contentHeight).toBeLessThan(220);
      expect(layout.copyLineHeightRatio).toBeGreaterThanOrEqual(1.5);
      expect(layout.cardFits).toBe(true);
      expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    }
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

test.describe("public CFP phone layout", () => {
  test.use({ viewport: { width: 320, height: 700 } });

  test("keeps every progress label readable inside its own step", async ({ page }) => {
    const styles = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const archivo = await readFile(resolve(
      process.cwd(),
      "node_modules/@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2",
    ));
    const archivoSource = `data:font/woff2;base64,${archivo.toString("base64")}`;
    await page.setContent(`<!doctype html><html><head><style>${styles}</style><style>
      @font-face {
        font-family: "Test Archivo";
        font-style: normal;
        font-weight: 100 900;
        font-display: block;
        src: url("${archivoSource}") format("woff2");
      }
      html { --font-sans: "Test Archivo"; }
    </style></head><body>
      <main class="cfp-container">
        <section class="cfp-step cfp-step--compact">
          <ol class="public-form-progress public-form-progress-4" aria-label="Submission progress">
            <li class="active"><span aria-hidden="true">1</span><b>Account</b></li>
            <li><span aria-hidden="true">2</span><b>Submission</b></li>
            <li><span aria-hidden="true">3</span><b>Speaker</b></li>
            <li><span aria-hidden="true">4</span><b>Review</b></li>
          </ol>
        </section>
      </main>
    </body></html>`);
    await page.evaluate(() => document.fonts.load('550 12px "Test Archivo"'));
    expect(await page.evaluate(() => document.fonts.check('550 12px "Test Archivo"'))).toBe(true);

    const progress = page.getByRole("list", { name: "Submission progress" });
    await expect(progress.locator("b")).toHaveText(["Account", "Submission", "Speaker", "Review"]);
    const layout = await progress.evaluate((element) => {
      const items = [...element.querySelectorAll(":scope > li")];
      const measurements = items.map((item) => {
        const label = item.querySelector("b");
        if (!label) throw new Error("Progress item is missing its label");
        return { item: item.getBoundingClientRect(), label: label.getBoundingClientRect() };
      });
      let minLabelGap = Number.POSITIVE_INFINITY;
      measurements.forEach((measurement, index) => {
        if (index === 0) return;
        const previous = measurements.at(index - 1);
        if (previous) minLabelGap = Math.min(minLabelGap, measurement.label.left - previous.label.right);
      });
      return {
        labelsFit: measurements.every(({ item, label }) => label.left >= item.left && label.right <= item.right),
        minLabelGap,
        documentScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(layout.labelsFit).toBe(true);
    expect(layout.minLabelGap).toBeGreaterThanOrEqual(4);
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
