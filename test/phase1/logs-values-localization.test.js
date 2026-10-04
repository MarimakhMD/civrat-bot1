"use strict";

/**
 * PHASE 1 (correctif 3) — les VALEURS des embeds Logs respectent la langue de la
 * guilde, pas seulement les titres et les libellés de champs.
 *
 * Jusqu'ici, `channelTypeLabel` et `formatDuration` étaient codés en français :
 * un serveur réglé en anglais affichait « Catégorie » et « 2 h 15 min ». La
 * persistance de `language` étant déjà correcte, seul le rendu est corrigé ici.
 *
 * Les tests d'intégration passent par le VRAI `DiscordLogsTransport` et le VRAI
 * runtime Logs, puis inspectent le texte réellement publié dans l'embed.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  channelTypeLabel,
  formatDuration,
  unknownLabel,
  CHANNEL_TYPE_LABELS,
  UNKNOWN,
} = require("../../src/modules/logs/services/logLabels");
const { createLogsRuntime } = require("../../src/modules/logs/runtime/createLogsRuntime");
const { labelFor } = require("../../src/adapters/discord/DiscordLogsTransport");
const guildConfigService = require("../../src/services/guildConfig");

// ─────────────────────────────────────────────────────────────
// Harnais de rendu réel
// ─────────────────────────────────────────────────────────────

/** Texte français qui ne doit JAMAIS apparaître dans un embed anglais. */
const FRENCH_MARKERS = [
  "Texte", "Vocal", "Catégorie", "Annonce", "Scène", "Fil public", "Fil privé",
  "inconnu", "Avant", "Après", "Raison", "Salon", "Membre", "Modérateur",
  "Durée", "Ancien pseudo", "Nouveau pseudo", " j ",
];

function makeGuild(guildId, channelId = "logchan") {
  const published = [];
  const channel = {
    id: channelId,
    isTextBased: () => true,
    send: async (payload) => {
      const data = payload.embeds?.[0]?.data || {};
      published.push({
        title: data.title || "",
        fields: (data.fields || []).map((field) => ({ name: field.name, value: String(field.value) })),
        thumbnail: data.thumbnail?.url || null,
      });
    },
  };
  return {
    id: guildId,
    published,
    channels: { cache: new Map([[channelId, channel]]) },
  };
}

function runtimeFor(guild) {
  return createLogsRuntime({ guildConfigResolver: { get: async () => guild.config } });
}

function allText(entry) {
  return [entry.title, ...entry.fields.flatMap((field) => [field.name, field.value])].join(" | ");
}

function attachConfig(guild, config) {
  guild.config = config;
  return guild;
}

// ─────────────────────────────────────────────────────────────
// Valeurs — types de salon
// ─────────────────────────────────────────────────────────────

test("PHASE1-FIX3: chaque type de salon a un libellé français et anglais", () => {
  const expected = {
    0: ["Texte", "Text"],
    2: ["Vocal", "Voice"],
    4: ["Catégorie", "Category"],
    5: ["Annonce", "Announcement"],
    13: ["Scène", "Stage"],
    15: ["Forum", "Forum"],
    11: ["Fil public", "Public Thread"],
    12: ["Fil privé", "Private Thread"],
  };
  for (const [type, [fr, en]] of Object.entries(expected)) {
    assert.equal(channelTypeLabel({ type: Number(type) }, "fr"), fr);
    assert.equal(channelTypeLabel({ type: Number(type) }, "en"), en);
  }
  assert.equal(Object.keys(CHANNEL_TYPE_LABELS.fr).length, Object.keys(CHANNEL_TYPE_LABELS.en).length,
    "parité FR/EN des tables de types de salon");
});

test("PHASE1-FIX3: le défaut de langue reste le français (appelants hors périmètre préservés)", () => {
  assert.equal(channelTypeLabel({ type: 4 }), "Catégorie");
  assert.equal(formatDuration(45 * 60_000), "45 min");
  assert.equal(UNKNOWN, "inconnu");
});

