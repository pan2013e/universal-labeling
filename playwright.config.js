const { defineConfig, devices } = require("@playwright/test");
const { TEST_DB_DIR, TEST_DB_PATH } = require("./tests/test-db-path");

const TEST_PORT = Number(process.env.PLAYWRIGHT_PORT || process.env.PORT || 8010);
const TEST_WORKERS = Math.max(1, Number(process.env.PLAYWRIGHT_WORKERS || (process.env.CI ? 2 : 4)));

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: true,
  workers: TEST_WORKERS,
  expect: {
    timeout: 5_000
  },
  reporter: [["list"]],
  globalTeardown: require.resolve("./tests/global-teardown.js"),
  webServer: {
    command: `rm -rf ${TEST_DB_DIR} && mkdir -p ${TEST_DB_DIR} && PORT=${TEST_PORT} LABELING_DB_PATH=${TEST_DB_PATH} npm run serve`,
    url: `http://127.0.0.1:${TEST_PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 10_000
  },
  use: {
    baseURL: `http://127.0.0.1:${TEST_PORT}`,
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
