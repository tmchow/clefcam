import { it, expect, vi, afterEach } from "vitest";
import { Budget, type Env } from "../worker/index";
import { presets } from "../src/rules";
afterEach(() => vi.restoreAllMocks());
function fixture(initial?: Record<string, unknown>) {
  const data = new Map<string, unknown>(initial ? [["ledger", initial]] : []);
  const storage = {
    get: async (k: string) => data.get(k),
    put: async (k: string, v: unknown) => {
      data.set(k, v);
    },
    transaction: async (fn: (t: unknown) => unknown) => fn(storage),
  };
  const run = vi.fn(
    async (
      _binding: string,
      input: { model: string; questions: Record<string, unknown> },
    ) => ({
      model: input.model,
      answers: Object.fromEntries(
        Object.keys(input.questions).map((k) => [
          k,
          { type: "noul", noul: 0.97 },
        ]),
      ),
      usage: { input_tokens: 1000, output_tokens: 0 },
    }),
  );
  const budget = new Budget(
    { storage } as unknown as DurableObjectState,
    { AI: { run } } as unknown as Env,
  );
  return { budget, run, data };
}
const session = "a".repeat(36);
function request(rules: unknown[], model = "arbitrary/client-model") {
  return new Request("https://budget/evaluate", {
    method: "POST",
    body: JSON.stringify({
      image: "fixture",
      version: 1,
      session,
      rules,
      model,
    }),
  });
}
it("always runs Flash regardless of a client model field", async () => {
  vi.spyOn(Date, "now").mockReturnValue(100000);
  const { budget, run, data } = fixture();
  const response = await budget.fetch(request([presets[0]], "clef"));
  expect(response.status).toBe(200);
  expect(run.mock.calls[0][0]).toBe("@cf/cloudflare/clef-flash");
  expect(run.mock.calls[0][1].model).toBe("clef-flash");
  expect(await response.json()).toMatchObject({
    model: "clef-flash",
    usage: {
      inputTokens: 1000,
      inputUsdPerMillion: 0.09,
      estimatedUsd: 0.00009,
    },
  });
  expect(data.get("ledger")).toMatchObject({
    calls: 1,
    reservedUnits: 1,
    dailyUnits: 1,
    inputTokens: 1000,
    unknownUsage: 0,
  });
});
it("preserves historical weighted reservations and cost while adding Flash usage", async () => {
  vi.spyOn(Date, "now").mockReturnValue(100000);
  const { budget, data } = fixture({
    calls: 10,
    reservedUnits: 24,
    daily: 4,
    dailyUnits: 12,
    day: new Date(100000).toISOString().slice(0, 10),
    last: 0,
    inputTokens: 10000,
    estimatedUsd: 0.0024,
    unknownUsage: 0,
    tokensByModel: { clef: 10000, "clef-flash": 0 },
  });
  data.set(`session:${session}`, 12);
  expect((await budget.fetch(request([presets[3]]))).status).toBe(200);
  expect(data.get("ledger")).toMatchObject({
    calls: 11,
    reservedUnits: 25,
    daily: 5,
    dailyUnits: 13,
    inputTokens: 11000,
  });
  expect(
    (data.get("ledger") as { estimatedUsd: number }).estimatedUsd,
  ).toBeCloseTo(0.00249, 12);
  expect(data.get(`session:${session}`)).toBe(13);
});
it.each(["lifetime", "daily", "session"])(
  "does not refund historical reservations at the %s cap",
  async (limit) => {
    vi.spyOn(Date, "now").mockReturnValue(100000);
    const { budget, run, data } = fixture({
      calls: 3,
      reservedUnits: limit === "lifetime" ? 2000 : 3,
      daily: 3,
      dailyUnits: limit === "daily" ? 300 : 3,
      day: new Date(100000).toISOString().slice(0, 10),
      last: 0,
      inputTokens: 0,
      unknownUsage: 0,
    });
    if (limit === "session") data.set(`session:${session}`, 120);
    expect((await budget.fetch(request([presets[3]]))).status).toBe(429);
    expect(run).not.toHaveBeenCalled();
  },
);
it("migrates original Flash counters without resetting them", async () => {
  vi.spyOn(Date, "now").mockReturnValue(100000);
  const { budget, data } = fixture({
    calls: 1998,
    daily: 5,
    day: new Date(100000).toISOString().slice(0, 10),
    last: 0,
    inputTokens: 666,
    unknownUsage: 0,
  });
  expect((await budget.fetch(request([presets[3]]))).status).toBe(200);
  expect(data.get("ledger")).toMatchObject({
    reservedUnits: 1999,
    dailyUnits: 6,
  });
  expect(
    (data.get("ledger") as { estimatedUsd: number }).estimatedUsd,
  ).toBeCloseTo((1666 * 0.09) / 1e6, 12);
});
it("keeps the retired model's historical rate when reconstructing a missing total", async () => {
  vi.spyOn(Date, "now").mockReturnValue(100000);
  const { budget, data } = fixture({
    calls: 2,
    reservedUnits: 4,
    daily: 2,
    dailyUnits: 4,
    day: new Date(100000).toISOString().slice(0, 10),
    last: 0,
    inputTokens: 2000,
    tokensByModel: { clef: 1000, "clef-flash": 1000 },
    unknownUsage: 0,
  });
  expect((await budget.fetch(request([presets[3]]))).status).toBe(200);
  expect(
    (data.get("ledger") as { estimatedUsd: number }).estimatedUsd,
  ).toBeCloseTo(0.00042, 12);
});
it("reserves failed calls and enforces the session cap", async () => {
  let now = 100000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const { budget, run, data } = fixture();
  data.set(`session:${session}`, 119);
  run.mockRejectedValue(new Error("failed"));
  expect((await budget.fetch(request([presets[3]]))).status).toBe(502);
  expect(data.get(`session:${session}`)).toBe(120);
  expect(data.get("ledger")).toMatchObject({
    reservedUnits: 1,
    unknownUsage: 1,
  });
  now += 2000;
  expect((await budget.fetch(request([presets[3]]))).status).toBe(429);
  expect(run).toHaveBeenCalledTimes(1);
});

