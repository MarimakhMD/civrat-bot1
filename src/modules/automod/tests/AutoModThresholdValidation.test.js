"use strict";

// P3-A — validation des seuils AutoMod AVANT stockage (configureAutoMod.js).
// Couvre : négatif, zéro, min valide, normal, trop élevé, non numérique,
// décimale (champ entier), défauts exacts et non-régression du merge.

const test = require("node:test");
const assert = require("node:assert/strict");
const { submitAutoModThresholds } = require("../interactions/configureAutoMod");
const { AutoModConfigService, AUTOMOD_DEFAULTS } = require("../services/AutoModConfigService");

async function submitAndGetPatch(modalValues) {
  let captured = null;
  await submitAutoModThresholds({
    guildId: "guild-1",
    service: {
      update: async (guildId, patch) => {
        captured = { guildId, patch };
        return patch;
      },
    },
    envelope: { modalValues },
  });
  assert.ok(captured, "service.update must be called exactly once");
  assert.equal(captured.guildId, "guild-1");
  return captured.patch;
}

// ── valeurs négatives ────────────────────────────────────────────────────

test("P3-A: valeur négative ramenée à la borne minimale (jamais -1 stocké)", async () => {
  const patch = await submitAndGetPatch({
    mention_threshold: "-1",
    emoji_threshold: "-8",
    caps_threshold: "-70",
    timeout_minutes: "-10",
  });
  assert.equal(patch.automod_mention_threshold, 1);
  assert.equal(patch.automod_emoji_threshold, 1);
  assert.equal(patch.automod_caps_threshold, 1);
  assert.equal(patch.automod_timeout_minutes, 1);
});

// ── zéro ────────────────────────────────────────────────────────────────

test("P3-A: zéro ramené à la borne minimale (aucun seuil nul stocké)", async () => {
  const patch = await submitAndGetPatch({
    mention_threshold: "0",
    emoji_threshold: "0",
    caps_threshold: "0",
    timeout_minutes: "0",
  });
  assert.equal(patch.automod_mention_threshold, 1);
  assert.equal(patch.automod_emoji_threshold, 1);
  assert.equal(patch.automod_caps_threshold, 1);
  assert.equal(patch.automod_timeout_minutes, 1);
});

// ── valeur valide minimale ──────────────────────────────────────────────

test("P3-A: valeur valide minimale conservée", async () => {
  const patch = await submitAndGetPatch({
    mention_threshold: "1",
    emoji_threshold: "1",
    caps_threshold: "1",
    timeout_minutes: "1",
  });
  assert.equal(patch.automod_mention_threshold, 1);
  assert.equal(patch.automod_emoji_threshold, 1);
  assert.equal(patch.automod_caps_threshold, 1);
  assert.equal(patch.automod_timeout_minutes, 1);
});

// ── valeur valide normale ───────────────────────────────────────────────

test("P3-A: valeurs valides normales conservées et les 4 clés écrites ensemble", async () => {
  const patch = await submitAndGetPatch({
    mention_threshold: "7",
    emoji_threshold: "12",
    caps_threshold: "85",
    timeout_minutes: "30",
  });
  assert.deepEqual(Object.keys(patch).sort(), [
    "automod_caps_threshold",
    "automod_emoji_threshold",
    "automod_mention_threshold",
    "automod_timeout_minutes",
  ]);
  assert.equal(patch.automod_mention_threshold, 7);
  assert.equal(patch.automod_emoji_threshold, 12);
  assert.equal(patch.automod_caps_threshold, 85);
  assert.equal(patch.automod_timeout_minutes, 30);
});

// ── valeur trop élevée ──────────────────────────────────────────────────

test("P3-A: valeur trop élevée bornée au maximum (100 / 100 / 100 / 40320)", async () => {
  const patch = await submitAndGetPatch({
    mention_threshold: "101",
    emoji_threshold: "999",
    caps_threshold: "150",
    timeout_minutes: "999999",
  });
  assert.equal(patch.automod_mention_threshold, 100);
  assert.equal(patch.automod_emoji_threshold, 100);
  assert.equal(patch.automod_caps_threshold, 100);
  assert.equal(patch.automod_timeout_minutes, 40320);

  const maxEdge = await submitAndGetPatch({
    mention_threshold: "40320",
    emoji_threshold: "100",
    caps_threshold: "100",
    timeout_minutes: "40321",
  });
  assert.equal(maxEdge.automod_mention_threshold, 100);
  assert.equal(maxEdge.automod_timeout_minutes, 40320);
});

// ── valeur non numérique (toInt inchangé → défaut) ──────────────────────

