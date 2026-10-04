import { describe, it, expect } from "vitest";
import { coverCrop } from "../src/geometry";
describe("preview geometry", () => {
  it.each([
    [1920, 1080, 390, 844],
    [720, 1280, 390, 844],
    [4032, 3024, 844, 390],
    [1080, 1920, 353, 716],
  ])("center-crops sensor %s x %s to viewport %s x %s", (sw, sh, w, h) => {
    const c = coverCrop(sw, sh, w, h)!;
    expect(c.width / c.height).toBeCloseTo(w / h, 8);
    expect(c.x * 2 + c.width).toBeCloseTo(sw, 8);
    expect(c.y * 2 + c.height).toBeCloseTo(sh, 8);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeGreaterThanOrEqual(0);
  });
  it("refuses missing metadata and invalid stage sizes", () => {
    for (const values of [
      [0, 1080, 390, 844],
      [1920, 1080, 0, 0],
      [NaN, 1080, 390, 844],
    ])
      expect(
        coverCrop(...(values as [number, number, number, number])),
      ).toBeNull();
  });
});
