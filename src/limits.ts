export const USAGE_LIMITS = { daily: 1000, lifetime: 2000 } as const;

// Shared with the server so the UI never mistakes temporary admission pressure
// for an exhausted spending reservation. Never display arbitrary response text.
export function usageLimitMessage(code: string): string {
  switch (code) {
    case "daily_limit":
      return `Daily reservation limit (${USAGE_LIMITS.daily.toLocaleString("en-US")} units) reached. Resets at 00:00 UTC; tap play afterward.`;
    case "lifetime_limit":
      return `Lifetime reservation limit (${USAGE_LIMITS.lifetime.toLocaleString("en-US")} units) reached. Owner budget review required; reloading will not reset it.`;
    case "check_in_progress":
      return "Another check is still running. Wait for it to finish, then tap play.";
    case "check_rate_limit":
      return "Checks arrived too quickly. Wait a moment, then tap play.";
    default:
      return "Checking was limited by the server. The reason is unavailable; see Details for diagnostics.";
  }
}
