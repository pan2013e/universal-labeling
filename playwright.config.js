const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  reporter: [["list"]],
  webServer: {
    command: "npm run serve",
    url: "http://127.0.0.1:8000/api/health",
    reuseExistingServer: true,
    timeout: 10_000
  },
  use: {
    baseURL: "http://127.0.0.1:8000",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
