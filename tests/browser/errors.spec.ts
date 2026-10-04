import { test, expect, type Page } from "@playwright/test";
import { fakeCamera } from "./helpers";
for (const scenario of [
  { name: "invalid image", status: 400, code: "invalid_frame_or_rules" },
  { name: "AI binding failure", status: 502, code: "ai_binding_error" },
  {
    name: "expired Access session",
    status: 200,
    code: "session_or_non_json",
    html: true,
  },
])
  test(`failed check shows safe diagnostics: ${scenario.name}`, async ({
    page,
  }) => {
    await fakeCamera(page);
    await page.route("**/api/evaluate", (route) =>
      route.fulfill(
        scenario.html
          ? {
              status: 200,
              contentType: "text/html",
              body: "<html>private-login-response</html>",
            }
          : {
              status: scenario.status,
              json: { error: "Failed", code: scenario.code },
            },
      ),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Open camera" }).click();
    await page.getByRole("button", { name: "Add rule", exact: true }).click();
    await page.getByRole("button", { name: "Mug visible Objects" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.locator(".metrics-latency")).toHaveText("Check failed", {
      timeout: 7000,
    });
    await expect(page.locator(".capture-review")).toHaveCount(0);
    if (scenario.html)
      await expect(
        page.getByRole("button", { name: "Resume live checking" }),
      ).toBeVisible();
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await page.getByRole("button", { name: "Show diagnostics" }).click();
    await expect(page.locator(".diagnostics")).toContainText(scenario.code);
    await expect(page.locator(".diagnostics")).toContainText(
      "flash-only-2026-10-04",
    );
    await expect(page.locator("body")).not.toContainText(
      "private-login-response",
    );
  });

async function startChecking(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open camera" }).tap();
  await page.getByRole("button", { name: "Add rule", exact: true }).tap();
  await page.getByRole("button", { name: "Mug visible Objects" }).tap();
  await page.getByRole("button", { name: "Done", exact: true }).tap();
}
async function completed(page: Page, count: number) {
  await page.getByRole("button", { name: "Cost and speed details" }).tap();
  await expect(
    page
      .locator("dl > div")
      .filter({
        has: page.getByText("Completed attempts", { exact: true }),
      })
      .locator("dd"),
  ).toHaveText(`${count} checks`, { timeout: 10000 });
  await page.getByRole("button", { name: "Back to camera", exact: true }).tap();
}
async function diagnostics(page: Page) {
  await page.getByRole("button", { name: "Details", exact: true }).tap();
  await page.getByRole("button", { name: "Show diagnostics" }).tap();
  return page.locator(".diagnostics");
}
test("network failure diagnostics replace the previous coded HTTP failure", async ({
  page,
}) => {
  await fakeCamera(page);
  let requests = 0;
  await page.route("**/api/evaluate", (route) => {
    requests++;
    if (requests === 1)
      return route.fulfill({ status: 502, json: { code: "ai_binding_error" } });
    if (requests === 2) return route.abort();
  });
  await startChecking(page);
  await completed(page, 2);
  const details = await diagnostics(page);
  await expect(details).toContainText("network_or_response_error");
  await expect(details).not.toContainText("ai_binding_error");
});
test("HTML 502 remains a retryable HTTP failure instead of an expired session", async ({
  page,
}) => {
  await fakeCamera(page);
  let requests = 0;
  await page.route("**/api/evaluate", (route) => {
    requests++;
    if (requests === 1)
      return route.fulfill({
        status: 502,
        contentType: "text/html",
        body: "<html>upstream temporarily unavailable</html>",
      });
  });
  await startChecking(page);
  await completed(page, 1);
  await expect(
    page.getByRole("button", { name: "Pause live checking" }),
  ).toBeVisible();
  await expect(await diagnostics(page)).toContainText("http_502");
  await page.getByRole("button", { name: "Back to camera", exact: true }).tap();
  await expect.poll(() => requests, { timeout: 7000 }).toBe(2);
  await expect(page.locator("body")).not.toContainText(
    "upstream temporarily unavailable",
  );
});
for (const failure of [
  { name: "HTML login", status: 200, html: true },
  { name: "unauthorized", status: 401, html: false },
  { name: "usage limit", status: 429, html: false },
])
  test(`stale ${failure.name} cannot pause or disarm a newly resumed session`, async ({
    page,
  }) => {
    await fakeCamera(page);
    let release: (() => void) | undefined;
    let requests = 0;
    await page.route("**/api/evaluate", async (route) => {
      requests++;
      if (requests > 1) return;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill(
        failure.html
          ? {
              status: failure.status,
              contentType: "text/html",
              body: "<html>old login</html>",
            }
          : { status: failure.status, json: { code: "old_failure" } },
      );
    });
    await startChecking(page);
    await expect.poll(() => requests).toBe(1);
    await page.getByRole("button", { name: "Pause live checking" }).tap();
    await page.getByRole("button", { name: "Resume live checking" }).tap();
    await page.getByRole("button", { name: "Auto", exact: true }).tap();
    await expect(
      page.getByRole("button", { name: "Disarm", exact: true }),
    ).toBeVisible();
    release!();
    await completed(page, 1);
    await expect(
      page.getByRole("button", { name: "Disarm", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Pause live checking" }),
    ).toBeVisible();
    await expect.poll(() => requests, { timeout: 7000 }).toBe(2);
  });
