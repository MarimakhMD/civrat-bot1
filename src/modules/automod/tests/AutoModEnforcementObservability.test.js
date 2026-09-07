"use strict";

// ───────────────────────────────────────────────────────────────
// 4F-1 — observabilité de l'enforcement AutoMod.
//
// L'échec de suppression / sanction / log doit rester NON bloquant (best-effort
// inchangé) mais devenir visible : `logger.warn` est appelé avec un contexte
// minimal (operation, rule, guildId, targetId, error) et jamais un throw.
// On passe par createAutoModRuntime (le chemin réel) avec un enforcer qui lève.
// ───────────────────────────────────────────────────────────────

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAutoModRuntime } = require("../runtime/createAutoModRuntime");
const { AutoModEnforcementService } = require("../services/AutoModEnforcementService");

function runtime({ config, enforcer, logger, logsRuntimeFactory } = {}) {
  const enforcementService = new AutoModEnforcementService({ logger });
  return createAutoModRuntime({
    configService: { read: async () => config },
    enforcementService,
    enforcerFactory: () => enforcer,
    logsRuntimeFactory,
  });
}

test("4F-1: un deleteMessage qui lève reste non bloquant et est journalisé", async () => {
  const warns = [];
  const logger = { warn: (msg, meta) => warns.push({ msg, meta }) };
  const rt = runtime({
    config: { automod_enabled: true, automod_anti_links: true, automod_delete_message: true, automod_punishment: "none" },
    enforcer: { deleteMessage: async () => { throw new Error("discord down"); } },
    logger,
  });

  const result = await rt.handleMessage({ guild: { id: "g1" }, author: { id: "u1" }, content: "https://x", mentions: { size: 0 } });

  assert.equal(result.matched, true);
  assert.equal(result.actions.deleted, false, "l'échec est signalé, pas levé");
  const warn = warns.find((w) => w.meta.operation === "automod_delete");
  assert.ok(warn, "un log automod_delete est émis");
  assert.equal(warn.meta.rule, "AUTOMOD_LINK");
  assert.equal(warn.meta.guildId, "g1");
  assert.equal(warn.meta.targetId, "u1");
  assert.equal(warn.meta.error, "discord down");
});

test("4F-1: un timeoutUser qui lève reste non bloquant et est journalisé", async () => {
  const warns = [];
  const logger = { warn: (msg, meta) => warns.push({ msg, meta }) };
  const rt = runtime({
    config: { automod_enabled: true, automod_anti_caps: true, automod_caps_threshold: 70, automod_punishment: "timeout", automod_timeout_minutes: 5 },
    enforcer: { timeoutUser: async () => { throw new Error("no permission"); } },
    logger,
  });

  const result = await rt.handleMessage({ guild: { id: "g1" }, author: { id: "u1" }, content: "AAAAAAAAAAAAAAAA", mentions: { size: 0 } });

  assert.equal(result.matched, true);
  assert.equal(result.actions.punishment, null, "l'échec de sanction est signalé, pas levé");
  const warn = warns.find((w) => w.meta.operation === "automod_punish");
  assert.ok(warn, "un log automod_punish est émis");
  assert.equal(warn.meta.type, "timeout");
  assert.equal(warn.meta.targetId, "u1");
  assert.equal(warn.meta.error, "no permission");
});

test("4F-1: un log hook qui lève reste non bloquant et est journalisé", async () => {
  const warns = [];
  const logger = { warn: (msg, meta) => warns.push({ msg, meta }) };
  const rt = runtime({
    config: { automod_enabled: true, automod_anti_links: true },
    enforcer: { deleteMessage: async () => true },
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async () => { throw new Error("logs down"); } }),
    logger,
  });

  const result = await rt.handleMessage({ guild: { id: "g1" }, author: { id: "u1" }, content: "https://x", mentions: { size: 0 } });

  assert.equal(result.matched, true);
  const warn = warns.find((w) => w.meta.operation === "automod_log");
  assert.ok(warn, "un log automod_log est émis");
  assert.equal(warn.meta.guildId, "g1");
  assert.equal(warn.meta.error, "logs down");
});

test("4F-1: aucun warn quand tout réussit", async () => {
  const warns = [];
  const logger = { warn: (msg, meta) => warns.push({ msg, meta }) };
  const rt = runtime({
    config: { automod_enabled: true, automod_anti_links: true, automod_delete_message: true, automod_punishment: "none" },
    enforcer: { deleteMessage: async () => true },
    logger,
  });

  await rt.handleMessage({ guild: { id: "g1" }, author: { id: "u1" }, content: "https://x", mentions: { size: 0 } });
  assert.equal(warns.length, 0, "pas de warn parasite sur un chemin sain");
});
