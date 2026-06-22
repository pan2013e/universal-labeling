"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TEST_DB_DIR } = require("./test-db-path");

module.exports = async function globalTeardown() {
  const tmpRoot = fs.realpathSync(os.tmpdir());
  const resolved = path.resolve(TEST_DB_DIR);

  if (resolved.startsWith(`${tmpRoot}${path.sep}`) && path.basename(resolved) === "universal-labeling-playwright-db") {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
};
