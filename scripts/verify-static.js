#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const ignoredDirectories = new Set([".git", "node_modules", "coverage", "build", "dist", "out"]);
const files = [];

function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) collect(path.join(directory, entry.name));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) files.push(path.join(directory, entry.name));
  }
}

collect(root);
files.sort();

let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status === 0) continue;
  failures += 1;
  console.error(`Syntax check failed: ${path.relative(root, file)}`);
  process.stderr.write(result.stderr || result.stdout || "Unknown syntax error\n");
}

if (failures > 0) {
  console.error(`Static syntax verification failed: ${failures} file(s).`);
  process.exit(1);
}

console.log(`Static syntax verification passed: ${files.length} JavaScript file(s).`);
