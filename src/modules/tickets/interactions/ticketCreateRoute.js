"use strict";

const { TicketComponentId: Id } = require("../configuration/ticketConstants");

/**
 * M8 — extrait panelId et buttonIndex du customId d'un bouton de panel.
 *
 * Format : civrat:v1:tickets:create:<panelId>:<buttonIndex>
 *
 * ⚠️ Extraction par slice(Id.CREATE_PREFIX.length), JAMAIS par split(":")[1].
 *    Le préfixe contient déjà QUATRE « : » :
 *        "civrat:v1:tickets:create:12:0".split(":")[1] === "v1"
 *    Le pattern slice() est celui d'admin-panel/register.js:46.
 *
 * `panelId` reste une CHAÎNE : c'est un bigint renvoyé tel quel par PostgREST.
 *
 * @returns {{panelId:string, buttonIndex:number}|null} null si malformé.
 */
function parsePanelCreateCustomId(customId) {
  if (typeof customId !== "string") return null;
  if (!customId.startsWith(Id.CREATE_PREFIX)) return null;
  const rest = customId.slice(Id.CREATE_PREFIX.length);
  const separator = rest.lastIndexOf(":");
  if (separator <= 0) return null;
  const panelId = rest.slice(0, separator);
  const buttonIndex = Number(rest.slice(separator + 1));
  if (!/^\d+$/.test(panelId)) return null;
  if (!Number.isInteger(buttonIndex) || buttonIndex < 0) return null;
  return { panelId, buttonIndex };
}

/**
 * M8 — ouverture d'un ticket depuis un panel identifié.
 */
async function handleTicketCreate(context, creationServiceFactory, panelRepository = null) {
  const parsed = parsePanelCreateCustomId(context.envelope.customId);

  // CustomId malformé : on ne devine rien, on refuse explicitement.
  if (!parsed) {
    await context.envelope.transport.reply({
      view: { title: context.t("tickets.title"), content: context.t("tickets.TICKET_PANEL_UNAVAILABLE"), components: [] },
      ephemeral: true,
    });
    return { created: false, code: "TICKET_PANEL_UNAVAILABLE" };
  }

  const service = creationServiceFactory(context);
  const result = await service.createTicket({
    guildId: context.guildId,
    member: context.envelope.discordMember,
    t: context.t,
    panelId: parsed.panelId,
    buttonIndex: parsed.buttonIndex,
    panelRepository,
  });
  await context.envelope.transport.reply({
    view: {
      title: context.t("tickets.title"),
      content: context.t(`tickets.${result.code}`, { channel: result.details.channelId ? `<#${result.details.channelId}>` : "" }),
      components: [],
    },
    ephemeral: true,
  });
  return result;
}

/**
 * M8 — route de l'ANCIEN customId exact `civrat:v1:tickets:create`.
 *
 * Ce customId est celui des panels envoyés AVANT M8 : ces messages vivent
 * toujours sur les serveurs. On ne peut ni les retrouver (aucun message_id
 * n'était stocké), ni savoir quelle configuration ils affichaient.
 *
 * Décision validée : refus PROPRE et explicite, avec demande de recréer le
 * panel. Aucune création n'a lieu — retomber silencieusement sur les défauts de
 * guilde reviendrait à inventer une configuration, ce que §12 et §14 interdisent.
 */
async function handleLegacyTicketCreate(context) {
  await context.envelope.transport.reply({
    view: {
      title: context.t("tickets.title"),
      content: context.t("tickets.TICKET_PANEL_LEGACY"),
      components: [],
    },
    ephemeral: true,
  });
  return { created: false, code: "TICKET_PANEL_LEGACY" };
}

module.exports = { handleTicketCreate, handleLegacyTicketCreate, parsePanelCreateCustomId };
