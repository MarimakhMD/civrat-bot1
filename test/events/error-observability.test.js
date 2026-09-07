"use strict";

// ───────────────────────────────────────────────────────────────
// 4F-1 — observabilité des événements silencieux.
//
// Verrouille, au niveau source, que les événements best-effort ne peuvent plus
// échouer en silence : chaque fichier importe le logger, contient `logger.warn`
// et ne contient plus aucun `catch {}` vide. Les chemins restent non bloquants
// (aucun re-throw introduit), ce que ces assertions garantissent par absence de
// `throw` dans les catchs observés.
// ───────────────────────────────────────────────────────────────

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const EVENT_FILES = [
  "src/events/messageCreate.js",
  "src/events/channelCreate.js",
  "src/events/channelDelete.js",
  "src/events/channelUpdate.js",
  "src/events/messageDelete.js",
  "src/events/messageUpdate.js",
  "src/events/roleCreate.js",
  "src/events/roleDelete.js",
  "src/events/roleUpdate.js",
  "src/events/voiceStateUpdate.js",
  "src/events/guildMemberAdd.js",
  "src/events/guildMemberRemove.js",
];

for (const file of EVENT_FILES) {
  test(`4F-1: ${file} importe le logger et ne contient plus de catch {} silencieux`, () => {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /require\(["']\.\.\/utils\/logger["']\)/, "le logger est importé");
    assert.match(source, /logger\.warn\(/, "au moins un logger.warn est émis");
    assert.doesNotMatch(source, /catch\s*\{\s*\}/, "aucun catch vide restant");
  });
}

test("4F-1: messageCreate journalise les trois chemins (automod, xp, analytics)", () => {
  const source = fs.readFileSync("src/events/messageCreate.js", "utf8");
  assert.match(source, /event:\s*["']automod_failed["']/);
  assert.match(source, /event:\s*["']xp_failed["']/);
  assert.match(source, /event:\s*["']analytics_failed["']/);
  // Best-effort conservé : aucun throw n'a été introduit dans ces catchs.
  const catches = source.match(/catch\s*\([^)]*\)\s*\{[\s\S]*?\}/g) || [];
  for (const block of catches) {
    assert.doesNotMatch(block, /\bthrow\b/, "le catch reste non bloquant");
  }
});

test("4F-1: messageCreate reste non bloquant sur une entrée nulle/hors guild/bot", async () => {
  const event = require("../../src/events/messageCreate");
  let threw = false;
  try {
    await event.execute(null);
    await event.execute({ guild: null, author: { bot: false }, content: "hi" });
    await event.execute({ guild: { id: "g" }, author: { bot: true }, content: "hi" });
  } catch {
    threw = true;
  }
  assert.equal(threw, false);
});
