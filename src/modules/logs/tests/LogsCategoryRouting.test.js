"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { LogsCategory, LogsCategoryChannelKey } = require("../configuration/logsCategories");
const { selectLogsChannel } = require("../interactions/selectLogsChannel");

test("all Free log categories map to one guild config key", async () => {
  for (const category of Object.values(LogsCategory)) {
    let saved;
    await selectLogsChannel({
      guildId: "g",
      envelope: { category, values: ["c"] },
      service: { update: async (_g, p) => { saved = p; } },
    });
    assert.equal(saved[LogsCategoryChannelKey[category]], "c");
  }
});

// Phase 1 (C11) — assertions explicites. Le test ci-dessus itère
// dynamiquement : il resterait vert même si les deux catégories ajoutées
// étaient absentes ou mappées sur la mauvaise clé. Ces deux clés étaient
// lues par handleMessageUpdated.js et handleMemberLeft.js sans être
// configurables : leur destination restait null et les logs étaient jetés.
test("message-edit and member-leave channels are explicitly routable", async () => {
  for (const [category, key] of [
    [LogsCategory.MESSAGES_EDIT, "log_message_edit_channel_id"],
    [LogsCategory.MEMBERS_LEAVE, "log_member_leave_channel_id"],
  ]) {
    assert.equal(LogsCategoryChannelKey[category], key, `${category} must map to ${key}`);
    let saved;
    await selectLogsChannel({
      guildId: "g",
      envelope: { category, values: ["chan"] },
      service: { update: async (_g, p) => { saved = p; } },
    });
    assert.deepEqual(saved, { [key]: "chan" });
  }
});

// Une catégorie = exactement une clé, et deux catégories ne partagent jamais
// la même clé : sinon un choix dans /settings écraserait l'autre destination.
test("each category maps to a distinct channel key", () => {
  const categories = Object.values(LogsCategory);
  const keys = categories.map((category) => LogsCategoryChannelKey[category]);
  assert.equal(keys.length, 8, "eight configurable log categories");
  assert.equal(new Set(keys).size, keys.length, "no two categories may share a channel key");
  for (const key of keys) {
    assert.equal(typeof key, "string");
    assert.ok(key.length > 0);
  }
});
