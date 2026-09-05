"use strict";

/**
 * A1 — Liste blanche des colonnes de guild_configs.
 *
 * Ces tests verrouillent trois choses distinctes :
 *   1. le rejet STRICT d'une clé inconnue, avant tout accès à la base ;
 *   2. l'absence de régression : toute clé légitime continue d'être écrite ;
 *   3. la cohérence de la liste avec les clés réellement déclarées par les
 *      modules, pour qu'une nouvelle clé oubliée casse la suite et non la prod.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ValidationError } = require("../../core/errors");
const service = require("../guildConfig");
const {
  GUILD_CONFIG_KEYS,
  GUILD_CONFIG_KEY_SET,
  EXCLUDED_NON_CONFIG_KEYS,
  SERVICE_MANAGED_KEYS,
  isGuildConfigKey,
} = require("../guildConfigKeys");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SRC_ROOT = path.join(REPO_ROOT, "src");

/**
 * Reconstitue les clés de configuration réellement déclarées par les modules.
 *
 * Seuls les exports dont le nom se termine par `ConfigKey` ou `DEFAULTS` sont
 * retenus : ce sont les familles « colonnes de guild_configs ». Cela exclut
 * volontairement `*ComponentId` (customIds Discord) et les champs de modale,
 * qui partagent la même casse snake_case sans être des colonnes.
 */
function collectModuleConfigKeys() {
  const keys = new Map();
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "tests" && entry.name !== "node_modules") walk(full);
      } else if (/Constants\.js$/.test(entry.name)) {
        files.push(path.resolve(full));
      }
    }
  })(SRC_ROOT);

  for (const file of files) {
    let loaded;
    try {
      loaded = require(file);
    } catch {
      continue;
    }
    for (const [exportName, exported] of Object.entries(loaded || {})) {
      if (!/(ConfigKey|DEFAULTS)$/.test(exportName)) continue;
      if (!exported || typeof exported !== "object") continue;
      for (const value of Object.values(exported)) {
        if (typeof value !== "string") continue;
        if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(value)) continue;
        if (!keys.has(value)) keys.set(value, new Set());
        keys.get(value).add(path.relative(SRC_ROOT, file));
      }
    }
  }
  return keys;
}

/** Client Supabase minimal, identique en forme à celui de guildConfig.test.js. */
function fakeClient({ read = { data: null, error: null }, write = null } = {}) {
  const calls = [];
  const client = {
    from(table) {
      const call = { table, operation: "read", payload: null, options: null };
      calls.push(call);
      return {
        select() { return this; },
        eq() { return this; },
        upsert(payload, options) {
          call.operation = "write";
          call.payload = payload;
          call.options = options;
          return this;
        },
        async maybeSingle() {
          return call.operation === "write" ? (write || { data: null, error: null }) : read;
        },
      };
    },
  };
  return { client, calls };
}

function useDatabase(client) {
  service._setDatabaseProvider(() => ({
    supabase: client,
    supabaseAdmin: client,
    databaseState: { status: client ? "READY" : "NOT_CONFIGURED" },
  }));
}

test.afterEach(async () => {
  await service.invalidateCache();
  service._setDatabaseProvider();
});

test("A1 — an unknown key is rejected before any database access", async () => {
  const { client, calls } = fakeClient();
  useDatabase(client);

  let thrown = null;
  await assert.rejects(
    () => service.updateGuildConfig("guild-a1", { giveaway_enabled: true }),
    (error) => { thrown = error; return true; }
  );

  assert.ok(thrown instanceof ValidationError, "l'erreur doit être une ValidationError");
  assert.match(thrown.message, /giveaway_enabled/, "le message doit nommer la clé fautive");
  assert.deepEqual(thrown.metadata.unknownKeys, ["giveaway_enabled"]);
  assert.equal(calls.length, 0, "aucun appel à la base ne doit avoir eu lieu");
  assert.equal(service._getCache().has("guild-a1"), false, "rien ne doit être mis en cache");
});

