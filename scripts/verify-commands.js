#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const commandsDirectory = path.join(root, "src", "commands");
const commandFiles = fs.readdirSync(commandsDirectory)
  .filter((file) => file.endsWith(".js"))
  .sort();
const names = new Map();
let failures = 0;

for (const file of commandFiles) {
  const source = fs.readFileSync(path.join(commandsDirectory, file), "utf8");
  const nameMatch = source.match(/\.setName\(\s*["']([a-z0-9_-]{1,32})["']\s*\)/);
  const hasData = /\bdata\s*:\s*new\s+SlashCommandBuilder\b/.test(source);
  const hasExecute = /\basync\s+execute\s*\(/.test(source) || /\bexecute\s*:\s*async\b/.test(source);

  if (!hasData || !hasExecute || !nameMatch) {
    failures += 1;
    console.error(`Invalid static command contract: ${path.relative(root, path.join(commandsDirectory, file))}`);
    continue;
  }

  const commandName = nameMatch[1];
  if (names.has(commandName)) {
    failures += 1;
    console.error(`Duplicate slash-command name: /${commandName} in ${names.get(commandName)} and ${file}`);
    continue;
  }
  names.set(commandName, file);
}

if (failures > 0) {
  console.error(`Static command verification failed: ${failures} issue(s).`);
  process.exit(1);
}

console.log(`Static command verification passed: ${names.size} command(s) in ${commandFiles.length} file(s).`);
