import { test, expect } from "@playwright/test";
import { fakeCamera } from "./helpers";
test("no enabled rules means paused evaluation and zero requests; first rule starts and last stops", async ({
  page,
}) => {
  await fakeCamera(page);
  let calls = 0;
  await page.route("**/api/evaluate", async (route) => {
    calls++;
    const d = route.request().postDataJSON();
    await route.fulfill({
      json: { version: d.version, states: { mug: "unmet" } },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open camera" }).click();
  await expect(
    page.getByRole("button", { name: "Paused", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Resume live checking" }),
  ).toBeDisabled();
  for (let i = 0; i < 3; i++)
    await page
      .getByRole("button", { name: "Paused", exact: true })
      .click({ force: true });
  await page.waitForTimeout(3300);
  expect(calls).toBe(0);
  await expect(
    page.getByText("Add a rule to start checking", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await page.getByRole("button", { name: "Mug visible Objects" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect.poll(() => calls).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: /^Mug visible (Checking|Not yet)$/ })
    .click();
  await page.getByRole("button", { name: "Disable rule" }).click();
  const stopped = calls;
  await expect(
    page.getByRole("button", { name: "Resume live checking" }),
  ).toBeDisabled();
  await page.waitForTimeout(3600);
  expect(calls).toBe(stopped);
  await page.getByRole("button", { name: "Mug visible Off Disabled" }).click();
  await page.getByRole("button", { name: "Enable rule" }).click();
  await expect.poll(() => calls).toBeGreaterThan(stopped);
  await page
    .getByRole("button", { name: /^Mug visible (Checking|Not yet)$/ })
    .click();
  await page.getByRole("button", { name: "Remove rule" }).click();
  const removed = calls;
  await page.waitForTimeout(3200);
  expect(calls).toBe(removed);
});
test("adding a rule while background-paused never resumes evaluation", async ({
  page,
}) => {
  await fakeCamera(page);
  let calls = 0;
  await page.route("**/api/evaluate", (route) => {
    calls++;
    return route.abort();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open camera" }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await page.getByRole("button", { name: "Peace sign Gestures" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Peace sign Paused" }),
  ).toBeVisible();
  await page.waitForTimeout(3200);
  expect(calls).toBe(0);
});

test("picker does not offer retired Position rules", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Choose rules first" }).tap();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page
      .getByLabel("Rule categories")
      .getByRole("button", { name: "Position", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Position$/ })).toHaveCount(0);
});

test("backgrounding during camera permission never restores checking intent", async ({
  page,
}) => {
  await fakeCamera(page, true);
  let calls = 0;
  await page.route("**/api/evaluate", (route) => {
    calls++;
    const data = route.request().postDataJSON();
    return route.fulfill({
      json: { version: data.version, states: { mug: "unmet" } },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open camera" }).tap();
  await expect(
    page.getByRole("heading", { name: "Opening your camera…" }),
  ).toBeVisible();
  await page.evaluate(() => {
    for (const hidden of [true, false]) {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: hidden,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }
    (
      window as unknown as { releaseCameraPermission: () => void }
    ).releaseCameraPermission();
  });
  await expect(
    page.getByRole("button", { name: "Switch camera" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add rule", exact: true }).tap();
  await page.getByRole("button", { name: "Mug visible Objects" }).tap();
  await page.getByRole("button", { name: "Done", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: "Mug visible Paused" }),
  ).toBeVisible();
  await page.waitForTimeout(3200);
  expect(calls).toBe(0);
  // Positive control: a functioning stream and enabled rule really can check.
  await page.getByRole("button", { name: "Resume live checking" }).tap();
  await expect.poll(() => calls).toBeGreaterThan(0);
  await expect(
    page.getByRole("button", { name: "Mug visible Not yet" }),
  ).toBeVisible();
});
