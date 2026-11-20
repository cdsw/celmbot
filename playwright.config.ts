import { defineConfig } from "@playwright/test";

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
      CELMBOT_CONFIG_DIR: "D:/Jobber/Portfolio/freecel/.celmbot-test",
      BROWSER: "none",
    },
  },
});
