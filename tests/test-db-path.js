"use strict";

const os = require("node:os");
const path = require("node:path");

const TEST_DB_DIR = path.join(os.tmpdir(), "universal-labeling-playwright-db");
const TEST_DB_PATH = path.join(TEST_DB_DIR, "universal-labeling.sqlite");

module.exports = {
  TEST_DB_DIR,
  TEST_DB_PATH
};
