import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // run sequentially so the video tells a clear story
  retries: 0,
  reporter: "list",

  use: {
    baseURL: "http://localhost:3000",

    // Record video for every test — saved to test-results/<test-name>/
    video: "on",

    // Keep a trace on failure for debugging
    trace: "retain-on-failure",

    // Give the app time to respond (localnet can be slow)
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // 1280x720 gives a clean GIF size
        viewport: { width: 1280, height: 720 },
      },
    },
  ],

  // Auto-start "npm run dev" if not already running
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
