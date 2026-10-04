import { test, expect } from "@playwright/test";
import { fakeCamera } from "./helpers";
const sizes = [
  { name: "iphone-feedback", width: 353, height: 716 },
  { name: "small-phone", width: 320, height: 568 },
  { name: "landscape", width: 844, height: 390 },
];
for (const size of sizes)
  test(`camera-off hierarchy and centering: ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "A camera that follows your rules." }),
    ).toBeVisible();
    await expect(page.getByText("Powered by Cloudflare Clef.")).toBeVisible();
    for (const name of [
      "Switch camera",
      "Paused",
      "Take manual photo",
      "Auto",
      "Cost and speed details",
      "Details",
    ])
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
        0,
      );
    await expect(
      page.getByRole("button", { name: "Open camera" }),
    ).toBeInViewport();
    const layout = await page.evaluate(() => {
      const header = document.querySelector("header")!.getBoundingClientRect(),
        hero = document
          .querySelector(".welcome-content")!
          .getBoundingClientRect(),
        cta = document
          .querySelector(".welcome .primary")!
          .getBoundingClientRect(),
        disclosure = document
          .querySelector(".privacy")!
          .getBoundingClientRect();
      const frame = document
        .querySelector(".camera-off")!
        .getBoundingClientRect();
      const welcome = document
        .querySelector(".welcome")!
        .getBoundingClientRect();
      return {
        frameHeight: frame.height,
        frameBottom: frame.bottom,
        welcomeBottom: welcome.bottom,
        viewportHeight: innerHeight,
        heroCenter: hero.y + hero.height / 2,
        welcomeCenter: welcome.y + welcome.height / 2,
        center: hero.x + hero.width / 2,
        width: innerWidth,
        headerBottom: header.bottom,
        heroTop: hero.top,
        ctaBottom: cta.bottom,
        disclosureTop: disclosure.top,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(Math.abs(layout.center - layout.width / 2)).toBeLessThan(2);
    expect(layout.heroTop).toBeGreaterThanOrEqual(layout.headerBottom);
    expect(layout.disclosureTop).toBeGreaterThan(layout.ctaBottom);
    expect(layout.overflow).toBe(false);
    expect(layout.frameHeight).toBeGreaterThanOrEqual(layout.viewportHeight);
    expect(layout.frameBottom).toBeGreaterThanOrEqual(layout.welcomeBottom);
    expect(Math.abs(layout.heroCenter - layout.welcomeCenter)).toBeLessThan(2);
    await page.screenshot({
      path: `private/welcome-${size.name}.png`,
      fullPage: true,
      animations: "disabled",
    });
    // Safari toolbar expansion/contraction must not overlap the header/CTA.
    await page.setViewportSize({ width: size.width, height: size.height - 90 });
    await expect(
      page.getByRole("button", { name: "Open camera" }),
    ).toBeVisible();
  });
test("preconfigured rules and session metrics survive pause, then resume", async ({
  page,
}) => {
  await fakeCamera(page);
  await page.route("**/api/evaluate", async (route) => {
    const d = route.request().postDataJSON();
    await route.fulfill({
      json: { version: d.version, states: { mug: "matched" } },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Choose rules first" }).click();
  await page.getByRole("button", { name: "Mug visible Objects" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit 1 rule" })).toBeVisible();
  await page.getByRole("button", { name: "Open camera" }).click();
  await expect(
    page.getByRole("button", { name: "Mug visible Matched" }),
  ).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "Pause live checking" }).click();
  await expect(
    page.getByRole("button", { name: "Mug visible Paused" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cost and speed details" }),
  ).toContainText("Test data");
  await expect(page.getByRole("button", { name: "Open camera" })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: "private/camera-paused.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Resume live checking" }).click();
  await expect(
    page.getByRole("button", { name: "Mug visible Matched" }),
  ).toBeVisible({ timeout: 8000 });
});
test("camera denial preserves preconfigured rules without inactive controls", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () =>
        Promise.reject(new DOMException("Denied", "NotAllowedError")),
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Choose rules first" }).click();
  await page.getByRole("button", { name: "Peace sign Gestures" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Open camera" }).click();
  await expect(
    page.getByRole("heading", { name: "Camera unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit 1 rule" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Take manual photo" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Try camera again" }),
  ).toBeEnabled();
  await page.screenshot({
    path: "private/camera-denied.png",
    animations: "disabled",
  });
});
