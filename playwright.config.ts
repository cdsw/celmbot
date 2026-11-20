import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const root = path.dirname(fileURLToPath(import.meta.url));
const testConfigDir = path.join(root, ".celmbot-test");

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:7429",
    headless: true,
  },
  webServer: {
    command: "npx tsx src/cli.ts --port 7429 --no-open",
    url: "http://127.0.0.1:7429/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      ...process.env,
      CELMBOT_CONFIG_DIR: testConfigDir,
      BROWSER: "none",
    },
  },
});
