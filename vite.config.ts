import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Vite build produces the static asset bundle in dist/ which Wrangler
// serves via the `assets` configuration (see wrangler.jsonc).
export default defineConfig({
  root: ".",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/mcp": "http://localhost:8787",
    },
  },
});
