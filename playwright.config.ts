import { defineConfig } from "@playwright/test";
export default defineConfig({
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 15000,
  },
  testDir: "tests/browser",
  use: {
    channel: "chrome",
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  },
  reporter: "list",
});
