"use strict";

// ───────────────────────────────────────────────────────────────
// 4F-1 — observabilité de l'annonce Suggestion.
//
// L'échec d'envoi Discord n'annule pas une suggestion déjà persistée
// (comportement inchangé : `ok: true, code: "SUGGESTION_CREATED"`), mais il est
// désormais journalisé (`operation: "suggestion_announce"`) et jamais levé.
// ───────────────────────────────────────────────────────────────

const test = require("node:test");
const assert = require("node:assert/strict");
const { SuggestionService } = require("../services/SuggestionService");

function mockRepo() {
  return {
    create: async ({ guildId, userId, content }) => ({ id: "s1", guild_id: guildId, user_id: userId, content, status: "pending" }),
  };
}

const enabled = { read: async () => ({ suggestions_enabled: true, suggestions_channel_id: "c1" }) };

test("4F-1: un envoi Discord qui échoue reste un succès de création et est journalisé", async () => {
  const warns = [];
  const logger = { warn: (msg, meta) => warns.push({ msg, meta }) };
  const svc = new SuggestionService({
    configService: enabled,
    repository: mockRepo(),
    transport: { sendSuggestion: async () => { throw new Error("channel gone"); } },
    logger,
  });

  const result = await svc.create({ guildId: "g1", authorId: "u1", content: "add feature" });

  assert.equal(result.ok, true, "la suggestion reste créée");
  assert.equal(result.code, "SUGGESTION_CREATED");

  const warn = warns.find((w) => w.meta.operation === "suggestion_announce");
  assert.ok(warn, "un log suggestion_announce est émis");
  assert.equal(warn.meta.guildId, "g1");
  assert.equal(warn.meta.suggestionId, "s1");
  assert.equal(warn.meta.error, "channel gone");
});

test("4F-1: un log hook qui échoue est journalisé et non bloquant", async () => {
  const warns = [];
  const logger = { warn: (msg, meta) => warns.push({ msg, meta }) };
  const svc = new SuggestionService({
    configService: enabled,
    repository: mockRepo(),
    transport: { sendSuggestion: async () => {} },
    logsRuntime: { disabled: false, handleModerationEvent: async () => { throw new Error("logs down"); } },
    logger,
  });

  const result = await svc.create({ guildId: "g1", authorId: "u1", content: "add feature" });
  assert.equal(result.ok, true);

  const warn = warns.find((w) => w.meta.operation === "suggestion_log");
  assert.ok(warn, "un log suggestion_log est émis");
  assert.equal(warn.meta.error, "logs down");
});

test("4F-1: aucun warn quand tout réussit", async () => {
  const warns = [];
  const logger = { warn: (msg, meta) => warns.push({ msg, meta }) };
  const svc = new SuggestionService({
    configService: enabled,
    repository: mockRepo(),
    transport: { sendSuggestion: async () => {} },
    logger,
  });

  await svc.create({ guildId: "g1", authorId: "u1", content: "add feature" });
  assert.equal(warns.length, 0);
});
