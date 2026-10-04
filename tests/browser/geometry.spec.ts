import { test, expect } from "@playwright/test";
import sharp from "sharp";
test("sensor dimensions, cover crop and mirroring stay aligned across switching, rotation and resume", async ({
  page,
}) => {
  test.setTimeout(45000);
  await page.addInitScript(() => {
    let n = 0;
    // WebKit may garbage-collect the JS MediaDevices wrapper and its own-property mock.
    Object.assign(window, { testCameraDevices: navigator.mediaDevices });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        const c = document.createElement("canvas");
        const dimensions = n++ % 2 ? [720, 1280] : [1920, 1080];
        c.width = dimensions[0];
        c.height = dimensions[1];
        const ctx = c.getContext("2d")!;
        const paint = () => {
          for (const [x, y, color] of [
            [0, 0, "#ed2020"],
            [1, 0, "#20c020"],
            [0, 1, "#2040ed"],
            [1, 1, "#ead520"],
          ] as const) {
            ctx.fillStyle = color;
            ctx.fillRect(
              (x * c.width) / 2,
              (y * c.height) / 2,
              c.width / 2,
              c.height / 2,
            );
          }
        };
        paint();
        setInterval(paint, 60);
        Object.assign(window, {
          rotateSensor: () => {
            const width = c.width;
            c.width = c.height;
            c.height = width;
            paint();
          },
        });
        return c.captureStream(15);
      },
    });
  });
  let lastImage = "";
  await page.route("**/api/evaluate", async (route) => {
    const d = route.request().postDataJSON();
    lastImage = d.image;
    await route.fulfill({
      json: { version: d.version, states: { mug: "unmet" } },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open camera" }).click();
  await expect(
    page.getByRole("button", { name: "Switch camera" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await page.getByRole("button", { name: "Mug visible Objects" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  for (const [index, width, height, front] of [
    [0, 390, 844, false],
    [1, 390, 844, true],
    [2, 844, 390, true],
    [3, 353, 716, false],
  ] as const) {
    await page.setViewportSize({ width, height });
    if (index === 1 || index === 3)
      await page.getByRole("button", { name: "Switch camera" }).click();
    if (index === 2)
      await page.evaluate(() =>
        (window as unknown as { rotateSensor: () => void }).rotateSensor(),
      );
    await expect(
      page.getByRole("button", { name: "Switch camera" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const v = document.querySelector(".camera-preview")!,
            stage = document.querySelector(".camera-stage")!,
            a = v.getBoundingClientRect(),
            b = stage.getBoundingClientRect();
          return (
            Math.abs(a.x - b.x) +
            Math.abs(a.y - b.y) +
            Math.abs(a.width - b.width) +
            Math.abs(a.height - b.height)
          );
        }),
      )
      .toBeLessThan(1);
    lastImage = "";
    await expect.poll(() => lastImage, { timeout: 7000 }).not.toBe("");
    // Decode JPEG bytes independently: WebKit can resolve Image.decode() before
    // drawImage populates a detached test canvas, yielding transparent pixels.
    const inspect = async (uri: string) => {
      const { data, info } = await sharp(
        Buffer.from(uri.split(",")[1], "base64"),
      )
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const offset =
        (Math.round(info.height * 0.25) * info.width +
          Math.round(info.width * 0.25)) *
        info.channels;
      return {
        width: info.width,
        height: info.height,
        pixel: Array.from(data.subarray(offset, offset + 4)),
      };
    };
    const inference = await inspect(lastImage);
    const stage = await page.locator(".camera-stage").boundingBox();
    expect(stage!.height).toBe(height);
    await expect(
      page.getByRole("button", { name: "Take manual photo" }),
    ).toBeInViewport();
    expect(inference.width / inference.height).toBeCloseTo(
      stage!.width / stage!.height,
      2,
    );
    expect(front ? inference.pixel[1] : inference.pixel[0]).toBeGreaterThan(
      150,
    );
    expect(front ? inference.pixel[0] : inference.pixel[1]).toBeLessThan(70);
    const screenshot = await page.screenshot({
      path: `private/geometry-${index}.png`,
    });
    const raster = await sharp(screenshot)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = [0.08, 0.92].map((x) => {
      const offset =
        (Math.round(stage!.y + stage!.height * 0.34) * raster.info.width +
          Math.round(stage!.x + stage!.width * x)) *
        raster.info.channels;
      return Array.from(raster.data.subarray(offset, offset + 4));
    });
    // Inspect rendered browser pixels outside the inset reported on iPhone.
    expect(pixels[0][front ? 1 : 0]).toBeGreaterThan(
      pixels[0][front ? 0 : 1] * 2,
    );
    expect(pixels[1][front ? 0 : 1]).toBeGreaterThan(
      pixels[1][front ? 1 : 0] * 2,
    );
    await page.getByRole("button", { name: "Take manual photo" }).click();
    const capture = await inspect(
      (await page
        .getByRole("dialog", { name: "Captured photo" })
        .locator("img")
        .getAttribute("src"))!,
    );
    expect(capture.width / capture.height).toBeCloseTo(
      inference.width / inference.height,
      2,
    );

    await page.screenshot({ path: `private/capture-${index}.png` });
    for (let k = 0; k < 3; k++)
      expect(Math.abs(capture.pixel[k] - inference.pixel[k])).toBeLessThan(12);
    await page.getByRole("button", { name: "Back to live" }).click();
    await expect(
      page.getByRole("button", { name: "Pause live checking" }),
    ).toBeVisible();
  }
});
