import { bindings, defineConfig, exports } from "cf/config";
import { loadEnv } from "vite";
const settings = loadEnv("production", process.cwd(), "");
export default defineConfig({
  accountId: settings.CLOUDFLARE_ACCOUNT_ID,
  worker: {
    name: "clefcam",
    entrypoint: "./worker/index.ts",
    compatibilityDate: "2026-10-01",
    workersDev: true,
    previewUrls: false,
    assets: { runWorkerFirst: true },
    observability: { enabled: false },
    env: {
      AI: bindings.ai(),
      ASSETS: bindings.assets(),
      BUDGET: bindings.durableObject({
        worker: "clefcam",
        exportName: "Budget",
      }),
      ACCESS_ISSUER: bindings.text(settings.ACCESS_ISSUER || ""),
      ACCESS_AUD: bindings.text(settings.ACCESS_AUD || ""),
      ALLOWED_EMAIL: bindings.text(settings.ALLOWED_EMAIL || ""),
      APP_HOST: bindings.text(settings.APP_HOST || ""),
      INFERENCE_ENABLED: bindings.text(settings.INFERENCE_ENABLED || "false"),
    },
    exports: { Budget: exports.durableObject({ storage: "sqlite" }) },
  },
});
