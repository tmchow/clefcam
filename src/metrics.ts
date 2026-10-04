import { FLASH } from "./model";
export type CheckOutcome = "success" | "stale" | "partial" | "error";
export type Measurement = {
  outcome: CheckOutcome;
  roundTripMs: number;
  inputTokens?: unknown;
  live: boolean;
  model?: unknown;
};
export type Metrics = {
  completed: number;
  liveReplies: number;
  successful: number;
  knownUsageChecks: number;
  unknownUsageChecks: number;
  inputTokens: number;
  estimatedUsd: number;
  successfulLatencies: number[];
  latest:
    | (Omit<Measurement, "model"> & {
        inputTokens: number | null;
        model: typeof FLASH.id | null;
      })
    | null;
};
export function newMetrics(): Metrics {
  return {
    completed: 0,
    liveReplies: 0,
    successful: 0,
    knownUsageChecks: 0,
    unknownUsageChecks: 0,
    inputTokens: 0,
    estimatedUsd: 0,
    successfulLatencies: [],
    latest: null,
  };
}
export function validTokens(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
export function estimateUsd(tokens: number): number {
  return (tokens * FLASH.rate) / 1_000_000;
}
export function recordMeasurement(state: Metrics, event: Measurement): Metrics {
  const tokens = event.live ? validTokens(event.inputTokens) : null;
  const model = event.model === FLASH.id ? FLASH.id : null;
  const knownCost = tokens !== null && model !== null;
  const latency =
    Number.isFinite(event.roundTripMs) && event.roundTripMs >= 0
      ? event.roundTripMs
      : NaN;
  const success =
    event.live && event.outcome === "success" && Number.isFinite(latency);
  return {
    completed: state.completed + 1,
    liveReplies: state.liveReplies + Number(event.live),
    successful: state.successful + Number(success),
    knownUsageChecks: state.knownUsageChecks + Number(event.live && knownCost),
    // Errors may have consumed inference even without a completed response.
    unknownUsageChecks:
      state.unknownUsageChecks +
      Number((event.live && !knownCost) || event.outcome === "error"),
    inputTokens: state.inputTokens + (tokens ?? 0),
    estimatedUsd: state.estimatedUsd + (knownCost ? estimateUsd(tokens) : 0),
    successfulLatencies: success
      ? [...state.successfulLatencies, latency]
      : state.successfulLatencies,
    latest: { ...event, roundTripMs: latency, inputTokens: tokens, model },
  };
}
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function formatLatency(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}
export function formatCost(
  tokens: number | null,
  model: typeof FLASH.id | null = FLASH.id,
): string {
  if (tokens === null || model === null) return "Unavailable";
  return formatUsd(estimateUsd(tokens));
}
export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.000001) return "<$0.000001";
  return `$${usd.toFixed(6)}`;
}
export function latestLabel(metrics: Metrics): string {
  const latest = metrics.latest;
  if (!latest) return "— ms";
  if (latest.outcome === "error") return "Check failed";
  if (!latest.live) return "Test data";
  if (latest.outcome === "stale") return "Stale result";
  if (latest.outcome === "partial") return "Incomplete";
  return formatLatency(latest.roundTripMs);
}
