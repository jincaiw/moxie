import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 960 },
    trace: process.env.CI ? "on-first-retry" : "off",
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (process.platform === "linux" ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
});
