import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
// Browser-only dev never connects to AI. Production protects every static asset through the Worker.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "production" ? [cloudflare()] : [])],
  server: { host: "127.0.0.1" },
}));
