"use strict";

const { LogsConfigKey: Key, LogsComponentId: Id } = require("../configuration/logsConstants");
const { LogsCategory, LogsCategoryChannelKey } = require("../configuration/logsCategories");
const { logsView, channelView } = require("./logsViews");

// Active/désactive les journaux et rafraîchit la vue principale.
async function toggleLogs(context) {
  const config = await context.service.read(context.guildId);
  const saved = await context.service.update(context.guildId, { [Key.ENABLED]: !config[Key.ENABLED] });
  await context.envelope.transport.update({ view: logsView({ t: context.t, config: saved }) });
  return saved;
}

// Ouvre la sous-vue de configuration d'une catégorie, avec son salon actuel.
async function selectLogsCategory(context) {
  const category = context.envelope.values?.[0];
  if (!category || !LogsCategoryChannelKey[category]) throw new Error("Unknown logs category");
  const config = await context.service.read(context.guildId);
  await context.envelope.transport.update({ view: channelView({ t: context.t, category, config }) });
}

// Enregistre le salon choisi pour une catégorie et rafraîchit la liste.
async function selectLogsChannel(context) {
  const category = context.envelope.customId.split(":").at(-1);
  const key = LogsCategoryChannelKey[category];
  if (!key) throw new Error("Unknown logs category");
  const channel = context.envelope.values?.[0] || null;
  const saved = await context.service.update(context.guildId, { [key]: channel });
  const base = logsView({ t: context.t, config: saved });
  const notice = channel
    ? context.t("logs.channelUpdated", { category: context.t(`logs.${category}`) })
    : context.t("logs.categoryDisabled", { category: context.t(`logs.${category}`) });
  await context.envelope.transport.update({ view: { ...base, content: `${notice}\n\n${base.content}` } });
  return saved;
}

// Désactive explicitement une catégorie : écrit null et rafraîchit la liste.
async function disableLogsCategory(context) {
  const category = context.envelope.customId.split(":").at(-1);
  const key = LogsCategoryChannelKey[category];
  if (!key) throw new Error("Unknown logs category");
  const saved = await context.service.update(context.guildId, { [key]: null });
  const base = logsView({ t: context.t, config: saved });
  const notice = context.t("logs.categoryDisabled", { category: context.t(`logs.${category}`) });
  await context.envelope.transport.update({ view: { ...base, content: `${notice}\n\n${base.content}` } });
  return saved;
}

// Aperçu réel : construit une entrée via le mapper, résout le salon de la
// catégorie « messages » depuis la configuration persistante, et livre via le
// service de livraison. Sans salon configuré, rien n'est envoyé.
async function previewLogs(context) {
  const config = await context.service.read(context.guildId);
  const entry = context.mapper.map({
    guildId: context.guildId,
    category: LogsCategory.MESSAGES,
    action: "message_deleted",
    channelKey: Key.MESSAGES_DELETE,
    title: context.t("logs.previewTitle"),
    description: context.t("logs.previewDescription"),
    details: {},
  });
  const channelId = config[Key.MESSAGES_DELETE] || null;
  const result = await context.delivery.deliver({ ...entry, channelId });
  // Distingue trois issues : aucun salon configuré, envoi réussi, échec de
  // livraison (salon supprimé / bot sans permission). Jamais d'annonce de
  // succès quand la livraison a réellement échoué.
  const view = !channelId
    ? { content: context.t("logs.previewNoChannel"), components: [] }
    : result.delivered
      ? { content: context.t("logs.previewSent", { channel: `<#${channelId}>` }), components: [] }
      : { content: context.t("logs.previewFailed"), components: [] };
  await context.envelope.transport.reply({ view, ephemeral: true });
  return result;
}

// Retour vers la vue principale depuis une sous-vue de catégorie.
async function backToLogs(context) {
  await context.envelope.transport.update({ view: logsView({ t: context.t, config: await context.service.read(context.guildId) }) });
}

module.exports = { toggleLogs, selectLogsCategory, selectLogsChannel, disableLogsCategory, previewLogs, backToLogs };
