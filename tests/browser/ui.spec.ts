import { fakeCamera } from "./helpers";
import { test, expect } from "@playwright/test";
test("picker supports multiple rules, custom conditions and repeated editing", async ({
  page,
}) => {
  await fakeCamera(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A camera that follows your rules." }),
  ).toBeVisible();
  await page.screenshot({ path: "private/welcome-mobile.png" });
  await page.getByRole("button", { name: "Open camera" }).click();
  await expect(
    page.getByRole("button", { name: "Switch camera" }),
  ).toBeEnabled();
  await page
    .getByRole("button", {
      name: /Add rule|Choose rules first|Edit \d+ rules?/,
    })
    .click();
  await page.getByRole("button", { name: "Peace sign Gestures" }).click();
  await page.getByRole("button", { name: "Background", exact: true }).click();
  await page
    .getByRole("button", { name: "Mostly white background Background" })
    .click();
  await expect(page.getByText("2 of 6 rules selected")).toBeVisible();
  await page.screenshot({ path: "private/picker-mobile.png" });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("button", {
      name: /^Peace sign (Checking|Uncertain|Matched|Paused)$/,
    })
    .click();
  await page.getByRole("button", { name: "Replace rule", exact: true }).click();
  await page.getByRole("button", { name: "Thumbs up Gestures" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: /^Thumbs up (Checking|Uncertain|Matched|Paused)$/,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: /Add rule|Choose rules first|Edit \d+ rules?/,
    })
    .click();
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page.getByLabel("Make it your own").fill("A red mug on a wooden table");
  await page.getByRole("button", { name: "Add custom rule" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("button", {
      name: /^A red mug on a wooden table (Checking|Uncertain|Matched|Paused)$/,
    })
    .click();
  await page.getByRole("button", { name: "Disable rule" }).click();
  await expect(
    page.getByRole("button", {
      name: "A red mug on a wooden table Off Disabled",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: /^Thumbs up (Checking|Uncertain|Matched|Paused)$/,
    })
    .click();
  await page.getByRole("button", { name: "Remove rule" }).click();
  await expect(
    page.getByRole("button", {
      name: /^Thumbs up (Checking|Uncertain|Matched|Paused)$/,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: /Add rule|Choose rules first|Edit \d+ rules?/,
    })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("camera permission denial has a retry path", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () =>
        Promise.reject(new DOMException("Denied", "NotAllowedError")),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open camera" }).click();
  await expect(page.getByText(/Camera access is off/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Try camera again" }),
  ).toBeVisible();
});
test("gesture conflict can replace or retain explicitly", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", {
      name: /Add rule|Choose rules first|Edit \d+ rules?/,
    })
    .click();
  await page.getByRole("button", { name: "Peace sign Gestures" }).click();
  await page.getByRole("button", { name: "Thumbs up Gestures" }).click();
  await page
    .getByRole("button", { name: "Replace gesture", exact: true })
    .click();
  await expect(page.getByText("1 of 6 rules selected")).toBeVisible();
  await page.getByRole("button", { name: "Open palm Gestures" }).click();
  await page.getByRole("button", { name: "Keep both gestures" }).click();
  await expect(page.getByText("2 of 6 rules selected")).toBeVisible();
});
