import { fakeCamera } from "./helpers";
import { test, expect } from "@playwright/test";
test("metrics starts empty, stays compact, and restores focus after repeated close", async ({
  page,
}) => {
  await fakeCamera(page);
  await page.route("**/api/evaluate", async (route) => {
    const data = route.request().postDataJSON();
    await route.fulfill({
      json: {
        model: "clef-flash",
        version: data.version,
        states: { mug: "matched" },
      },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Cost and speed details" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Open camera" }).click();
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await page.getByRole("button", { name: "Mug visible Objects" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const strip = page.getByRole("button", { name: "Cost and speed details" });
  await expect(strip).toContainText("Clef Flash");
  await expect(strip).toContainText("Test data");
  await expect(strip).toContainText("Cost unavailable");
  await page.screenshot({ path: "private/metrics-mobile-empty.png" });
  for (let i = 0; i < 3; i++) {
    await strip.click();
    await expect(
      page.getByRole("dialog", { name: "Cost & speed" }),
    ).toBeVisible();
    await expect(
      page.getByText("No current successful measurement"),
    ).toBeVisible();
    if (i === 0)
      await page.screenshot({
        path: "private/metrics-details-mobile.png",
        animations: "disabled",
      });
    if (i === 1) await page.keyboard.press("Escape");
    else
      await page
        .getByRole("button", { name: "Back to camera", exact: true })
        .click();
    await expect(strip).toBeFocused();
    await expect(strip).toHaveAttribute("aria-expanded", "false");
  }
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await page.getByRole("button", { name: "Peace sign Gestures" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await strip.click();
  await expect(
    page.getByText("Test data is excluded from live speed and spend totals."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close cost and speed details" })
    .click();
  await expect(
    page.getByRole("button", {
      name: /^Peace sign (Checking|Uncertain|Matched|Paused)$/,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 375, height: 667 });
  await strip.click();
  await expect(
    page.getByRole("button", { name: "Close cost and speed details" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
