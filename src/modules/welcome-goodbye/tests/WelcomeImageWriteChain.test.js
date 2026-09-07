"use strict";

// ───────────────────────────────────────────────────────────────
// G2-C — chaîne d'écriture RÉELLE de `welcome_image_enabled`.
//
// Jusqu'ici, la validation (validateWelcomeGoodbyeUpdates) et la whitelist
// (isGuildConfigKey) étaient testées séparément, et WelcomeGoodbyeService
// n'était testé qu'avec un resolver mocké. Ici on traverse la chaîne complète
// sans double inutile :
//
//   WelcomeGoodbyeService.update
//     → validateWelcomeGoodbyeUpdates (refus des non-booléens)
//     → GuildConfigResolver.update
//       → LegacyGuildConfigRepository.updateByGuildId
//         → guildConfig.updateGuildConfig (whitelist A1 + UPSERT Supabase)
//
// Le `supabase` réel est remplacé par `_setDatabaseProvider` (faux client qui
// journalise l'upsert). Aucune base réelle n'est contactée.
// ───────────────────────────────────────────────────────────────

const test = require("node:test");
const assert = require("node:assert/strict");

const { WelcomeGoodbyeService } = require("../services/WelcomeGoodbyeService");
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { GuildConfigResolver, LegacyGuildConfigRepository } = require("../../../core/guild-config");
const { ValidationError } = require("../../../core/errors");
const guildConfig = require("../../../services/guildConfig");

const GUILD_ID = "111111111111111111";

/** Faux client PostgREST qui rejoue l'upsert et journalise le payload. */
function makeSupabase(persist = {}) {
  const upserts = [];
  const client = {
    from(table) {
      const state = { table, payload: null, onConflict: null };
      const api = {
        upsert(payload, options) {
          state.payload = payload;
          state.onConflict = options?.onConflict ?? null;
          return api;
        },
        select() { return api; },
        maybeSingle() { return api; },
        then(resolve) {
          if (state.payload) {
            upserts.push({ table: state.table, payload: state.payload, onConflict: state.onConflict });
            const row = { ...state.payload, guild_id: GUILD_ID };
            return Promise.resolve({ data: row, error: null }).then(resolve);
          }
          // Lecture (pas utilisée par update) : ligne absente.
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return api;
    },
  };
  return { client, upserts };
}

function buildChain() {
  const { client, upserts } = makeSupabase();
  guildConfig._setDatabaseProvider(() => ({ supabaseAdmin: client }));
  const repository = new LegacyGuildConfigRepository({
    getConfig: guildConfig.getGuildConfig,
    updateConfig: guildConfig.updateGuildConfig,
    invalidateConfig: guildConfig.invalidateCache,
  });
  const resolver = new GuildConfigResolver({ repository });
  const service = new WelcomeGoodbyeService({ guildConfigResolver: resolver });
  return { service, upserts, reset: () => guildConfig._setDatabaseProvider(null) };
}

test("G2-C: update(true) traverse la chaîne réelle et upsert welcome_image_enabled=true", async () => {
  const { service, upserts, reset } = buildChain();
  try {
    const config = await service.update(GUILD_ID, { [Key.WELCOME_IMAGE_ENABLED]: true });
    assert.equal(config[Key.WELCOME_IMAGE_ENABLED], true, "la valeur écrite est relue depuis la réponse Supabase");

    assert.equal(upserts.length, 1, "exactement un upsert guild_configs");
    const write = upserts[0];
    assert.equal(write.table, "guild_configs");
    assert.equal(write.onConflict, "guild_id");
    assert.equal(write.payload.guild_id, GUILD_ID);
    assert.equal(write.payload[Key.WELCOME_IMAGE_ENABLED], true);
    assert.equal(typeof write.payload.updated_at, "string", "updated_at est horodaté");
  } finally {
    reset();
  }
});

test("G2-C: update(false) traverse la chaîne réelle et upsert welcome_image_enabled=false", async () => {
  const { service, upserts, reset } = buildChain();
  try {
    const config = await service.update(GUILD_ID, { [Key.WELCOME_IMAGE_ENABLED]: false });
    assert.equal(config[Key.WELCOME_IMAGE_ENABLED], false);
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].payload[Key.WELCOME_IMAGE_ENABLED], false);
  } finally {
    reset();
  }
});

test("G2-C: une valeur non booléenne est refusée AVANT toute écriture (validation)", async () => {
  const { service, upserts, reset } = buildChain();
  try {
    for (const bad of ["true", 1, null, {}, []]) {
      await assert.rejects(
        () => service.update(GUILD_ID, { [Key.WELCOME_IMAGE_ENABLED]: bad }),
        ValidationError,
        `la valeur ${JSON.stringify(bad)} doit être refusée`,
      );
    }
    assert.equal(upserts.length, 0, "aucun upsert n'a été émis pour des valeurs invalides");
  } finally {
    reset();
  }
});

test("G2-C: une clé hors schéma est refusée par la validation, sans écriture", async () => {
  const { service, upserts, reset } = buildChain();
  try {
    await assert.rejects(
      () => service.update(GUILD_ID, { welcome_unknown_key: true }),
      ValidationError,
    );
    assert.equal(upserts.length, 0);
  } finally {
    reset();
  }
});
