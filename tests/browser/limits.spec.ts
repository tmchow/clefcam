import { test, expect, type Page } from "@playwright/test";
import { fakeCamera } from "./helpers";

async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open camera", exact: true }).tap();
  await page.getByRole("button", { name: "Add rule", exact: true }).tap();
  await page
    .getByRole("button", { name: "Mug visible Objects", exact: true })
    .tap();
  await page.getByRole("button", { name: "Done", exact: true }).tap();
}

for (const [code, cap, recovery] of [
  [
    "daily_limit",
    "Daily reservation limit (1,000 units)",
    "Resets at 00:00 UTC",
  ],
  [
    "lifetime_limit",
    "Lifetime reservation limit (2,000 units)",
    "reloading will not reset it",
  ],
  [
    "check_in_progress",
    "Another check is still running",
    "Wait for it to finish",
  ],
  ["check_rate_limit", "Checks arrived too quickly", "Wait a moment"],
  ["http_429", "reason is unavailable", "see Details for diagnostics"],
]) {
  test(`limit ${code} explains the cause and recovery without exposing response text`, async ({
    page,
  }) => {
    await fakeCamera(page);
    let calls = 0;
    await page.route("**/api/evaluate", (route) => {
      calls++;
      return route.fulfill({
        status: 429,
        json: { code, error: "private-server-details" },
      });
    });
    await start(page);
    await expect(
      page.getByRole("button", { name: "Resume live checking" }),
    ).toBeVisible();
    await expect(page.locator(".hint")).toContainText(cap);
    await page.getByRole("button", { name: "Details", exact: true }).tap();
    await expect(page.getByRole("dialog")).toContainText(cap);
    await expect(page.getByRole("dialog")).toContainText(recovery);
    await expect(page.locator("body")).not.toContainText(
      "private-server-details",
    );
    await page.waitForTimeout(4800);
    expect(calls).toBe(1);
  });
}

test("checking, resume, rule edits and Auto remain available past 120 attempts", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.clock.install();
  await fakeCamera(page);
  let calls = 0;
  await page.route("**/api/evaluate", (route) => {
    calls++;
    const input = route.request().postDataJSON();
    return route.fulfill({
      json: {
        version: input.version,
        complete: true,
        states: { mug: "unmet" },
      },
    });
  });
  await start(page);
  await expect.poll(() => calls).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Cost and speed details" }).tap();
  const completed = page
    .locator("dl > div")
    .filter({ has: page.getByText("Completed attempts", { exact: true }) })
    .locator("dd");
  for (let i = 1; i <= 122; i++) {
    // Process each reply before advancing time; stale replies still count as
    // completed attempts, just as they do in the production usage metrics.
    await expect(completed).toHaveText(`${i} checks`);
    if (i < 122) await page.clock.fastForward(4500);
  }
  await page.getByRole("button", { name: "Back to camera", exact: true }).tap();
  async function nextRequest() {
    const previous = calls;
    await page.clock.fastForward(4500);
    await expect.poll(() => calls, { timeout: 7000 }).toBeGreaterThan(previous);
    await page.getByRole("button", { name: "Cost and speed details" }).tap();
    await expect(completed).toHaveText(`${calls} checks`);
    await page
      .getByRole("button", { name: "Back to camera", exact: true })
      .tap();
  }
  await page.getByRole("button", { name: "Pause live checking" }).tap();
  await page.getByRole("button", { name: "Resume live checking" }).tap();
  await nextRequest();
  await page
    .getByRole("button", { name: /^Mug visible (Checking|Not yet)$/ })
    .tap();
  await page.getByLabel("Visible condition").tap();
  await page.getByLabel("Visible condition").press("End");
  await page.getByLabel("Visible condition").pressSequentially(" on a table");
  await page.getByRole("button", { name: "Save rule", exact: true }).tap();
  await nextRequest();
  await page.getByRole("button", { name: "Auto", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: "Disarm", exact: true }),
  ).toBeVisible();
  await nextRequest();
});
