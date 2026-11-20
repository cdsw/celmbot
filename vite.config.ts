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
  },
  server: {
    port: 5179,
    proxy: {
      "/api": "http://127.0.0.1:7429",
    },
  },
});