it("rejects concurrent checks before reserving or spending, and unlocks after failure", async () => {
  let now = 100000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const { budget, run, data } = fixture();
  let reject!: (error: Error) => void;
  const pending = new Promise<never>((_resolve, r) => {
    reject = r;
  });
  run.mockImplementationOnce(() => pending);
  const first = budget.fetch(request([presets[3]]));
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  now += 2000; // Past the interval guard: only in-flight admission should reject this check.
  expect((await budget.fetch(request([presets[3]]))).status).toBe(429);
  expect(run).toHaveBeenCalledTimes(1);
  expect(data.get("ledger")).toMatchObject({
    calls: 1,
    reservedUnits: 1,
    unknownUsage: 1,
  });
  reject(new Error("upstream failure"));
  expect((await first).status).toBe(502);
  expect((await budget.fetch(request([presets[3]]))).status).toBe(200);
  expect(run).toHaveBeenCalledTimes(2);
  expect(data.get("ledger")).toMatchObject({
    calls: 2,
    reservedUnits: 2,
    unknownUsage: 1,
  });
});
it.each([undefined, -1, "1000"])(
  "retains unknown cost for invalid upstream usage %s",
  async (tokens) => {
    vi.spyOn(Date, "now").mockReturnValue(100000);
    const { budget, run, data } = fixture();
    run.mockResolvedValueOnce({
      model: "clef-flash",
      answers: { mug: { type: "noul", noul: 0.97 } },
      usage: { input_tokens: tokens as number, output_tokens: 0 },
    });
    const response = await budget.fetch(request([presets[3]]));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      complete: true,
      states: { mug: "matched" },
      usage: { inputTokens: null, estimatedUsd: null },
    });
    expect(data.get("ledger")).toMatchObject({
      calls: 1,
      reservedUnits: 1,
      inputTokens: 0,
      unknownUsage: 1,
    });
  },
);
it("denies a saturated original ledger without refunding its unweighted reservation history", async () => {
  vi.spyOn(Date, "now").mockReturnValue(100000);
  const { budget, run } = fixture({
    calls: 2000,
    daily: 0,
    day: new Date(100000).toISOString().slice(0, 10),
    last: 0,
    inputTokens: 0,
    unknownUsage: 0,
  });
  expect((await budget.fetch(request([presets[3]]))).status).toBe(429);
  expect(run).not.toHaveBeenCalled();
});
