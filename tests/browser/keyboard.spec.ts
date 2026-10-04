import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.addInitScript(() => {
    Object.assign(window, { testCameraDevices: navigator.mediaDevices });
    const vv = new EventTarget();
    Object.assign(vv, {
      height: innerHeight,
      width: innerWidth,
      offsetTop: 0,
      offsetLeft: 0,
      scale: 1,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: vv,
    });
    Object.assign(window, {
      keyboardViewport: (
        height: number,
        offsetTop: number,
        event = "resize",
      ) => {
        Object.assign(vv, { height, width: innerWidth, offsetTop });
        vv.dispatchEvent(new Event(event));
      },
    });
    const track = {
      stop() {},
      getSettings() {
        return { facingMode: "environment" };
      },
      addEventListener() {},
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => ({
        getTracks: () => [track],
        getVideoTracks: () => [track],
      }),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      set() {},
      get() {
        return null;
      },
    });
    HTMLMediaElement.prototype.play = async () => {};
  });
  await page.goto("/");
}
async function viewport(
  page: Page,
  height: number,
  top: number,
  event = "resize",
) {
  await page.evaluate(
    ({ height, top, event }) =>
      (
        window as unknown as {
          keyboardViewport: (h: number, t: number, e: string) => void;
        }
      ).keyboardViewport(height, top, event),
    { height, top, event },
  );
}
async function accessibleEditor(
  page: Page,
  field: string,
  action: string,
  height: number,
  top: number,
) {
  const input = page.getByLabel(field),
    save = page.getByRole("button", { name: action, exact: true });
  await expect(input).toBeVisible();
  await expect(save).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Back to rules" }),
  ).toBeVisible();
  const bounds = await input.boundingBox(),
    button = await save.boundingBox(),
    close = await page
      .getByRole("button", { name: "Close rules", exact: true })
      .boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(top);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(top + height);
  expect(button!.y).toBeGreaterThanOrEqual(bounds!.y + bounds!.height - 1);
  expect(button!.y + button!.height).toBeLessThanOrEqual(top + height);
  expect(close!.y).toBeGreaterThanOrEqual(top);
  expect(
    await input.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
  ).toBeGreaterThanOrEqual(16);
}
for (const size of [
  { name: "portrait", width: 353, height: 716, vh: 340, top: 35 },
  { name: "short", width: 320, height: 568, vh: 210, top: 30 },
  { name: "landscape", width: 844, height: 390, vh: 190, top: 12 },
]) {
  test(`custom editor survives keyboard, viewport scroll and draft reopen: ${size.name}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(size);
    await setup(page);
    await page.getByRole("button", { name: "Choose rules first" }).click();
    await page.getByRole("button", { name: "Mug visible Objects" }).click();
    await page
      .getByRole("button", { name: "Book visible Objects", exact: true })
      .click();
    await page.getByLabel("Make it your own").tap();
    await page.keyboard.insertText("A red mug on a wooden table");
    await viewport(page, size.vh, size.top);
    await accessibleEditor(
      page,
      "Make it your own",
      "Add custom rule",
      size.vh,
      size.top,
    );
    await expect(page.getByLabel("Rule categories")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Done", exact: true }),
    ).toBeHidden();
    await viewport(page, size.vh, size.top + 14, "scroll");
    await accessibleEditor(
      page,
      "Make it your own",
      "Add custom rule",
      size.vh,
      size.top + 14,
    );
    await page.screenshot({
      path: `private/keyboard-${info.project.name}-${size.name}.png`,
    });
    await page.getByLabel("Make it your own").press("Enter");
    await expect(page.getByLabel("Make it your own")).not.toBeFocused();
    await expect(page.getByLabel("Make it your own")).toHaveValue(
      "A red mug on a wooden table",
    );
    await viewport(page, size.height, 0);
    await page.getByRole("button", { name: "Back to rules" }).click();
    await expect(page.getByText("2 of 6 rules selected")).toBeVisible();
    await page
      .getByRole("button", { name: "Close rules", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit 2 rules", exact: true })
      .click();
    await expect(page.getByLabel("Make it your own")).toHaveValue(
      "A red mug on a wooden table",
    );
    await page.getByLabel("Make it your own").tap();
    await page.getByRole("button", { name: "Add custom rule" }).click();
    await expect(page.getByText("3 of 6 rules selected")).toBeVisible();
  });
}
test("existing rule draft survives keyboard dismissal, back, close and rotation until explicit Save", async ({
  page,
}, info) => {
  await setup(page);
  await page.getByRole("button", { name: "Open camera" }).click();
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await page.getByRole("button", { name: "Mug visible Objects" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Mug visible Checking" }).click();
  await page.getByLabel("Visible condition").tap();
  await page.getByLabel("Visible condition").selectText();
  await page.keyboard.insertText("A striped mug beside a book");
  await viewport(page, 260, 65);
  await accessibleEditor(page, "Visible condition", "Save rule", 260, 65);
  await page.getByLabel("Visible condition").press("Enter");
  await expect(page.getByLabel("Visible condition")).not.toBeFocused();
  await expect(page.getByRole("button", { name: "Save rule" })).toBeVisible();
  await page.getByRole("button", { name: "Back to rules" }).click();
  await page.getByRole("button", { name: "Close rules", exact: true }).click();
  await viewport(page, 844, 0);
  await page.getByRole("button", { name: "Mug visible Checking" }).click();
  await expect(page.getByLabel("Visible condition")).toHaveValue(
    "A striped mug beside a book",
  );
  await page.getByLabel("Visible condition").tap();
  await page.setViewportSize({ width: 844, height: 390 });
  await viewport(page, 190, 10);
  await accessibleEditor(page, "Visible condition", "Save rule", 190, 10);
  await page.screenshot({
    path: `private/keyboard-${info.project.name}-edit.png`,
  });
  await page.getByRole("button", { name: "Save rule" }).click();
  await expect(page.locator("dialog")).not.toBeVisible();
  await viewport(page, 390, 0);
  await expect(
    page.getByRole("button", { name: "A striped mug beside a book Checking" }),
  ).toBeVisible();
});

test("touch focus stays open and six rules can be added without reopening", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Choose rules first" }).tap();
  for (const [i, name] of [
    "Mug visible Objects",
    "Book visible Objects",
    "Mostly white background Background",
    "Wooden surface Surfaces",
  ].entries()) {
    await page.getByRole("button", { name, exact: true }).tap();
    await expect(page.getByText(`${i + 1} of 6 rules selected`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Custom", exact: true }).tap();
  await page.getByLabel("Make it your own").tap();
  await expect(page.locator("dialog")).toBeVisible();
  await expect(page.getByLabel("Make it your own")).toBeFocused();
  await viewport(page, 320, 40);
  await page.keyboard.insertText("A striped mug");
  await viewport(page, 320, 65, "scroll");
  await page.getByRole("button", { name: "Add custom rule" }).tap();
  await viewport(page, 844, 0);
  await expect(page.getByText("5 of 6 rules selected")).toBeVisible();
  await page.getByLabel("Make it your own").tap();
  await page.keyboard.insertText("A yellow book");
  await page.getByRole("button", { name: "Add custom rule" }).tap();
  await expect(page.getByText("6 of 6 rules selected")).toBeVisible();
  await page.getByRole("button", { name: "Objects", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: "Open book Objects", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Book visible Objects", exact: true })
    .tap();
  await expect(page.getByText("5 of 6 rules selected")).toBeVisible();
  await page
    .getByRole("button", { name: "Open book Objects", exact: true })
    .tap();
  await expect(page.getByText("6 of 6 rules selected")).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole("button", { name: "Done", exact: true }).tap();
  await page.getByRole("button", { name: "Edit 6 rules", exact: true }).tap();
  await expect(page.getByText("6 of 6 rules selected")).toBeVisible();
});

test("third preset after reopen works and a second gesture reveals an explicit choice", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Open camera" }).tap();
  await page.getByRole("button", { name: "Add rule", exact: true }).tap();
  await page.getByRole("button", { name: "Peace sign Gestures" }).tap();
  await page
    .getByRole("button", { name: "Mostly white background Background" })
    .tap();
  await page.getByRole("button", { name: "Done", exact: true }).tap();
  await page.getByRole("button", { name: "Add rule", exact: true }).tap();
  await page.getByRole("button", { name: "Thumbs up Gestures" }).tap();
  // Must already be on-screen: locator.tap() would otherwise auto-scroll and hide this bug.
  const choice = page.getByRole("button", { name: "Keep both gestures" });
  const bounds = await choice.boundingBox(),
    scroll = await page.locator(".picker-sheet .sheet-scroll").boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(scroll!.y);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
    scroll!.y + scroll!.height,
  );
  await choice.tap();
  await expect(page.getByText("3 of 6 rules selected")).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).tap();
  await page.getByRole("button", { name: "Pause live checking" }).first().tap();
  await page.getByRole("button", { name: "Add rule", exact: true }).tap();
  await page.getByRole("button", { name: "Objects", exact: true }).tap();
  await page.getByRole("button", { name: "Mug visible Objects" }).tap();
  await expect(page.getByText("4 of 6 rules selected")).toBeVisible();
  await page.getByRole("button", { name: "Custom", exact: true }).tap();
  await page.getByLabel("Make it your own").tap();
  await viewport(page, 320, 35);
  await page.keyboard.insertText("draft stays");
  await page.getByRole("button", { name: "Back to rules" }).tap();
  await viewport(page, 800, 25, "scroll");
  await page.getByRole("button", { name: "Surfaces", exact: true }).tap();
  await page.getByRole("button", { name: "Wooden surface Surfaces" }).tap();
  await expect(page.getByText("5 of 6 rules selected")).toBeVisible();
  await page.touchscreen.tap(10, 10);
  await expect(page.locator("dialog")).toBeHidden();
});

test("custom rules stay visible and editable inside the open picker", async ({
  page,
}, info) => {
  await setup(page);
  await page.getByRole("button", { name: "Choose rules first" }).tap();
  await page.getByRole("button", { name: "Custom", exact: true }).tap();
  for (const [index, text] of [
    "A red mug",
    "An open blue book",
    "A wooden table",
  ].entries()) {
    await page.getByLabel("Make it your own").tap();
    await page.keyboard.insertText(text);
    await viewport(page, 320, 40);
    await page.getByRole("button", { name: "Add custom rule" }).tap();
    await viewport(page, 844, 0);
    const row = page.getByRole("button", {
      name: `Edit custom rule: ${text}`,
      exact: true,
    });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Enabled");
    await expect(
      page.getByText(`${index + 1} of 6 rules selected`),
    ).toBeVisible();
    const bounds = await row.boundingBox();
    const scroll = await page
      .locator(".picker-sheet .sheet-scroll")
      .boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(scroll!.y);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
      scroll!.y + scroll!.height,
    );
  }
  for (const category of ["All", "Objects", "Custom"]) {
    await page.getByRole("button", { name: category, exact: true }).tap();
    await expect(
      page.getByRole("button", {
        name: "Edit custom rule: A wooden table",
        exact: true,
      }),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: "Edit custom rule: A red mug", exact: true })
    .tap();
  await page.getByLabel("Visible condition").tap();
  await page.getByLabel("Visible condition").press("ControlOrMeta+A");
  await page.keyboard.insertText("A striped red mug");
  await viewport(page, 320, 40);
  await page.getByRole("button", { name: "Save rule", exact: true }).tap();
  await viewport(page, 844, 0);
  await expect(
    page.getByRole("heading", { name: "Set the scene" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Edit custom rule: A striped red mug",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Remove custom rule: An open blue book",
      exact: true,
    })
    .tap();
  await expect(
    page.getByRole("button", {
      name: "Edit custom rule: An open blue book",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByText("2 of 6 rules selected")).toBeVisible();
  await page.getByRole("button", { name: "Objects", exact: true }).tap();
  await page
    .getByRole("button", { name: "Book visible Objects", exact: true })
    .tap();
  await expect(page.getByText("3 of 6 rules selected")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Edit custom rule: A striped red mug",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: `private/custom-picker-${info.project.name}.png`,
  });
  await page
    .getByRole("button", {
      name: "Remove custom rule: A striped red mug",
      exact: true,
    })
    .tap();
  await page
    .getByRole("button", {
      name: "Remove custom rule: A wooden table",
      exact: true,
    })
    .tap();
  await expect(
    page.getByRole("heading", { name: "Your custom rules" }),
  ).toHaveCount(0);
  await expect(page.getByText("1 of 6 rules selected")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Book visible Objects", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