test("A1 — every unknown key of a mixed patch is reported at once", async () => {
  const { client, calls } = fakeClient();
  useDatabase(client);

  let thrown = null;
  await assert.rejects(
    () => service.updateGuildConfig("guild-a1", {
      language: "fr",
      xp_per_message: 2,
      suggestion_enabled: true,
      up_votes: 0,
    }),
    (error) => { thrown = error; return true; }
  );

  assert.ok(thrown instanceof ValidationError);
  assert.deepEqual(thrown.metadata.unknownKeys, ["suggestion_enabled", "up_votes"]);
  assert.equal(calls.length, 0, "une clé valide ne doit pas masquer le rejet");
});

test("A1 — service-managed columns cannot be supplied by a caller", async () => {
  const { client, calls } = fakeClient();
  useDatabase(client);

  for (const key of SERVICE_MANAGED_KEYS) {
    await assert.rejects(
      () => service.updateGuildConfig("guild-a1", { [key]: "anything" }),
      ValidationError,
      `${key} doit être refusé en entrée`
    );
  }

  let thrown = null;
  await assert.rejects(
    () => service.updateGuildConfig("guild-a1", { language: "fr", updated_at: "1970-01-01T00:00:00.000Z" }),
    (error) => { thrown = error; return true; }
  );
  assert.match(thrown.message, /managed by the service/);
  assert.equal(calls.length, 0);
});

test("A1 — every whitelisted key is still accepted and written unchanged", async () => {
  // Un lot couvrant les 72 clés : chacune doit traverser la validation et
  // arriver intacte dans le payload d'upsert. C'est la garantie « aucune
  // régression sur les clés actuellement valides ».
  const patch = Object.fromEntries(GUILD_CONFIG_KEYS.map((key, index) => [key, `value-${index}`]));
  assert.equal(Object.keys(patch).length, GUILD_CONFIG_KEYS.length);

  const persisted = { guild_id: "guild-all", ...patch, updated_at: "2026-01-01T00:00:00.000Z" };
  const { client, calls } = fakeClient({ write: { data: persisted, error: null } });
  useDatabase(client);

  const result = await service.updateGuildConfig("guild-all", patch);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, "write");
  assert.equal(calls[0].options.onConflict, "guild_id");

  const sent = { ...calls[0].payload };
  for (const key of GUILD_CONFIG_KEYS) {
    assert.equal(sent[key], patch[key], `la clé ${key} doit être transmise telle quelle`);
    delete sent[key];
  }
  assert.deepEqual(Object.keys(sent).sort(), ["guild_id", "updated_at"],
    "seuls guild_id et updated_at peuvent s'ajouter au patch");
  assert.equal(sent.guild_id, "guild-all");
  assert.equal(typeof sent.updated_at, "string");
  assert.equal(result.guild_id, "guild-all");
});

test("A1 — guild_id and updated_at are added by the service, never taken from the patch", async () => {
  const persisted = { guild_id: "guild-svc", language: "fr", updated_at: "2026-01-01T00:00:00.000Z" };
  const { client, calls } = fakeClient({ write: { data: persisted, error: null } });
  useDatabase(client);

  await service.updateGuildConfig("guild-svc", { language: "fr" });

  assert.equal(calls[0].payload.guild_id, "guild-svc");
  assert.equal(typeof calls[0].payload.updated_at, "string");
  assert.notEqual(Number.isNaN(Date.parse(calls[0].payload.updated_at)), true,
    "updated_at doit être un horodatage ISO valide produit par le service");
});

test("A1 — undefined values are still dropped before the whitelist is applied", async () => {
  const persisted = { guild_id: "guild-undef", language: "fr" };
  const { client, calls } = fakeClient({ write: { data: persisted, error: null } });
  useDatabase(client);

  // Comportement antérieur conservé : undefined n'est pas une valeur.
  await assert.rejects(() => service.updateGuildConfig("guild-undef", { language: undefined }), ValidationError);
  assert.equal(calls.length, 0);
});

