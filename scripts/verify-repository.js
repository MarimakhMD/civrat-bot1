#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const requiredFiles = [".gitignore", ".env.example", "README.md"];
const sensitiveFile = /(^|\/)(\.env(?:\..+)?|[^/]+\.(?:pem|key|p12|pfx|crt|cer)|node_modules)(?:\/|$)/i;
let failures = 0;

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    failures += 1;
    console.error(`Required repository file is missing: ${file}`);
  }
}

const tracked = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
if (tracked.status !== 0) {
  console.error(tracked.stderr || "Unable to list tracked files with git.");
  process.exit(1);
}

for (const file of tracked.stdout.split("\n").filter(Boolean)) {
  if (file === ".env.example") continue;
  if (sensitiveFile.test(file)) {
    failures += 1;
    console.error(`Sensitive or generated file is tracked: ${file}`);
  }
}

if (failures > 0) {
  console.error(`Repository verification failed: ${failures} issue(s).`);
  process.exit(1);
}

console.log("Repository verification passed: required safety files exist and no sensitive tracked files were found.");
