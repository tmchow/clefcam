import { test, expect } from "@playwright/test";
import { fakeCamera } from "./helpers";

// Real CSS env() values, not a production-only test hook. These cover layout
// geometry; they do not emulate physical iPhone clipping or Safari chrome.
for (const layout of [
  {
    name: "browser",
    width: 393,
    height: 792,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  },
  {
    name: "standalone-safe-area",
    width: 393,
    height: 852,
    insets: { top: 59, right: 0, bottom: 34, left: 0 },
  },
  {
    name: "landscape-safe-area",
    width: 852,
    height: 393,
    insets: { top: 0, right: 59, bottom: 21, left: 59 },
  },
]) {
  const background = layout.name === "browser" ? "dark" : "bright";
  test(`rounded match glow stays inside ${layout.name} on ${background}`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: layout.width,
      height: layout.height,
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", {
      insets: layout.insets,
    });
    await fakeCamera(
      page,
      false,
      background === "bright" ? "#ffffff" : "#080808",
    );
    await page.route("**/api/evaluate", async (route) => {
      const data = route.request().postDataJSON();
      await route.fulfill({
        json: {
          version: data.version,
          complete: true,
          model: "clef-flash",
          states: { mug: "matched" },
        },
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Open camera", exact: true }).tap();
    const cameraBefore = await page.locator(".camera-preview").boundingBox();
    await page.getByRole("button", { name: "Add rule", exact: true }).tap();
    await page
      .getByRole("button", { name: "Mug visible Objects", exact: true })
      .tap();
    await page.getByRole("button", { name: "Done", exact: true }).tap();
    await expect(page.getByText("Rule matched", { exact: true })).toBeVisible();
    const frame = page.locator(".viewfinder");
    await expect
      .poll(() => frame.evaluate((e) => getComputedStyle(e, "::after").opacity))
      .toBe("1");
    const geometry = await frame.evaluate((e) => {
      const style = getComputedStyle(e, "::after");
      return {
        top: parseFloat(style.top),
        right: parseFloat(style.right),
        bottom: parseFloat(style.bottom),
        left: parseFloat(style.left),
        radius: parseFloat(style.borderTopLeftRadius),
        stroke: parseFloat(style.borderTopWidth),
      };
    });
    for (const edge of ["top", "right", "bottom", "left"] as const) {
      expect(geometry[edge]).toBeGreaterThanOrEqual(
        Math.max(12, layout.insets[edge]),
      );
      // The safe area is a minimum inset, not added a second time.
      expect(geometry[edge]).toBeLessThanOrEqual(
        Math.max(16, layout.insets[edge]),
      );
    }
    expect(geometry.radius).toBeGreaterThanOrEqual(22);
    expect(geometry.stroke).toBeGreaterThanOrEqual(3);
    expect(await page.locator(".camera-preview").boundingBox()).toEqual(
      cameraBefore,
    );
    const viewport = page.viewportSize()!;
    for (const selector of [
      "header .brand",
      ".header-actions",
      ".bottom button",
      ".camera-notice",
    ]) {
      for (const control of await page.locator(selector).all()) {
        if (!(await control.isVisible())) continue;
        const bounds = (await control.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(
          geometry.left + geometry.stroke,
        );
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(
          viewport.width - geometry.right - geometry.stroke,
        );
      }
    }
    await page.screenshot({
      path: `private/glow-refinement/${layout.name}-${background}.png`,
    });
    await page.getByRole("button", { name: "Take manual photo" }).tap();
    await expect(
      page.getByRole("heading", { name: "Photo captured", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to live" }).tap();
    await expect
      .poll(() => frame.evaluate((e) => getComputedStyle(e, "::after").opacity))
      .toBe("0");
    expect(await page.locator(".camera-preview").boundingBox()).toEqual(
      cameraBefore,
    );
  });
}