test("A1 — the whitelist is the single source of truth for guild_configs keys", () => {
  assert.ok(GUILD_CONFIG_KEYS.length >= 72, "la liste ne doit pas rétrécir silencieusement");

  const duplicates = GUILD_CONFIG_KEYS.filter((key, index) => GUILD_CONFIG_KEYS.indexOf(key) !== index);
  assert.deepEqual(duplicates, [], "aucun doublon toléré");

  for (const managed of SERVICE_MANAGED_KEYS) {
    assert.equal(isGuildConfigKey(managed), false, `${managed} ne doit pas être une clé d'entrée`);
    assert.equal(GUILD_CONFIG_KEY_SET.has(managed), false);
  }

  for (const key of EXCLUDED_NON_CONFIG_KEYS) {
    assert.equal(isGuildConfigKey(key), false, `${key} est un componentId ou un champ de modale, pas une colonne`);
  }

  assert.equal(isGuildConfigKey("language"), true, "language est une colonne réelle");
  assert.equal(isGuildConfigKey("guild_id"), false);
  assert.equal(isGuildConfigKey("updated_at"), false);
  assert.equal(isGuildConfigKey(""), false);
  assert.equal(isGuildConfigKey(null), false);
  assert.equal(isGuildConfigKey(42), false);
});

test("A1 — guard: every key declared by a module must be whitelisted", () => {
  const declared = collectModuleConfigKeys();
  assert.ok(declared.size > 0, "le garde-fou doit trouver des clés de modules");

  const missing = [...declared.keys()].filter((key) => !GUILD_CONFIG_KEY_SET.has(key)).sort();
  assert.deepEqual(
    missing,
    [],
    `clé(s) de configuration absente(s) de src/services/guildConfigKeys.js : ${missing.join(", ")}. ` +
    "Les ajouter sans les déclarer ferait échouer chaque réglage concerné en production."
  );
});

test("A1 — guard: no whitelisted key is invented without a module declaring it", () => {
  const declared = collectModuleConfigKeys();
  const orphans = GUILD_CONFIG_KEYS.filter((key) => key !== "language" && !declared.has(key)).sort();
  assert.deepEqual(
    orphans,
    [],
    `clé(s) de la whitelist déclarées par aucun module : ${orphans.join(", ")}. ` +
    "Une clé orpheline est soit une faute de frappe, soit une colonne fantôme."
  );
});

test("A2 — the XP phantom columns are now rejected before reaching the database", async () => {
  // A1 avait volontairement conservé xp_channel_id et xp_rate dans la liste
  // blanche pour ne changer aucun comportement. A2 (DCA3/DCA4) les supprime :
  // ces colonnes n'existent pas en base et ne doivent plus jamais être écrites.
  for (const key of ["xp_channel_id", "xp_rate"]) {
    assert.equal(isGuildConfigKey(key), false, `${key} ne doit plus être une clé de guild_configs`);
    assert.ok(EXCLUDED_NON_CONFIG_KEYS.includes(key), `${key} doit être listée comme exclusion explicite`);
  }

  // Les colonnes réelles vérifiées en base sont acceptées.
  for (const key of ["xp_enabled", "xp_per_message", "xp_cooldown"]) {
    assert.equal(isGuildConfigKey(key), true, `${key} est une colonne réelle`);
  }

  const { client, calls } = fakeClient();
  useDatabase(client);

  let thrown = null;
  await assert.rejects(
    () => service.updateGuildConfig("guild-xp", { xp_channel_id: "chan-1" }),
    (error) => { thrown = error; return true; }
  );
  assert.ok(thrown instanceof ValidationError);
  assert.deepEqual(thrown.metadata.unknownKeys, ["xp_channel_id"]);
  assert.equal(calls.length, 0, "la colonne fantôme ne doit plus atteindre PostgREST");
});

test("A2 — real XP columns are written through unchanged", async () => {
  const persisted = { guild_id: "guild-xp", xp_enabled: true, xp_per_message: 25, xp_cooldown: 120 };
  const { client, calls } = fakeClient({ write: { data: persisted, error: null } });
  useDatabase(client);

  const result = await service.updateGuildConfig("guild-xp", {
    xp_enabled: true,
    xp_per_message: 25,
    xp_cooldown: 120,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.xp_per_message, 25);
  assert.equal(calls[0].payload.xp_cooldown, 120);
  assert.equal(result.xp_per_message, 25);
});
