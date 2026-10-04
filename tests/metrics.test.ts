import { describe, it, expect } from "vitest";
import {
  newMetrics,
  recordMeasurement,
  estimateUsd,
  validTokens,
  median,
  formatCost,
  formatLatency,
  latestLabel,
} from "../src/metrics";
describe("inference estimates", () => {
  it("uses actual input tokens once per whole-stack check", () => {
    expect(estimateUsd(333)).toBeCloseTo(0.00002997, 12);
    expect(formatCost(333)).toBe("$0.000030");
    expect(estimateUsd(1_000_000)).toBe(0.09);
  });
  it("never turns missing or malformed usage into free inference", () => {
    for (const value of [undefined, null, NaN, Infinity, -1, 1.2, "333"])
      expect(validTokens(value)).toBeNull();
    expect(formatCost(null)).toBe("Unavailable");
    expect(formatCost(1)).toBe("<$0.000001");
    expect(validTokens(0)).toBe(0);
  });
  it("accumulates known usage while retaining unknown attempts", () => {
    let m = newMetrics();
    m = recordMeasurement(m, {
      outcome: "success",
      roundTripMs: 200,
      inputTokens: 333,
      live: true,
      model: "clef-flash",
    });
    m = recordMeasurement(m, {
      outcome: "success",
      roundTripMs: 300,
      live: true,
      model: "clef-flash",
    });
    m = recordMeasurement(m, {
      outcome: "error",
      roundTripMs: 12000,
      live: false,
    });
    expect(m.inputTokens).toBe(333);
    expect(m.knownUsageChecks).toBe(1);
    expect(m.unknownUsageChecks).toBe(2);
    expect(m.completed).toBe(3);
    expect(m.successful).toBe(2);
    expect(latestLabel(m)).toBe("Check failed");
  });
  it("keeps stale and partial usage in spend but out of successful latency", () => {
    let m = newMetrics();
    for (const outcome of ["stale", "partial"] as const)
      m = recordMeasurement(m, {
        outcome,
        roundTripMs: 200,
        inputTokens: 333,
        live: true,
        model: "clef-flash",
      });
    expect(m.inputTokens).toBe(666);
    expect(m.successfulLatencies).toEqual([]);
    expect(latestLabel(m)).toBe("Incomplete");
  });
  it("excludes mocked responses from measured live totals", () => {
    const m = recordMeasurement(newMetrics(), {
      outcome: "success",
      roundTripMs: 180,
      inputTokens: 333,
      live: false,
    });
    expect(m.inputTokens).toBe(0);
    expect(m.successful).toBe(0);
    expect(m.liveReplies).toBe(0);
    expect(m.latest?.inputTokens).toBeNull();
    expect(latestLabel(m)).toBe("Test data");
  });
  it("resets the complete session on page initialization", () => {
    const old = recordMeasurement(newMetrics(), {
      outcome: "success",
      roundTripMs: 123,
      inputTokens: 333,
      live: true,
      model: "clef-flash",
    });
    const fresh = newMetrics();
    expect(fresh.completed).toBe(0);
    expect(fresh.latest).toBeNull();
    expect(fresh.successfulLatencies).toEqual([]);
    expect(old.completed).toBe(1);
  });
});
describe("round-trip sampling", () => {
  it("defines typical as median, including even-size samples", () => {
    expect(median([])).toBeNull();
    expect(median([1000, 100, 200])).toBe(200);
    expect(median([200, 100])).toBe(150);
    expect(formatLatency(180)).toBe("180 ms");
    expect(formatLatency(1500)).toBe("1.50 s");
  });
  it("rejects invalid latency and displays honest initial placeholders", () => {
    expect(latestLabel(newMetrics())).toBe("— ms");
    expect(formatLatency(NaN)).toBe("—");
    const m = recordMeasurement(newMetrics(), {
      outcome: "success",
      roundTripMs: NaN,
      inputTokens: 5,
      live: true,
      model: "clef-flash",
    });
    expect(m.successfulLatencies).toEqual([]);
  });
});
it("unknown model never receives an assumed cheap rate", () => {
  const m = recordMeasurement(newMetrics(), {
    outcome: "success",
    roundTripMs: 200,
    inputTokens: 1000,
    model: "unknown",
    live: true,
  });
  expect(m.estimatedUsd).toBe(0);
  expect(m.knownUsageChecks).toBe(0);
  expect(m.unknownUsageChecks).toBe(1);
  expect(m.latest?.model).toBeNull();
  expect(formatCost(1000, null)).toBe("Unavailable");
});
