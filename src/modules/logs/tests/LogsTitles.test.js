"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { localizeTitle } = require("../services/logTitles");
const { handleMemberNicknameChanged } = require("../events/handleMemberNicknameChanged");

// ───────────────────────────────────────────────────────────────
// Titres traduits FR/EN — plus aucune clé technique affichée
// ───────────────────────────────────────────────────────────────

test("localizeTitle traduit en FR par défaut (langue absente ou fr)", () => {
  assert.equal(localizeTitle({}, "logs.member_kicked"), "👢 Membre expulsé");
  assert.equal(localizeTitle({ language: "fr" }, "logs.member_kicked"), "👢 Membre expulsé");
  assert.equal(localizeTitle({}, "logs.member_role_added"), "🎭 Rôle ajouté");
  assert.equal(localizeTitle({}, "logs.messageDeleted"), "🗑️ Message supprimé");
});

test("localizeTitle traduit en EN quand config.language === 'en'", () => {
  assert.equal(localizeTitle({ language: "en" }, "logs.member_kicked"), "👢 Member kicked");
  assert.equal(localizeTitle({ language: "en" }, "logs.messageDeleted"), "🗑️ Message deleted");
  assert.equal(localizeTitle({ language: "en" }, "logs.role_created"), "🎭 Role created");
});

test("localizeTitle accepte la clé avec ou sans préfixe 'logs.'", () => {
  assert.equal(localizeTitle({}, "logs.member_kicked"), localizeTitle({}, "member_kicked"));
  assert.equal(localizeTitle({}, "messageUpdated"), "✏️ Message modifié");
});

test("localizeTitle retourne null pour une clé inconnue (jamais de clé brute)", () => {
  assert.equal(localizeTitle({}, "logs.does_not_exist"), null);
  assert.equal(localizeTitle({}, "logs."), null);
});

// ───────────────────────────────────────────────────────────────
// Changement de pseudo → salon Modération + titre traduit
// ───────────────────────────────────────────────────────────────

test("changement de pseudo routé vers log_moderation_channel_id (pas Join)", async () => {
  const delivered = [];
  const config = {
    logs_enabled: true,
    log_moderation_channel_id: "MOD",
    log_member_join_channel_id: "JOIN",
  };
  const mapper = { map: (entry) => entry };
  const service = { resolveDestination: (entry, cfg) => cfg[entry.channelKey] || null };
  const delivery = { deliver: async (entry) => { delivered.push(entry); return entry; } };

  await handleMemberNicknameChanged({
    oldMember: { nickname: "alice" },
    newMember: {
      id: "m",
      nickname: "alice2",
      guild: { id: "G" },
      user: { id: "m", tag: "Alice", displayAvatarURL: () => "https://cdn/avatar.png" },
    },
    config,
    mapper,
    service,
    delivery,
  });

  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].channelKey, "log_moderation_channel_id");
  assert.equal(delivered[0].channelId, "MOD");
  assert.equal(delivered[0].title, "✏️ Pseudo modifié");
  assert.equal(delivered[0].details.member, "<@m> `Alice`");
});
