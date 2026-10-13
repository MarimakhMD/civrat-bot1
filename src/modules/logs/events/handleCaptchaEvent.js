"use strict";

// PHASE 1 — les logs CAPTCHA passent par le même rendu et la même traduction
// que le reste du système. Seule la couche Logs est touchée ici : aucun
// comportement du CAPTCHA n'est modifié (module gelé).
//
// Avant : `title: \`logs.${action}\`` affichait la clé brute comme titre, et
// `details.result` dupliquait l'action sous un nom technique.

const { localizeTitle } = require("../services/logTitles");
const { resolveLanguage } = require("../services/logLanguage");

async function handleCaptchaEvent({
  guild,
  config,
  action,
  memberId = null,
  roleId = null,
  details: extraDetails = null,
  mapper,
  service,
  delivery,
}) {
  if (!config.logs_enabled) return null;

  const details = {};
  if (memberId) details.memberId = memberId;
  if (roleId) details.roleId = roleId;
  // P-CAPT L4 — champs supplémentaires fournis par l'appelant (cycle de vie
  // CAPTCHA : panneau, provisioning, force-existing). Le rendu de chaque
  // action est déclaré dans le transport ; une clé qui n'y figure pas est
  // écartée par le contrôle d'intégrité habituel (jamais publiée brute).
  if (extraDetails && typeof extraDetails === "object" && !Array.isArray(extraDetails)) {
    for (const [key, value] of Object.entries(extraDetails)) {
      if (value === undefined) continue;
      details[key] = value;
    }
  }

  const entry = mapper.map({
    guildId: guild.id,
    channelKey: "log_moderation_channel_id",
    category: "moderation",
    language: resolveLanguage(config),
    action,
    title: localizeTitle(config, `logs.${action}`),
    details,
  });

  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}

module.exports = { handleCaptchaEvent };
