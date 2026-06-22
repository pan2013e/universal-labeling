const { defineConfig, devices } = require("@playwright/test");
const { TEST_DB_DIR, TEST_DB_PATH } = require("./tests/test-db-path");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  reporter: [["list"]],
  globalTeardown: require.resolve("./tests/global-teardown.js"),
  webServer: {
    command: `rm -rf ${TEST_DB_DIR} && mkdir -p ${TEST_DB_DIR} && LABELING_DB_PATH=${TEST_DB_PATH} npm run serve`,
    url: "http://127.0.0.1:8000/api/health",
    reuseExistingServer: false,
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