test("PHASE1-FIX3: un type de salon inconnu n'est pas deviné", () => {
  assert.equal(channelTypeLabel({ type: 999 }, "en"), null);
  assert.equal(channelTypeLabel(null, "en"), null);
  assert.equal(channelTypeLabel({}, "en"), null);
});

// ─────────────────────────────────────────────────────────────
// Valeurs — durées
// ─────────────────────────────────────────────────────────────

test("PHASE1-FIX3: les durées sont localisées", () => {
  const cases = [
    [45 * 60_000, "45 min", "45 min"],
    [2 * 3600_000 + 15 * 60_000, "2 h 15 min", "2h 15m"],
    [3 * 3600_000, "3 h", "3h"],
    [3 * 86_400_000 + 4 * 3600_000, "3 j 4 h", "3d 4h"],
    [2 * 86_400_000, "2 j", "2d"],
  ];
  for (const [ms, fr, en] of cases) {
    assert.equal(formatDuration(ms, "fr"), fr, `FR ${ms}`);
    assert.equal(formatDuration(ms, "en"), en, `EN ${ms}`);
  }
});

test("PHASE1-FIX3: une durée non calculable n'est jamais inventée", () => {
  assert.equal(formatDuration(NaN, "en"), null);
  assert.equal(formatDuration(-1, "en"), null);
  assert.equal(formatDuration(undefined, "en"), null);
});

test("PHASE1-FIX3: « inconnu » / « unknown »", () => {
  assert.equal(unknownLabel("fr"), "inconnu");
  assert.equal(unknownLabel("en"), "unknown");
  assert.equal(unknownLabel(), "inconnu");
});

// ─────────────────────────────────────────────────────────────
// Intégration — embeds réellement publiés
// ─────────────────────────────────────────────────────────────

test("PHASE1-FIX3: un log de salon en anglais ne contient aucun texte français", async () => {
  const guild = attachConfig(makeGuild("G_EN"), {
    logs_enabled: true,
    language: "en",
    log_channel_update_channel_id: "logchan",
  });

  await runtimeFor(guild).handleChannelEvent({
    guild,
    config: guild.config,
    action: "channel_created",
    channel: { id: "c1", name: "general", type: 0, guild },
  });

  assert.equal(guild.published.length, 1);
  const entry = guild.published[0];
  assert.equal(entry.fields.find((field) => field.name === "🏷️ Type")?.value, "Text",
    "la VALEUR du type de salon doit être anglaise");
  for (const marker of FRENCH_MARKERS) {
    assert.ok(!allText(entry).includes(marker), `texte français « ${marker} » présent dans : ${allText(entry)}`);
  }
});

test("PHASE1-FIX3: le même log en français reste intégralement français", async () => {
  const guild = attachConfig(makeGuild("G_FR"), {
    logs_enabled: true,
    language: "fr",
    log_channel_update_channel_id: "logchan",
  });

  await runtimeFor(guild).handleChannelEvent({
    guild,
    config: guild.config,
    action: "channel_created",
    channel: { id: "c1", name: "general", type: 0, guild },
  });

  assert.equal(guild.published.length, 1);
  const entry = guild.published[0];
  assert.equal(entry.fields.find((field) => field.name === "🏷️ Type")?.value, "Texte");
  assert.ok(allText(entry).includes("Salon"), "les libellés français sont conservés");
});

