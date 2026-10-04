import { test, expect, type Page, type Route } from "@playwright/test";
import { fakeCamera } from "./helpers";

async function scene(page: Page, count = 3, background = "#dedbd3") {
  await fakeCamera(page, false, background);
  const pending: { route: Route; receivedAt: number }[] = [];
  await page.route("**/api/evaluate", (route) => {
    pending.push({ route, receivedAt: Date.now() });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open camera", exact: true }).tap();
  await page.getByRole("button", { name: "Add rule", exact: true }).tap();
  for (const name of [
    "Mug visible Objects",
    "Book visible Objects",
    "Wooden surface Surfaces",
    "Open book Objects",
    "Mostly white background Background",
    "White countertop Surfaces",
  ].slice(0, count)) {
    await page.getByRole("button", { name, exact: true }).tap();
  }
  await page.getByRole("button", { name: "Done", exact: true }).tap();
  return async (
    states: string[],
    complete = true,
    options: { stale?: boolean; status?: number } = {},
  ) => {
    await expect.poll(() => pending.length).toBeGreaterThan(0);
    const { route, receivedAt } = pending.shift()!;
    if (options.stale)
      await page.waitForTimeout(Math.max(0, receivedAt + 5200 - Date.now()));
    const data = route.request().postDataJSON();
    await route.fulfill({
      status: options.status ?? 200,
      json: {
        model: "clef-flash",
        version: data.version,
        complete,
        states: Object.fromEntries(
          data.rules.map((r: { id: string }, i: number) => [r.id, states[i]]),
        ),
      },
    });
  };
}
async function glow(page: Page, expected: number) {
  await expect
    .poll(() =>
      page
        .locator(".viewfinder")
        .evaluate((e) => Number(getComputedStyle(e, "::after").opacity)),
    )
    .toBe(expected);
}

test("matching feedback distinguishes observations, pending checks, expiry and incomplete results", async ({
  page,
}) => {
  test.setTimeout(60000);
  const answer = await scene(page);
  const summary = page.locator(".result-summary");
  await expect(summary).toContainText(
    /Checking the scene|Waiting for a fresh result/,
  );
  await expect(summary).not.toContainText("0 of 3");
  await glow(page, 0);
  await answer(["matched", "unmet", "uncertain"]);
  await expect(summary).toContainText("1 of 3 matched");
  await expect(
    page.getByRole("button", { name: "Book visible Not yet", exact: true }),
  ).toBeVisible();
  await glow(page, 0);
  await answer(["matched", "matched", "matched"]);
  await expect(summary).toContainText("All 3 rules matched");
  await glow(page, 1);
  await expect(summary).toContainText("checking a new sample", {
    timeout: 7000,
  });
  await expect(summary).toContainText("Last check");
  await glow(page, 1);
  // Hold the new request beyond the accepted frame's freshness window.
  await expect(summary).not.toContainText("All 3", { timeout: 7000 });
  await expect(summary).not.toContainText("0 of 3");
  await glow(page, 0);
  // This held response is too old, so it cannot restore the glow.
  await answer(["matched", "matched", "matched"], true, { stale: true });
  await page.getByRole("button", { name: "Cost and speed details" }).tap();
  await expect(
    page
      .locator("dl > div")
      .filter({ has: page.getByText("Completed attempts", { exact: true }) })
      .locator("dd"),
  ).toHaveText("3 checks");
  await page.getByRole("button", { name: "Back to camera", exact: true }).tap();
  await glow(page, 0);
  await answer(["matched", "matched", "matched"], false);
  await expect(summary).toContainText("Incomplete check");
  await glow(page, 0);
  // Shared-scene failures arrive as uncertain from the worker.
  await answer(["uncertain", "uncertain", "uncertain"]);
  await expect(summary).toContainText("0 of 3 matched");
  await expect(
    page.getByRole("button", { name: "Mug visible Uncertain", exact: true }),
  ).toBeVisible();
  await glow(page, 0);
  await answer(["matched", "matched", "matched"]);
  await glow(page, 1);
  await answer(["unmet", "matched", "matched"]);
  await expect(summary).toContainText("2 of 3 matched");
  await glow(page, 0);
  await answer(["matched", "matched", "matched"]);
  await glow(page, 1);
  await page.getByRole("button", { name: "Pause live checking" }).tap();
  await expect(summary).toContainText("Checking paused");
  await glow(page, 0);
  await page.getByRole("button", { name: "Resume live checking" }).tap();
  await expect(summary).not.toContainText("0 of 3");
  await answer(["matched", "matched", "matched"]);
  await glow(page, 1);
  await page
    .getByRole("button", { name: "Book visible Matched", exact: true })
    .tap();
  await page.getByRole("button", { name: "Disable rule", exact: true }).tap();
  await glow(page, 0);
  await answer(["matched", "matched"]);
  await expect(summary).toContainText("All 2 rules matched");
  await glow(page, 1);
  await answer([], false, { status: 502 });
  await expect(summary).toContainText("Couldn’t check this sample");
  await glow(page, 0);
});

test("Auto shows its first match and distinguishes automatic from manual capture", async ({
  page,
}) => {
  const answer = await scene(page, 1);
  await page.getByRole("button", { name: "Auto", exact: true }).tap();
  await answer(["matched"]);
  await expect(page.locator(".result-summary")).toContainText(
    "First match — checking again",
  );
  await glow(page, 1);
  await expect(
    page.getByRole("dialog", { name: "Captured photo" }),
  ).toHaveCount(0);
  // The capture gate requires observations accepted at least 900ms apart.
  await page.waitForTimeout(1000);
  await answer(["matched"]);
  await expect(
    page.getByRole("heading", { name: "Captured matching frame" }),
  ).toBeVisible();
  await expect(
    page.getByText("Two fresh checks matched. Auto is now off.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to live" }).tap();
  await glow(page, 0);
  await page.getByRole("button", { name: "Take manual photo" }).tap();
  await expect(
    page.getByRole("heading", { name: "Photo captured", exact: true }),
  ).toBeVisible();
});

for (const size of [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
  { width: 844, height: 390 },
]) {
  test(`six rule outcomes remain visible and touch-editable at ${size.width}×${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const answer = await scene(
      page,
      6,
      size.width === 375 ? "#080808" : "#ffffff",
    );
    await answer([
      "matched",
      "unmet",
      "uncertain",
      "matched",
      "unmet",
      "matched",
    ]);
    const chips = page.locator(".chip");
    for (let i = 0; i < 6; i++) {
      await expect(chips.nth(i)).toBeInViewport({ ratio: 1 });
    }
    for (let i = 0; i < 6; i++) {
      const bounds = await chips.nth(i).boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: `private/matching-ux/updated-${size.width}-${size.height}.png`,
    });
    await page
      .getByRole("button", { name: "White countertop Matched", exact: true })
      .tap();
    await page.getByRole("button", { name: "Disable rule", exact: true }).tap();
    await expect(
      page.getByRole("button", {
        name: "White countertop Disabled",
        exact: true,
      }),
    ).toBeVisible();
    await glow(page, 0);
    await expect(page.locator(".result-summary")).not.toContainText("of 6");
  });
}

test("reduced motion retains match feedback without animation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const answer = await scene(page, 1);
  await answer(["matched"]);
  await expect(page.locator(".result-summary")).toContainText("Rule matched");
  await glow(page, 1);
  await expect(
    page.getByRole("button", { name: "Mug visible Matched", exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator(".rule-outcome")
      .evaluate((e) => getComputedStyle(e).animationName),
  ).toBe("none");
  expect(
    await page
      .locator(".viewfinder")
      .evaluate((e) => getComputedStyle(e, "::after").transitionDuration),
  ).toBe("0s");
});

test("long custom-rule changes do not move the camera controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const answer = await scene(page, 0);
  const label =
    "A red mug with a handle beside a book on a wooden table and a bright white background. "
      .repeat(3)
      .slice(0, 180);
  await page.getByRole("button", { name: "Add rule", exact: true }).tap();
  await page.getByRole("button", { name: "Custom", exact: true }).tap();
  await page.getByLabel("Make it your own").tap();
  await page.keyboard.insertText(label);
  await page
    .getByRole("button", { name: "Add custom rule", exact: true })
    .tap();
  await page.getByRole("button", { name: "Done", exact: true }).tap();
  await answer(["matched"]);
  await expect(page.locator(".result-summary")).toContainText("Rule matched");
  const before = await page.locator(".bottom").boundingBox();
  await answer(["unmet"]);
  await expect(page.locator(".hint")).toContainText(`${label.trim()}: Not yet`);
  expect((await page.locator(".bottom").boundingBox())!.height).toBe(
    before!.height,
  );
  await answer(["unmet"]);
  await page.getByRole("button", { name: "Cost and speed details" }).tap();
  await expect(
    page
      .locator("dl > div")
      .filter({ has: page.getByText("Completed attempts", { exact: true }) })
      .locator("dd"),
  ).toHaveText("3 checks");
  await page.getByRole("button", { name: "Back to camera", exact: true }).tap();
  expect((await page.locator(".bottom").boundingBox())!.height).toBe(
    before!.height,
  );
});
