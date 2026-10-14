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

test("P0.4: guildMemberAdd isole chaque délégation de module dans un try/catch", () => {
  const src = fs.readFileSync("src/events/guildMemberAdd.js", "utf8");
  // Le CAPTCHA a été retiré en V1 : aucune délégation ne doit subsister.
  assert.doesNotMatch(src, /getCaptchaRuntime|captcha/i, "plus aucune référence CAPTCHA dans l'événement");
  // La garantie P0.4 est conservée et étendue : chaque appel de module reste
  // isolé, afin qu'un échec d'onboarding ne prive jamais le membre de son log.
  const delegations = [
    ["getAutoRoleRuntime().handleMemberJoined(member)", "autorole_join_failed"],
    ["getWelcomeGoodbyeRuntime().handleMemberAdded(member)", "welcome_join_failed"],
    ["getLogsRuntime().handleMemberJoined(member, inviteResult, inviterStats)", "member_join_log_failed"],
    ["getSecurityRuntime().handleMemberJoined(member)", "security_join_failed"],
    ["getAnalyticsRuntime().trackMember(member)", "analytics_member_failed"],
  ];
  for (const [call, event] of delegations) {
    const idx = src.indexOf(call);
    assert.ok(idx > 0, `l'appel ${call} est présent`);
    assert.match(src.slice(0, idx), /try\s*\{/, `un try { précède ${call}`);
    assert.match(src.slice(idx), /\}\s*catch/, `un } catch suit ${call}`);
    assert.match(src, new RegExp(event), `le log ciblé ${event} est présent`);
  }
});

// ───────────────────────────────────────────────────────────────
// Join/Leave — isolation : une erreur d'onboarding ne doit pas
// empêcher le log d'arrivée ; un membre partiel ne doit pas bloquer
// le log de départ.
// ───────────────────────────────────────────────────────────────

test("Join: autorole et le log d'arrivée sont chacun isolés, inviteResult réutilisé", () => {
  const src = fs.readFileSync("src/events/guildMemberAdd.js", "utf8");
  assert.match(src, /autorole_join_failed/, "autorole isolé avec un log ciblé");
  assert.match(src, /member_join_log_failed/, "le log d'arrivée est isolé");
  assert.match(src, /handleMemberJoined\(member, inviteResult, inviterStats\)/, "inviteResult est réutilisé (pas de recalcul API)");
  const idx = src.indexOf(".handleMemberJoined(member, inviteResult, inviterStats)");
  assert.ok(idx > 0, "l'appel au log d'arrivée est présent");
  assert.match(src.slice(0, idx), /try\s*\{/, "un try { précède le log d'arrivée");
  assert.match(src.slice(idx), /\}\s*catch/, "un } catch suit le log d'arrivée");
});

test("Leave: le log de départ est tenté en premier et isolé (goodbye isolé aussi)", () => {
  const src = fs.readFileSync("src/events/guildMemberRemove.js", "utf8");
  assert.match(src, /member_leave_log_failed/, "le log de départ est isolé");
  assert.match(src, /goodbye_failed/, "le goodbye est isolé");
  const leaveIdx = src.indexOf(".handleMemberLeft(member)");
  const goodbyeIdx = src.indexOf(".handleMemberRemoved(member)");
  assert.ok(leaveIdx > 0, "l'appel handleMemberLeft est présent");
  assert.ok(goodbyeIdx > 0, "l'appel goodbye est présent");
  assert.ok(leaveIdx < goodbyeIdx, "le log de départ est tenté AVANT le goodbye");
  assert.match(src, /member\.user\?\.bot/, "handleInviteDecrement tolère un membre partiel (user null)");
});

test("adaptGuildMember tolère un membre partiel (user null) sans lever", () => {
  const { adaptGuildMember } = require("../../src/adapters/discord/DiscordGuildMemberAdapter");
  const adapted = adaptGuildMember({ guild: { id: "G", name: "Srv", memberCount: 10 }, id: "M", user: null });
  assert.equal(adapted.userId, "M");
  assert.equal(adapted.user, null);
  assert.equal(adapted.username, null);
  assert.equal(adapted.avatarUrl, null);
  assert.equal(adapted.memberCount, 10);
  assert.equal(adapted.guildId, "G");
});
