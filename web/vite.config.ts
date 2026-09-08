import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { captureApiPlugin } from "../src/server/plugin.ts";

const root = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(root, "../.env"), quiet: true });

export default defineConfig({
  root,
  envDir: resolve(root, ".."),
  plugins: [react(), captureApiPlugin()],
  envPrefix: ["VITE_"],
  optimizeDeps: {
    exclude: ["pg", "bcryptjs"],
  },
  ssr: {
    external: ["pg", "bcryptjs", "dotenv"],
  },
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 5173,
    host: true,
  },
});
