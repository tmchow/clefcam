import { describe, it, expect } from "vitest";
import { classify, CaptureGate, acceptedFrame, presets } from "../src/rules";
import { parseAnswers, modelInput } from "../worker/validation";
describe("capture correctness", () => {
  it("never treats invalid probability or an error as a match", () => {
    for (const v of [undefined, NaN, -1, 2, null, "0.99"])
      expect(classify(v)).toBe("uncertain");
    expect(classify(0.9)).toBe("matched");
    expect(classify(0.1)).toBe("unmet");
  });
  it("requires two fresh stable matches and resets on uncertainty", () => {
    const g = new CaptureGate();
    expect(g.accept(["matched"], 100)).toBe(false);
    expect(g.accept(["matched"], 500)).toBe(false);
    expect(g.accept(["matched"], 1100)).toBe(true);
    expect(g.accept(["uncertain"], 1200)).toBe(false);
    expect(g.accept(["matched"], 2200)).toBe(false);
    g.reset();
    expect(g.accept(["matched"], 3500)).toBe(false);
    expect(g.accept([], 4500)).toBe(false);
  });
  it("invalidates old rule versions, old frames and hidden tabs", () => {
    expect(acceptedFrame(1, 2, 100, 200, false)).toBe(false);
    expect(acceptedFrame(1, 1, 100, 6000, false)).toBe(false);
    expect(acceptedFrame(1, 1, 100, 200, true)).toBe(false);
    expect(acceptedFrame(1, 1, 100, 200, false)).toBe(true);
  });
  it("keeps multi-part book conditions scoped to one object", () => {
    expect(presets.find((r) => r.id === "open-book")!.text).toContain(
      "same book",
    );
  });
});
describe("model boundary", () => {
  it("batches rules with scoped instructions", () => {
    const rules = presets.slice(0, 3);
    const input = modelInput({
      image: "fixture",
      rules,
      version: 1,
      session: "fixture",
    });
    expect(Object.keys(input.questions)).toHaveLength(4);
    expect(input.state).toContain("SAME object");
  });
  it("fails uncertain for missing and malformed model answers", () => {
    const rules = [{ id: "peace", text: "peace" }];
    expect(parseAnswers({}, rules).peace).toBe("uncertain");
    expect(
      parseAnswers({ answers: { peace: { type: "noul", noul: 0.93 } } }, rules)
        .peace,
    ).toBe("matched");
  });
});
it("does not match properties spread across different objects", () => {
  const rules = [
    { id: "red", text: "A red mug" },
    { id: "table", text: "A mug on the table" },
  ];
  expect(
    parseAnswers(
      {
        answers: {
          red: { type: "noul", noul: 0.99 },
          table: { type: "noul", noul: 0.99 },
          scope: { type: "noul", noul: 0.2 },
        },
      },
      rules,
    ),
  ).toEqual({ red: "uncertain", table: "uncertain" });
});
it("does not accept an aggregate answer with the wrong type", () => {
  const rules = [
    { id: "a", text: "A mug" },
    { id: "b", text: "A red mug" },
  ];
  expect(
    parseAnswers(
      {
        answers: {
          a: { type: "noul", noul: 0.99 },
          b: { type: "noul", noul: 0.99 },
          scope: { type: "choice", noul: 0.99 },
        },
      },
      rules,
    ),
  ).toEqual({ a: "uncertain", b: "uncertain" });
});