test("P3-A: valeur non numérique → défaut existant (comportement toInt conservé)", async () => {
  const patch = await submitAndGetPatch({
    mention_threshold: "abc",
    emoji_threshold: "",
    caps_threshold: "   ",
    timeout_minutes: null,
  });
  assert.equal(patch.automod_mention_threshold, 5);
  assert.equal(patch.automod_emoji_threshold, 8);
  assert.equal(patch.automod_caps_threshold, 70);
  assert.equal(patch.automod_timeout_minutes, 10);

  const empty = await submitAndGetPatch({});
  assert.equal(empty.automod_mention_threshold, 5);
  assert.equal(empty.automod_emoji_threshold, 8);
  assert.equal(empty.automod_caps_threshold, 70);
  assert.equal(empty.automod_timeout_minutes, 10);
});

// ── valeur décimale (champ entier) ──────────────────────────────────────

test("P3-A: décimales tronquées en entier puis bornées", async () => {
  const patch = await submitAndGetPatch({
    mention_threshold: "2.5",
    emoji_threshold: "0.9",
    caps_threshold: "70.9",
    timeout_minutes: "10.9",
  });
  assert.equal(patch.automod_mention_threshold, 2);
  assert.equal(patch.automod_emoji_threshold, 1); // parseInt → 0, borné à 1
  assert.equal(patch.automod_caps_threshold, 70);
  assert.equal(patch.automod_timeout_minutes, 10);
});

// ── conservation des valeurs par défaut ─────────────────────────────────

test("P3-A: les valeurs par défaut restent exactement 5 / 8 / 70 / 10", () => {
  assert.equal(AUTOMOD_DEFAULTS.automod_mention_threshold, 5);
  assert.equal(AUTOMOD_DEFAULTS.automod_emoji_threshold, 8);
  assert.equal(AUTOMOD_DEFAULTS.automod_caps_threshold, 70);
  assert.equal(AUTOMOD_DEFAULTS.automod_timeout_minutes, 10);
  // défauts dans les bornes : soumis vides → identiques
  assert.equal(AUTOMOD_DEFAULTS.automod_enabled, false);
  assert.equal(AUTOMOD_DEFAULTS.automod_punishment, "none");
  assert.equal(AUTOMOD_DEFAULTS.automod_delete_message, true);
});

test("P3-A: modal vide → patch égal aux défauts (5 / 8 / 70 / 10)", async () => {
  const patch = await submitAndGetPatch(undefined);
  assert.equal(patch.automod_mention_threshold, 5);
  assert.equal(patch.automod_emoji_threshold, 8);
  assert.equal(patch.automod_caps_threshold, 70);
  assert.equal(patch.automod_timeout_minutes, 10);
});

// ── non-régression du merge de configuration ────────────────────────────

test("P3-A: merge read() non régressé — stored partiel + défauts intacts", async () => {
  const stored = { automod_mention_threshold: 9, automod_enabled: true };
  const service = new AutoModConfigService({
    guildConfigResolver: { get: async () => stored, update: async () => ({}) },
  });
  const config = await service.read("g");
  assert.equal(config.automod_mention_threshold, 9);
  assert.equal(config.automod_enabled, true);
  assert.equal(config.automod_emoji_threshold, 8);
  assert.equal(config.automod_caps_threshold, 70);
  assert.equal(config.automod_timeout_minutes, 10);
  assert.equal(config.automod_punishment, "none");
  assert.equal(config.automod_delete_message, true);
});

test("P3-A: read() sans stored → merge exactement AUTOMOD_DEFAULTS", async () => {
  const service = new AutoModConfigService({
    guildConfigResolver: { get: async () => ({}), update: async () => ({}) },
  });
  const config = await service.read("g");
  assert.deepEqual(config, { ...AUTOMOD_DEFAULTS });
});

// ── balayage systématique : toute soumission reste dans les bornes ──────

test("P3-A: balayage — aucun patch ne sort jamais des bornes, toujours entier", async () => {
  const fields = [
    { field: "mention_threshold", key: "automod_mention_threshold", min: 1, max: 100 },
    { field: "emoji_threshold", key: "automod_emoji_threshold", min: 1, max: 100 },
    { field: "caps_threshold", key: "automod_caps_threshold", min: 1, max: 100 },
    { field: "timeout_minutes", key: "automod_timeout_minutes", min: 1, max: 40320 },
  ];
  const samples = ["-100", "-1", "0", "0.4", "", "abc", "NaN", "1", "50", "100", "101", "999999", "-0.5"];
  for (const { field, key, min, max } of fields) {
    for (const sample of samples) {
      const patch = await submitAndGetPatch({ [field]: sample });
      const value = patch[key];
      assert.ok(Number.isInteger(value), `${field}="${sample}" → entier attendu, obtenu ${value}`);
      assert.ok(value >= min, `${field}="${sample}" → ${value} >= ${min}`);
      assert.ok(value <= max, `${field}="${sample}" → ${value} <= ${max}`);
    }
  }
});
