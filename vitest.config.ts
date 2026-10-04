import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/*.test.ts"] },
  resolve: {
    alias: {
      "cloudflare:workers": new URL(
        "./tests/cloudflare-stub.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
