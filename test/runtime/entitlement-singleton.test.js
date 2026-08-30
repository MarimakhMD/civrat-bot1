"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const srcRoot = path.join(__dirname, "..", "..", "src");

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "tests") return [];
      return javascriptFiles(absolute);
    }
    return entry.name.endsWith(".js") ? [absolute] : [];
  });
}

test("production runtime constructs EntitlementService only in its central singleton", () => {
  const constructors = javascriptFiles(srcRoot).filter((file) => (
    fs.readFileSync(file, "utf8").includes("new EntitlementService")
  ));
  assert.deepEqual(
    constructors.map((file) => path.relative(srcRoot, file)),
    [path.join("runtime", "getEntitlementService.js")],
  );
});
