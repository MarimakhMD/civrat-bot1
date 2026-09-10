"use strict";

// Gardes au niveau source des corrections P0.1 / P0.2 / P0.4.
// Ces assertions ne chargent pas discord.js : elles verrouillent simplement
// que les imports et gardes corrigés ne régressent pas.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("P0.1: channelUpdate/threadCreate/threadDelete importent le module entier", () => {
  for (const file of ["src/events/channelUpdate.js", "src/events/threadCreate.js", "src/events/threadDelete.js"]) {
    const src = fs.readFileSync(file, "utf8");
    assert.match(src, /const guildConfigService = require\("\.\.\/services\/guildConfig"\)/, `${file} importe le module`);
    assert.doesNotMatch(src, /\{\s*guildConfigService\s*\}/, `${file} ne déstructure plus guildConfigService`);
  }
});

test("P0.2: messageDelete ne rejette plus les messages partiels", () => {
  const src = fs.readFileSync("src/events/messageDelete.js", "utf8");
  assert.doesNotMatch(src, /!\s*message\.author\b/, "la garde !message.author a disparu");
  assert.match(src, /message\.author\?\.bot/, "la garde bot utilise l'accès optionnel");
});

test("P0.2: messageUpdate ne compare le contenu que pour des messages non partiels", () => {
  const src = fs.readFileSync("src/events/messageUpdate.js", "utf8");
  assert.match(src, /newMessage\.partial/, "vérifie newMessage.partial");
  assert.match(src, /oldMessage\.partial/, "vérifie oldMessage.partial");
});

test("P0.4: guildMemberAdd isole l'appel captcha dans un try/catch", () => {
  const src = fs.readFileSync("src/events/guildMemberAdd.js", "utf8");
  assert.match(src, /captcha_join_failed/, "un log ciblé captcha_join_failed est présent");
  const idx = src.indexOf("getCaptchaRuntime().handleMemberJoined(member)");
  assert.ok(idx > 0, "l'appel captcha est présent");
  assert.match(src.slice(0, idx), /try\s*\{/, "un try { précède l'appel captcha");
  assert.match(src.slice(idx), /\}\s*catch/, "un } catch suit l'appel captcha");
});
