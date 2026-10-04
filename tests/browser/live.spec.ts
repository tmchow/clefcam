import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { fakeCamera } from "./helpers";
async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open camera" }).click();
  await page
    .getByRole("button", {
      name: /Add rule|Choose rules first|Edit \d+ rules?/,
    })
    .click();
  await page.getByRole("button", { name: "Mug visible Objects" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
}
test("live states, one-shot auto and explicit re-arm", async ({ page }) => {
  await fakeCamera(page);
  let calls = 0;
  await page.route("**/api/evaluate", async (route) => {
    calls++;
    const data = route.request().postDataJSON();
    await route.fulfill({
      json: {
        model: "clef-flash",
        complete: true,
        version: data.version,
        states: Object.fromEntries(
          data.rules.map((r: { id: string }) => [r.id, "matched"]),
        ),
        elapsedMs: 120,
      },
    });
  });
  await start(page);
  await expect(page.getByText("Rule matched")).toBeVisible({
    timeout: 8000,
  });
  await expect(
    page.getByRole("button", { name: "Cost and speed details" }),
  ).toContainText("Test data");
  await page.getByRole("button", { name: "Cost and speed details" }).click();
  await expect(
    page.getByText("Test data is excluded from live speed and spend totals."),
  ).toBeVisible();
  await expect(
    page.locator("dl").getByText("Unavailable", { exact: true }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Back to camera", exact: true })
    .click();
  await page.screenshot({ path: "private/live-mobile-fixture.png" });
  await page.getByRole("button", { name: "Auto", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Captured photo" }),
  ).toBeVisible({ timeout: 10000 });
  const count = calls;
  await page.waitForTimeout(2000);
  expect(calls).toBe(count);
  await page.getByRole("button", { name: "Back to live" }).click();
  await expect(
    page.getByRole("button", { name: "Auto", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Captured photo" }),
  ).toHaveCount(0);
});
test("editing a rule rejects its in-flight answer and disarms capture", async ({
  page,
}) => {
  await fakeCamera(page);
  let release: (() => void) | undefined;
  let requests = 0;
  await page.route("**/api/evaluate", async (route) => {
    const data = route.request().postDataJSON();
    requests++;
    // Keep later requests pending so a fresh reply cannot hide stale acceptance.
    if (requests > 1) return;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({
      json: {
        model: "clef-flash",
        complete: true,
        version: data.version,
        states: { mug: "matched" },
      },
    });
  });
  await start(page);
  await page.getByRole("button", { name: "Auto", exact: true }).tap();
  await expect.poll(() => requests).toBe(1);
  await page.getByRole("button", { name: "Mug visible Checking" }).tap();
  const condition = page.getByLabel("Visible condition");
  await condition.tap();
  await condition.selectText();
  await page.keyboard.insertText("A striped mug beside a book");
  await page.getByRole("button", { name: "Save rule" }).tap();
  await expect(
    page.getByRole("button", { name: "Auto", exact: true }),
  ).toBeVisible();
  release!();
  // Completed attempts is updated after the response has passed through the
  // app's acceptance path, unlike a request-finished or immediate absence check.
  await page.getByRole("button", { name: "Cost and speed details" }).tap();
  await expect(
    page
      .locator("dl > div")
      .filter({
        has: page.getByText("Completed attempts", { exact: true }),
      })
      .locator("dd"),
  ).toHaveText("1 checks");
  await page.getByRole("button", { name: "Back to camera", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: "A striped mug beside a book Checking" }),
  ).toBeVisible();
  await expect(page.locator(".result-summary")).not.toContainText(
    "0 of 1 matched",
  );
  await expect(page.locator(".result-summary")).toContainText(
    /Checking the scene|Waiting for a fresh result/,
  );
  await expect(
    page.getByRole("dialog", { name: "Captured photo" }),
  ).toHaveCount(0);
});
test("camera switch and background pause invalidate auto", async ({ page }) => {
  await fakeCamera(page);
  await page.route("**/api/evaluate", async (route) => {
    const d = route.request().postDataJSON();
    await route.fulfill({
      json: { version: d.version, states: { mug: "unmet" } },
    });
  });
  await start(page);
  await page.getByRole("button", { name: "Auto", exact: true }).click();
  await page.getByRole("button", { name: "Switch camera" }).click();
  await expect(
    page.getByRole("button", { name: "Switch camera" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Auto", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByRole("button", { name: "Paused", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByRole("button", { name: "Paused", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Paused", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Live", exact: true }),
  ).toBeVisible();
});
test("small viewport and keyboard-sized picker remain dismissible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: /Add rule|Choose rules first|Edit \d+ rules?/,
    })
    .click();
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page.getByLabel("Make it your own").fill("A visible book");
  await page.setViewportSize({ width: 375, height: 390 });
  await expect(
    page.getByRole("button", { name: "Add custom rule" }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "Back to rules" }).click();
  await expect(
    page.getByRole("button", { name: "Done", exact: true }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator("dialog")).not.toBeVisible();
});

test("Auto saves the evaluated frame when the live scene changes during inference", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 960;
    const ctx = canvas.getContext("2d")!;
    let color = "#ed2020";
    const paint = () => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    paint();
    setInterval(paint, 60);
    Object.assign(window, {
      changeScene: () => {
        color = "#2040ed";
        paint();
      },
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => canvas.captureStream(15),
    });
  });
  let heldImage = "";
  let release: (() => void) | undefined;
  let calls = 0;
  await page.route("**/api/evaluate", async (route) => {
    const data = route.request().postDataJSON();
    calls++;
    if (calls === 2) {
      heldImage = data.image;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    await route.fulfill({
      json: {
        version: data.version,
        complete: true,
        states: { mug: "matched" },
      },
    });
  });
  await start(page);
  await page.getByRole("button", { name: "Auto", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: "Mug visible Matched" }),
  ).toBeVisible();
  await expect.poll(() => heldImage).not.toBe("");
  await page.evaluate(() =>
    (window as unknown as { changeScene: () => void }).changeScene(),
  );
  const pixel = async (bytes: Buffer) => {
    const { data, info } = await sharp(bytes)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const offset =
      (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) *
      info.channels;
    return [...data.subarray(offset, offset + 3)];
  };
  // The displayed scene must have changed before the matched reply is released.
  await expect
    .poll(
      async () =>
        (await pixel(await page.locator(".camera-preview").screenshot()))[2],
    )
    .toBeGreaterThan(180);
  const sampled = await pixel(Buffer.from(heldImage.split(",")[1], "base64"));
  expect(sampled[0]).toBeGreaterThan(180);
  expect(sampled[2]).toBeLessThan(70);
  release!();
  const photo = page
    .getByRole("dialog", { name: "Captured photo" })
    .locator("img");
  await expect(photo).toBeVisible();
  const captured = await pixel(
    Buffer.from((await photo.getAttribute("src"))!.split(",")[1], "base64"),
  );
  expect(captured[0]).toBeGreaterThan(180);
  expect(captured[2]).toBeLessThan(70);
});

test("Auto waits for complete matching replies before capturing", async ({
  page,
}) => {
  await fakeCamera(page);
  let calls = 0;
  let release: (() => void) | undefined;
  await page.route("**/api/evaluate", async (route) => {
    const data = route.request().postDataJSON();
    const attempt = ++calls;
    if (attempt === 3)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await route.fulfill({
      json: {
        version: data.version,
        complete: attempt > 2,
        states: { mug: "matched" },
      },
    });
  });
  await start(page);
  await page.getByRole("button", { name: "Auto", exact: true }).tap();
  await page.getByRole("button", { name: "Cost and speed details" }).tap();
  await expect(
    page
      .locator("dl > div")
      .filter({ has: page.getByText("Completed attempts", { exact: true }) })
      .locator("dd"),
  ).toHaveText("2 checks", { timeout: 10000 });
  await expect(
    page.getByRole("dialog", { name: "Captured photo" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Back to camera", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: "Disarm", exact: true }),
  ).toBeVisible();
  await expect.poll(() => !!release, { timeout: 10000 }).toBe(true);
  release!();
  await expect(
    page.getByRole("dialog", { name: "Captured photo" }),
  ).toBeVisible({ timeout: 10000 });
});