test("PHASE1-FIX3: la langue reste indépendante par guild_id", async () => {
  const config = (language) => ({
    logs_enabled: true,
    language,
    log_moderation_channel_id: "logchan",
  });
  const guildFr = attachConfig(makeGuild("G_FR"), config("fr"));
  const guildEn = attachConfig(makeGuild("G_EN"), config("en"));

  for (const guild of [guildFr, guildEn]) {
    await runtimeFor(guild).handleMemberNicknameChanged({
      guild,
      config: guild.config,
      memberId: "u1",
      member: "<@u1> `useru1`",
      before: "Alice",
      after: "Bob",
      avatarUrl: null,
    });
  }

  assert.equal(guildFr.published.length, 1);
  assert.equal(guildEn.published.length, 1);

  const frText = allText(guildFr.published[0]);
  const enText = allText(guildEn.published[0]);

  assert.ok(frText.includes("Ancien pseudo") && frText.includes("Nouveau pseudo"), `FR : ${frText}`);
  assert.ok(!enText.includes("Ancien pseudo") && !enText.includes("Nouveau pseudo"), `EN : ${enText}`);
  for (const marker of FRENCH_MARKERS) {
    assert.ok(!enText.includes(marker), `texte français « ${marker} » dans l'embed EN : ${enText}`);
  }
});

test("PHASE1-FIX3: un timeout en anglais rend une durée anglaise", async () => {
  const guildConfig = {
    logs_enabled: true,
    language: "en",
    log_moderation_channel_id: "logchan",
  };
  const guild = attachConfig(makeGuild("G_EN"), guildConfig);
  guildConfigService.getGuildConfig = async () => guildConfig;

  // Le runtime réel résout la langue depuis la config passée par l'appelant.
  await runtimeFor(guild).handleModerationEvent({
    guild,
    config: guildConfig,
    action: "member_timed_out",
    targetId: "u1",
    target: "<@u1> `useru1`",
    reason: null,
    moderator: null,
    moderatorId: null,
    duration: formatDuration(2 * 3600_000 + 15 * 60_000, "en"),
    avatarUrl: null,
  });

  assert.equal(guild.published.length, 1);
  const entry = guild.published[0];
  const duration = entry.fields.find((field) => field.name === "⏱️ Duration");
  assert.equal(duration?.value, "2h 15m");
  for (const marker of FRENCH_MARKERS) {
    assert.ok(!allText(entry).includes(marker), `texte français « ${marker} » dans : ${allText(entry)}`);
  }
});

test("PHASE1-FIX3: aucun texte français dans un log de rôle anglais", async () => {
  const guildConfig = {
    logs_enabled: true,
    language: "en",
    log_role_update_channel_id: "logchan",
  };
  const guild = attachConfig(makeGuild("G_EN"), guildConfig);

  await runtimeFor(guild).handleRoleEvent({
    guild,
    config: guildConfig,
    action: "member_role_added",
    roleId: "r1",
    memberId: "u1",
    // Le nom du rôle vient de Discord : ce n'est pas du texte produit par le
    // bot, il n'est donc pas traduit. La fixture utilise un nom neutre pour que
    // la recherche de marqueurs français ne porte QUE sur le texte du bot.
    target: "@Verified (r1)",
    member: "<@u1> `useru1`",
    who: null,
    avatarUrl: null,
  });

  assert.equal(guild.published.length, 1);
  const entry = guild.published[0];
  const text = allText(entry);
  assert.ok(text.includes("@Verified (r1)"), `valeur Discord conservée telle quelle : ${text}`);
  // Rendu dédié : les libellés de champs sont anglais. Un `who` nul est omis
  // (comportement voulu de la Phase 1 : aucun champ construit sur une valeur
  // absente) — sa forme localisée est vérifiée séparément ci-dessous.
  assert.ok(text.includes("👤 Member"), `libellé anglais attendu : ${text}`);
  for (const marker of FRENCH_MARKERS) {
    assert.ok(!text.includes(marker), `texte français « ${marker} » dans : ${text}`);
  }
});

test("PHASE1-FIX3: le transport localise « inconnu » selon la langue de l'entrée", () => {
  assert.equal(labelFor("unknown", "fr"), "inconnu");
  assert.equal(labelFor("unknown", "en"), "unknown");
  assert.equal(labelFor("who", "en"), "👤 Who");
  assert.equal(labelFor("duration", "en"), "⏱️ Duration");
  assert.equal(labelFor("channelType", "en"), "🏷️ Type");
});
