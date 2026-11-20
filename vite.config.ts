import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve("web"),
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve("src/shared"),
    },
  },
  optimizeDeps: {
    include: ["monaco-editor"],
  },
  worker: {
    format: "es",
  },
  build: {
    outDir: path.resolve("web/dist"),
    emptyOutDir: true,
    // Monaco is intentionally bundled locally (offline); ~4.5MB vendor chunk is expected.
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/monaco-editor") || id.includes("node_modules/@monaco-editor")) {
            return "monaco";
          }
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) {
            return "react";
          }
        },
      },
    },
  },
  server: {
    port: 5179,
    proxy: {
      "/api": "http://127.0.0.1:7429",
    },
  },
});

